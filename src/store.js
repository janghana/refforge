// ═══ RefForge Store — Triple Storage: IndexedDB (primary) + File System (optional) + localStorage (fallback) ═══
//
// Storage priority:
//   1. IndexedDB   — default for ALL browsers, auto-save, survives normal cache clearing
//   2. File System  — optional (Chrome/Edge only), user picks a folder for extra safety
//   3. localStorage — legacy fallback, also used as quick sync backup
//

const STORAGE_KEY = 'refforge_data'
const CACHE_KEY = 'refforge_cache'
const CACHE_VERSION = 'v6'
const IDB_NAME = 'refforge_db'
const IDB_VERSION = 1

// ═══════════════════════════════════════════════════
//  IndexedDB Core
// ═══════════════════════════════════════════════════

let _db = null

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache')
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(storeName, key) {
  try {
    const db = await openDB()
    return new Promise((res) => {
      const tx = db.transaction(storeName, 'readonly')
      const req = tx.objectStore(storeName).get(key)
      req.onsuccess = () => res(req.result ?? null)
      req.onerror = () => res(null)
    })
  } catch { return null }
}

async function idbPut(storeName, value, key) {
  try {
    const db = await openDB()
    return new Promise((res, rej) => {
      const tx = db.transaction(storeName, 'readwrite')
      if (key !== undefined) tx.objectStore(storeName).put(value, key)
      else tx.objectStore(storeName).put(value)
      tx.oncomplete = () => res(true)
      tx.onerror = () => rej(tx.error)
    })
  } catch { return false }
}

async function idbDelete(storeName, key) {
  try {
    const db = await openDB()
    return new Promise((res) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).delete(key)
      tx.oncomplete = () => res(true)
      tx.onerror = () => res(false)
    })
  } catch { return false }
}

async function idbGetAll(storeName) {
  try {
    const db = await openDB()
    return new Promise((res) => {
      const tx = db.transaction(storeName, 'readonly')
      const req = tx.objectStore(storeName).getAll()
      req.onsuccess = () => res(req.result || [])
      req.onerror = () => res([])
    })
  } catch { return [] }
}

async function idbClear(storeName) {
  try {
    const db = await openDB()
    return new Promise((res) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).clear()
      tx.oncomplete = () => res(true)
      tx.onerror = () => res(false)
    })
  } catch { return false }
}

// ═══════════════════════════════════════════════════
//  File System Access API (optional, Chrome/Edge)
// ═══════════════════════════════════════════════════

let _dirHandle = null
let _fsReady = false

async function _saveHandleToIDB(handle) {
  try { await idbPut('meta', handle, 'dirHandle') } catch {}
}
async function _loadHandleFromIDB() {
  try { return await idbGet('meta', 'dirHandle') } catch { return null }
}

async function fsWrite(filename, data) {
  if (!_fsReady || !_dirHandle) return false
  try {
    const fh = await _dirHandle.getFileHandle(filename, { create: true })
    const w = await fh.createWritable()
    await w.write(JSON.stringify(data, null, 2))
    await w.close()
    return true
  } catch (e) { console.warn('FS write error:', filename, e); return false }
}

async function fsRead(filename) {
  if (!_fsReady || !_dirHandle) return null
  try {
    const fh = await _dirHandle.getFileHandle(filename)
    const f = await fh.getFile()
    return JSON.parse(await f.text())
  } catch { return null }
}

async function fsDelete(filename) {
  if (!_fsReady || !_dirHandle) return false
  try { await _dirHandle.removeEntry(filename); return true } catch { return false }
}

function sanitize(name) { return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80) }
function projFilename(id) { return `project_${sanitize(id)}.json` }

// ═══════════════════════════════════════════════════
//  localStorage (quick sync backup)
// ═══════════════════════════════════════════════════

function _lsLoad() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return { projects: [], activeId: null }; return JSON.parse(raw) } catch { return { projects: [], activeId: null } }
}
function _lsSave(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {} }
function _lsLoadCache() {
  try { const r = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); if (r._v !== CACHE_VERSION) { localStorage.removeItem(CACHE_KEY); return { _v: CACHE_VERSION } }; return r } catch { return { _v: CACHE_VERSION } }
}

