const STORAGE_KEY = 'refforge_data'

function load() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return { projects: [], activeId: null }; return JSON.parse(raw) } catch { return { projects: [], activeId: null } }
}
function save(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {} }

export function getProjects() { return load().projects }
export function getActiveId() { return load().activeId }
export function setActiveId(id) { const d = load(); d.activeId = id; save(d) }

export function createProject(name) {
  const d = load(); const id = `proj_${Date.now()}`
  d.projects.push({ id, name, papers: [], createdAt: new Date().toISOString() })
  d.activeId = id; save(d); return id
}
export function deleteProject(id) { const d = load(); d.projects = d.projects.filter(p => p.id !== id); if (d.activeId === id) d.activeId = d.projects[0]?.id || null; save(d) }
export function renameProject(id, name) { const d = load(); const p = d.projects.find(x => x.id === id); if (p) p.name = name; save(d) }
export function getActiveProject() { const d = load(); return d.projects.find(p => p.id === d.activeId) || null }
export function getProjectPapers(pid) { const d = load(); return (d.projects.find(p => p.id === pid))?.papers || [] }

export function addPaperToProject(pid, paper) {
  const d = load(); const proj = d.projects.find(p => p.id === pid); if (!proj) return false
  // Check duplicate by DOI or arXiv ID
  const dupIdx = proj.papers.findIndex(p => {
    if (paper.doi && p.doi && paper.doi === p.doi) return true
    if (paper.arxivId && p.arxivId && paper.arxivId === p.arxivId) return true
    return false
  })
  if (dupIdx >= 0) return false // exact ID duplicate → skip

  // If same-ish title exists, REPLACE it (fixes wrong cached results)
  const titleIdx = proj.papers.findIndex(p =>
    p.title && paper.title && p.title.toLowerCase().trim() === paper.title.toLowerCase().trim()
  )
  if (titleIdx >= 0) {
    proj.papers[titleIdx] = { ...paper, addedAt: new Date().toISOString() }
  } else {
    proj.papers.push({ ...paper, addedAt: new Date().toISOString() })
  }
  save(d); return true
}

export function removePaperFromProject(pid, index) { const d = load(); const p = d.projects.find(x => x.id === pid); if (p) { p.papers.splice(index, 1); save(d) } }
export function reorderPapers(pid, papers) { const d = load(); const p = d.projects.find(x => x.id === pid); if (p) { p.papers = papers; save(d) } }

// ─── Cache with version ───
const CACHE_KEY = 'refforge_cache'
const CACHE_VERSION = 'v6'

function loadCache() {
  try { const r = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); if (r._v !== CACHE_VERSION) { localStorage.removeItem(CACHE_KEY); return { _v: CACHE_VERSION } }; return r } catch { return { _v: CACHE_VERSION } }
}
export function getCachedPaper(id) { return loadCache()[id] || null }
export function cachePaper(id, paper) { try { const c = loadCache(); c[id] = paper; c._v = CACHE_VERSION; localStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch {} }

// Fuzzy title lookup: normalize and search all cached papers by title
export function getCachedByTitle(title) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const nq = norm(title)
  if (!nq) return null
  const cache = loadCache()
  for (const [key, paper] of Object.entries(cache)) {
    if (key === '_v') continue
    if (paper?.title && norm(paper.title) === nq) return paper
  }
  return null
}

export function clearAllCache() { localStorage.removeItem(CACHE_KEY) }
