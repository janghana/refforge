// ═══ RefForge Store — Dual Storage: Local Folder (File System Access API) + localStorage fallback ═══

const STORAGE_KEY = 'refforge_data'
const CACHE_KEY = 'refforge_cache'
const CACHE_VERSION = 'v6'

// ─── File System Access API State ───
let _dirHandle = null   // Directory handle for local folder
let _fsReady = false     // Whether FS storage is active

// ─── IndexedDB for persisting directory handle across sessions ───
function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('refforge_handles', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('handles')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveHandleToIDB(handle) {
  try {
    const db = await openHandleDB()
    const tx = db.transaction('handles', 'readwrite')
    tx.objectStore('handles').put(handle, 'dirHandle')
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej })
  } catch {}
}

async function loadHandleFromIDB() {
  try {
    const db = await openHandleDB()
    const tx = db.transaction('handles', 'readonly')
    const req = tx.objectStore('handles').get('dirHandle')
    return new Promise((res) => { req.onsuccess = () => res(req.result || null); req.onerror = () => res(null) })
  } catch { return null }
}

async function clearHandleFromIDB() {
  try {
    const db = await openHandleDB()
    const tx = db.transaction('handles', 'readwrite')
    tx.objectStore('handles').delete('dirHandle')
  } catch {}
}

// ─── File System Helpers ───
async function writeFile(dirHandle, filename, data) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(data, null, 2))
    await writable.close()
    return true
  } catch (e) { console.warn('FS write error:', filename, e); return false }
}

async function readFile(dirHandle, filename) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text)
  } catch { return null }
}

async function deleteFile(dirHandle, filename) {
  try {
    await dirHandle.removeEntry(filename)
    return true
  } catch { return false }
}

async function listFiles(dirHandle, prefix = '', suffix = '.json') {
  const files = []
  try {
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file' && name.startsWith(prefix) && name.endsWith(suffix)) {
        files.push(name)
      }
    }
  } catch {}
  return files
}

// ─── Sanitize filename ───
function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80)
}

// ═══════════════════════════════════════════════════
//  PUBLIC: Directory Connection
// ═══════════════════════════════════════════════════

export function isFileSystemSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export function isConnected() {
  return _fsReady && _dirHandle !== null
}

export async function pickDirectory() {
  if (!isFileSystemSupported()) throw new Error('File System Access API not supported in this browser')
  try {
    _dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    _fsReady = true
    await saveHandleToIDB(_dirHandle)
    // Migrate existing localStorage data to local folder
    await _migrateToFS()
    return true
  } catch (e) {
    if (e.name === 'AbortError') return false // User cancelled
    throw e
  }
}

export async function reconnectDirectory() {
  if (!isFileSystemSupported()) return false
  try {
    const handle = await loadHandleFromIDB()
    if (!handle) return false
    // Verify we still have permission
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      _dirHandle = handle
      _fsReady = true
      return true
    }
    // Try requesting permission
    const req = await handle.requestPermission({ mode: 'readwrite' })
    if (req === 'granted') {
      _dirHandle = handle
      _fsReady = true
      return true
    }
    return false
  } catch { return false }
}

export async function disconnectDirectory() {
  _dirHandle = null
  _fsReady = false
  await clearHandleFromIDB()
}

export function getDirectoryName() {
  return _dirHandle?.name || null
}

// ═══════════════════════════════════════════════════
//  INTERNAL: Unified read/write
// ═══════════════════════════════════════════════════

// -- Meta file stores activeId and project list (ids + names) --
async function _loadMeta() {
  if (_fsReady && _dirHandle) {
    const meta = await readFile(_dirHandle, '_refforge_meta.json')
    return meta || { projectIds: [], activeId: null }
  }
  return null
}

async function _saveMeta(meta) {
  if (_fsReady && _dirHandle) {
    await writeFile(_dirHandle, '_refforge_meta.json', meta)
  }
}

// -- Project files: project_{id}.json --
function _projFilename(id) { return `project_${sanitize(id)}.json` }

async function _loadProject(id) {
  if (_fsReady && _dirHandle) {
    return await readFile(_dirHandle, _projFilename(id))
  }
  return null
}