// ═══════════════════════════════════════════════════
//  In-memory state
// ═══════════════════════════════════════════════════

let _memData = null // { projects: [], activeId: null }
let _memCache = null
let _idbReady = false

function _ensureMem() {
  if (!_memData) _memData = _lsLoad()
  return _memData
}

function _ensureCache() {
  if (!_memCache) _memCache = _lsLoadCache()
  return _memCache
}

// ═══════════════════════════════════════════════════
//  Persist — writes to ALL active storage layers
// ═══════════════════════════════════════════════════

async function _persistProject(proj) {
  const data = _ensureMem()
  // 1. localStorage (fast sync backup)
  _lsSave(data)
  // 2. IndexedDB (primary)
  await idbPut('projects', proj)
  await idbPut('meta', { activeId: data.activeId, projectIds: data.projects.map(p => ({ id: p.id, name: p.name })), updatedAt: new Date().toISOString() }, 'appMeta')
  // 3. File System (if connected)
  if (_fsReady) {
    await fsWrite(projFilename(proj.id), proj)
    await fsWrite('_refforge_meta.json', { activeId: data.activeId, projectIds: data.projects.map(p => ({ id: p.id, name: p.name })), updatedAt: new Date().toISOString() })
  }
}

async function _persistMeta() {
  const data = _ensureMem()
  _lsSave(data)
  const meta = { activeId: data.activeId, projectIds: data.projects.map(p => ({ id: p.id, name: p.name })), updatedAt: new Date().toISOString() }
  await idbPut('meta', meta, 'appMeta')
  if (_fsReady) await fsWrite('_refforge_meta.json', meta)
}

async function _persistAll() {
  const data = _ensureMem()
  _lsSave(data)
  const meta = { activeId: data.activeId, projectIds: data.projects.map(p => ({ id: p.id, name: p.name })), updatedAt: new Date().toISOString() }
  await idbPut('meta', meta, 'appMeta')
  for (const proj of data.projects) await idbPut('projects', proj)
  if (_fsReady) {
    await fsWrite('_refforge_meta.json', meta)
    for (const proj of data.projects) await fsWrite(projFilename(proj.id), proj)
  }
}

async function _persistCache() {
  const cache = _ensureCache()
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch {}
  await idbPut('meta', cache, 'paperCache')
  if (_fsReady) await fsWrite('_refforge_cache.json', cache)
}

// ═══════════════════════════════════════════════════
//  PUBLIC: Initialization
// ═══════════════════════════════════════════════════

export async function loadAll() {
  // Try IndexedDB first
  try {
    await openDB()
    _idbReady = true
    const meta = await idbGet('meta', 'appMeta')
    if (meta && meta.projectIds?.length > 0) {
      const projects = await idbGetAll('projects')
      // Sort to match meta order
      const ordered = []
      for (const entry of meta.projectIds) {
        const p = projects.find(x => x.id === entry.id)
        if (p) ordered.push(p)
      }
      _memData = { projects: ordered, activeId: meta.activeId }
      _lsSave(_memData) // sync to localStorage
      return _memData
    }
  } catch { _idbReady = false }

  // Try File System
  if (_fsReady && _dirHandle) {
    const meta = await fsRead('_refforge_meta.json')
    if (meta && meta.projectIds?.length > 0) {
      const projects = []
      for (const entry of meta.projectIds) {
        const proj = await fsRead(projFilename(entry.id))
        if (proj) projects.push(proj)
      }
      _memData = { projects, activeId: meta.activeId }
      // Migrate to IndexedDB
      if (_idbReady) await _persistAll()
      return _memData
    }
  }

  // Fall back to localStorage
  _memData = _lsLoad()
  // Migrate localStorage data to IndexedDB if any
  if (_idbReady && _memData.projects.length > 0) {
    await _persistAll()
  }
  return _memData
}

export async function loadCacheFromFS() {
  // Try IndexedDB first
  if (_idbReady) {
    const cached = await idbGet('meta', 'paperCache')
    if (cached && cached._v === CACHE_VERSION) { _memCache = cached; return }
  }
  // Try FS
  if (_fsReady) {
    const cached = await fsRead('_refforge_cache.json')
    if (cached && cached._v === CACHE_VERSION) {
      _memCache = cached
      if (_idbReady) await idbPut('meta', cached, 'paperCache')
      return
    }
  }
  // Fall back to localStorage
  _memCache = _lsLoadCache()
  if (_idbReady && Object.keys(_memCache).length > 1) {
    await idbPut('meta', _memCache, 'paperCache')
  }
}

// ═══════════════════════════════════════════════════
//  PUBLIC: Directory Connection (Chrome/Edge extra)
// ═══════════════════════════════════════════════════

export function isFileSystemSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export function isConnected() { return _fsReady && _dirHandle !== null }

export async function pickDirectory() {
  if (!isFileSystemSupported()) throw new Error('File System Access API not supported')
  try {
    _dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    _fsReady = true
    await _saveHandleToIDB(_dirHandle)
    // Sync current data to the new folder
    await _persistAll()
    await _persistCache()
    return true
  } catch (e) {
    if (e.name === 'AbortError') return false
    throw e
  }
}

export async function reconnectDirectory() {
  if (!isFileSystemSupported()) return false
  try {
    const handle = await _loadHandleFromIDB()
    if (!handle) return false
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') { _dirHandle = handle; _fsReady = true; return true }
    const req = await handle.requestPermission({ mode: 'readwrite' })
    if (req === 'granted') { _dirHandle = handle; _fsReady = true; return true }
    return false
  } catch { return false }
}

export async function disconnectDirectory() {
  _dirHandle = null; _fsReady = false
  await idbDelete('meta', 'dirHandle')
}

export function getDirectoryName() { return _dirHandle?.name || null }

// ═══════════════════════════════════════════════════
//  PUBLIC API — Project CRUD
// ═══════════════════════════════════════════════════

export function getProjects() { return _ensureMem().projects }
export function getActiveId() { return _ensureMem().activeId }

export function setActiveId(id) {
  _ensureMem().activeId = id
  _persistMeta()
}

export function createProject(name) {
  const d = _ensureMem(); const id = `proj_${Date.now()}`
  const proj = { id, name, papers: [], createdAt: new Date().toISOString() }
  d.projects.push(proj); d.activeId = id
  _persistProject(proj)
  return id
}

export function deleteProject(id) {
  const d = _ensureMem()
  d.projects = d.projects.filter(p => p.id !== id)
  if (d.activeId === id) d.activeId = d.projects[0]?.id || null
  _persistAll()
  idbDelete('projects', id)
  if (_fsReady) fsDelete(projFilename(id))
}

export function renameProject(id, name) {
  const d = _ensureMem(); const p = d.projects.find(x => x.id === id)
  if (p) { p.name = name; _persistProject(p) }
}

export function getActiveProject() {
  const d = _ensureMem(); return d.projects.find(p => p.id === d.activeId) || null
}

export function getProjectPapers(pid) {
  return (_ensureMem().projects.find(p => p.id === pid))?.papers || []
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
  _persistProject(proj)
  return true
}

export function removePaperFromProject(pid, index) {
  const p = _ensureMem().projects.find(x => x.id === pid)
  if (p) { p.papers.splice(index, 1); _persistProject(p) }
}

export function reorderPapers(pid, papers) {
  const p = _ensureMem().projects.find(x => x.id === pid)
  if (p) { p.papers = papers; _persistProject(p) }
}

// ═══════════════════════════════════════════════════
//  PUBLIC API — Cache
// ═══════════════════════════════════════════════════

export function getCachedPaper(id) { return _ensureCache()[id] || null }

export function cachePaper(id, paper) {
  const c = _ensureCache(); c[id] = paper; c._v = CACHE_VERSION
  _persistCache()
}

export function getCachedByTitle(title) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const nq = norm(title); if (!nq) return null
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
  idbPut('meta', _memCache, 'paperCache')
  if (_fsReady) fsDelete('_refforge_cache.json')
}

// ═══════════════════════════════════════════════════
//  Storage info
// ═══════════════════════════════════════════════════

export function getStorageInfo() {
  return {
    mode: _fsReady ? 'filesystem' : _idbReady ? 'indexedDB' : 'localStorage',
    folderName: _dirHandle?.name || null,
    supported: isFileSystemSupported(),
    idbReady: _idbReady
  }
}