async function _saveProject(proj) {
  if (_fsReady && _dirHandle) {
    await writeFile(_dirHandle, _projFilename(proj.id), proj)
  }
}

async function _deleteProjectFile(id) {
  if (_fsReady && _dirHandle) {
    await deleteFile(_dirHandle, _projFilename(id))
  }
}

// ═══════════════════════════════════════════════════
//  localStorage fallback (unchanged logic)
// ═══════════════════════════════════════════════════

function _lsLoad() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return { projects: [], activeId: null }; return JSON.parse(raw) } catch { return { projects: [], activeId: null } }
}
function _lsSave(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {} }

// ═══════════════════════════════════════════════════
//  Unified data access (async for FS, sync fallback for LS)
// ═══════════════════════════════════════════════════

// We maintain a sync in-memory cache for fast reads
let _memData = null // { projects: [], activeId: null }

function _ensureMem() {
  if (!_memData) _memData = _lsLoad()
  return _memData
}

// Load all data from FS or LS into memory
export async function loadAll() {
  if (_fsReady && _dirHandle) {
    const meta = await _loadMeta()
    if (meta && meta.projectIds?.length > 0) {
      const projects = []
      for (const entry of meta.projectIds) {
        const proj = await _loadProject(entry.id)
        if (proj) projects.push(proj)
      }
      _memData = { projects, activeId: meta.activeId }
    } else {
      _memData = { projects: [], activeId: null }
    }
  } else {
    _memData = _lsLoad()
  }
  return _memData
}

// Persist current memory state
async function _persist() {
  const data = _ensureMem()
  // Always write to localStorage as backup
  _lsSave(data)
  // If FS connected, write project files
  if (_fsReady && _dirHandle) {
    const meta = {
      activeId: data.activeId,
      projectIds: data.projects.map(p => ({ id: p.id, name: p.name })),
      updatedAt: new Date().toISOString()
    }
    await _saveMeta(meta)
    // Save each project individually
    for (const proj of data.projects) {
      await _saveProject(proj)
    }
  }
}

// Persist a single project (optimized - doesn't rewrite all)
async function _persistProject(proj) {
  const data = _ensureMem()
  _lsSave(data)
  if (_fsReady && _dirHandle) {
    await _saveProject(proj)
    const meta = {
      activeId: data.activeId,
      projectIds: data.projects.map(p => ({ id: p.id, name: p.name })),
      updatedAt: new Date().toISOString()
    }
    await _saveMeta(meta)
  }
}

// Persist only meta (activeId change etc)
async function _persistMeta() {
  const data = _ensureMem()
  _lsSave(data)
  if (_fsReady && _dirHandle) {
    const meta = {
      activeId: data.activeId,
      projectIds: data.projects.map(p => ({ id: p.id, name: p.name })),
      updatedAt: new Date().toISOString()
    }
    await _saveMeta(meta)
  }
}

// ═══════════════════════════════════════════════════
//  PUBLIC API (same interface, now async-aware)
// ═══════════════════════════════════════════════════

export function getProjects() { return _ensureMem().projects }
export function getActiveId() { return _ensureMem().activeId }

export function setActiveId(id) {
  const d = _ensureMem(); d.activeId = id
  _persistMeta() // fire-and-forget
}

export function createProject(name) {
  const d = _ensureMem(); const id = `proj_${Date.now()}`
  const proj = { id, name, papers: [], createdAt: new Date().toISOString() }
  d.projects.push(proj)
  d.activeId = id
  _persistProject(proj) // fire-and-forget
  return id
}

export function deleteProject(id) {
  const d = _ensureMem()
  d.projects = d.projects.filter(p => p.id !== id)
  if (d.activeId === id) d.activeId = d.projects[0]?.id || null
  _persist() // fire-and-forget
  if (_fsReady && _dirHandle) _deleteProjectFile(id) // clean up file
}

export function renameProject(id, name) {
  const d = _ensureMem(); const p = d.projects.find(x => x.id === id)
  if (p) { p.name = name; _persistProject(p) }
}

export function getActiveProject() {
  const d = _ensureMem(); return d.projects.find(p => p.id === d.activeId) || null
}

export function getProjectPapers(pid) {
  const d = _ensureMem(); return (d.projects.find(p => p.id === pid))?.papers || []
}

export function addPaperToProject(pid, paper) {
  const d = _ensureMem(); const proj = d.projects.find(p => p.id === pid); if (!proj) return false
  const dupIdx = proj.papers.findIndex(p => {
    if (paper.doi && p.doi && paper.doi === p.doi) return true
    if (paper.arxivId && p.arxivId && paper.arxivId === p.arxivId) return true
    return false
  })
  if (dupIdx >= 0) return false

  const titleIdx = proj.papers.findIndex(p =>
    p.title && paper.title && p.title.toLowerCase().trim() === paper.title.toLowerCase().trim()
  )
  if (titleIdx >= 0) {
    proj.papers[titleIdx] = { ...paper, addedAt: new Date().toISOString() }
  } else {
    proj.papers.push({ ...paper, addedAt: new Date().toISOString() })
  }
  _persistProject(proj) // fire-and-forget
  return true
}

export function removePaperFromProject(pid, index) {
  const d = _ensureMem(); const p = d.projects.find(x => x.id === pid)
  if (p) { p.papers.splice(index, 1); _persistProject(p) }
}

export function reorderPapers(pid, papers) {
  const d = _ensureMem(); const p = d.projects.find(x => x.id === pid)
  if (p) { p.papers = papers; _persistProject(p) }
}

// ═══════════════════════════════════════════════════
//  Cache (also saved to FS if connected)
// ═══════════════════════════════════════════════════

function _lsLoadCache() {
  try { const r = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); if (r._v !== CACHE_VERSION) { localStorage.removeItem(CACHE_KEY); return { _v: CACHE_VERSION } }; return r } catch { return { _v: CACHE_VERSION } }
}

let _memCache = null

function _ensureCache() {
  if (!_memCache) _memCache = _lsLoadCache()
  return _memCache
}

export async function loadCacheFromFS() {
  if (_fsReady && _dirHandle) {
    const cached = await readFile(_dirHandle, '_refforge_cache.json')
    if (cached && cached._v === CACHE_VERSION) {
      _memCache = cached
      return
    }
  }
  _memCache = _lsLoadCache()
}

async function _persistCache() {
  const cache = _ensureCache()
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch {}
  if (_fsReady && _dirHandle) {
    await writeFile(_dirHandle, '_refforge_cache.json', cache)
  }
}

export function getCachedPaper(id) { return _ensureCache()[id] || null }

export function cachePaper(id, paper) {
  const c = _ensureCache(); c[id] = paper; c._v = CACHE_VERSION
  _persistCache() // fire-and-forget
}

export function getCachedByTitle(title) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const nq = norm(title)
  if (!nq) return null
  const cache = _ensureCache()
  for (const [key, paper] of Object.entries(cache)) {
    if (key === '_v') continue
    if (paper?.title && norm(paper.title) === nq) return paper
  }
  return null
}

export function clearAllCache() {
  localStorage.removeItem(CACHE_KEY)
  _memCache = { _v: CACHE_VERSION }
  if (_fsReady && _dirHandle) {
    deleteFile(_dirHandle, '_refforge_cache.json')
  }
}

// ═══════════════════════════════════════════════════
//  Migration: localStorage → File System
// ═══════════════════════════════════════════════════

async function _migrateToFS() {
  if (!_fsReady || !_dirHandle) return
  // Check if FS already has data
  const existingMeta = await _loadMeta()
  if (existingMeta && existingMeta.projectIds?.length > 0) {
    // FS already has data, load from FS instead
    await loadAll()
    return
  }
  // Migrate localStorage data to FS
  const lsData = _lsLoad()
  if (lsData.projects.length > 0) {
    _memData = lsData
    await _persist()
  }
  // Migrate cache too
  const lsCache = _lsLoadCache()
  if (Object.keys(lsCache).length > 1) { // more than just _v
    _memCache = lsCache
    await _persistCache()
  }
}

// ═══════════════════════════════════════════════════
//  Storage info
// ═══════════════════════════════════════════════════

export function getStorageInfo() {
  return {
    mode: _fsReady ? 'filesystem' : 'localStorage',
    folderName: _dirHandle?.name || null,
    supported: isFileSystemSupported()
  }
}
