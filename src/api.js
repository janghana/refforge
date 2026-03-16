import { getCachedPaper, cachePaper, getCachedByTitle } from './store'

// ═══ Classification ═══
const DOI_RE = [/^(10\.\d{4,}\/\S+)$/, /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,}\/\S+)/]
const ARXIV_RE = [/^arxiv[:\s]*(\d{4}\.\d{4,5}(?:v\d+)?)$/i, /^(\d{4}\.\d{4,5}(?:v\d+)?)$/, /https?:\/\/arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/]

export function classify(line) {
  const t = line.trim()
  for (const p of DOI_RE) { const m = t.match(p); if (m) return { type: 'doi', value: m[1] } }
  for (const p of ARXIV_RE) { const m = t.match(p); if (m) return { type: 'arxiv', value: m[1] } }
  return { type: 'title', value: t }
}

// ═══ Helpers ═══
function ck(author, year, title) {
  const last = (author || 'unknown').split(' ').pop().toLowerCase().replace(/[^a-z]/g, '')
  const stops = new Set(['a','an','the','on','in','of','for','to','with','and','is','are','its'])
  const words = (title || '').match(/[a-zA-Z]+/g) || []
  const w = words.find(x => !stops.has(x.toLowerCase()))?.toLowerCase() || ''
  return `${last}${year}${w}`
}

// Exact normalized title comparison — strongly prefers exact matches
function titleMatch(query, candidate) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const nq = norm(query), nc = norm(candidate)
  if (!nq || !nc) return 0
  // Exact match → perfect score
  if (nq === nc) return 1.0
  // Candidate contains query (e.g. "Attention Is All You Need In Speech Separation" vs "Attention Is All You Need")
  // Penalize HARD: extra words = likely a different paper
  if (nc.includes(nq)) {
    const ratio = nq.length / nc.length
    return 0.3 + 0.3 * ratio  // same length → ~0.6, much longer → ~0.35
  }
  if (nq.includes(nc)) {
    const ratio = nc.length / nq.length
    return 0.3 + 0.3 * ratio
  }
  // Word-set overlap (fallback)
  const wa = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wb = new Set(candidate.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  let n = 0; for (const w of wa) if (wb.has(w)) n++
  return n / Math.max(wa.size, wb.size)
}

async function sf(url, opts = {}, ms = 12000) {
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); const r = await fetch(url, { ...opts, signal: c.signal }); clearTimeout(t); return r.ok ? r : null } catch { return null }
}

function buildUrl(ref) {
  if (ref.arxivId) return `https://arxiv.org/abs/${ref.arxivId}`
  if (ref.doi) return `https://doi.org/${ref.doi}`
  if (ref.s2Url) return ref.s2Url
  return ''
}

function buildBib(ref) {
  const ab = ref._ab || ref.authors?.replace(/, /g, ' and ') || ''
  const L = [`@article{${ref.citeKey},`, `  title = {${ref.title}},`, `  author = {${ab}},`]
  if (ref.journal && ref.journal !== 'arXiv preprint') L.push(`  journal = {${ref.journal}},`)
  if (ref.volume) L.push(`  volume = {${ref.volume}},`)
  if (ref.pages) L.push(`  pages = {${ref.pages}},`)
  L.push(`  year = {${ref.year}},`)
  if (ref.doi) L.push(`  doi = {${ref.doi}},`)
  if (ref.arxivId) { L.push(`  eprint = {${ref.arxivId}},`); L.push(`  archivePrefix = {arXiv},`) }
  if (ref.publisher) L.push(`  publisher = {${ref.publisher}}`)
  L.push('}')
  return L.join('\n')
}

function emptyRef() {
  return { citeKey: '', title: '', year: '', doi: '', arxivId: '', authors: '', authorCount: 0, _ab: '', journal: '', volume: '', pages: '', publisher: '', url: '', pdfUrl: '', venue: '', abstract: '', tldr: '', fields: [], citations: 0, s2Url: '', thumbnail: null, bib: '' }
}

// ═══ arXiv API ═══
async function arxivById(id) {
  const r = await sf(`https://export.arxiv.org/api/query?id_list=${id}`)
  if (!r) return null
  return parseArxivEntry(await r.text())
}

async function arxivSearchTitle(query) {
  // Build search query: ti:word1+AND+ti:word2+AND+...
  // Filter out short words, keep content words
  const words = query.split(/\s+/).filter(w => w.length > 2 && !/^(the|and|for|with|its|are)$/i.test(w))
  if (words.length === 0) return null
  const q = words.map(w => `ti:${encodeURIComponent(w)}`).join('+AND+')
  const url = `https://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=10&sortBy=relevance`
  const r = await sf(url)
  if (!r) return null
  const xml = await r.text()

  // Parse all entries, pick best match
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  let best = null, bestScore = -1
  for (const [, entry] of entries) {
    const ref = parseArxivEntryBlock(entry)
    if (!ref) continue
    const sim = titleMatch(query, ref.title)
    if (sim < 0.4) continue
    // Score: exact match bonus + similarity + prefer older papers (originals)
    const exactBonus = sim > 0.95 ? 500000 : 0
    const yearPenalty = parseInt(ref.year) || 2099
    const score = exactBonus + sim * 50000 - yearPenalty
    if (score > bestScore) { best = ref; bestScore = score }
  }
  return best
}

function parseArxivEntry(xml) {
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/)
  if (!entryMatch) return null
  return parseArxivEntryBlock(entryMatch[1])
}

function parseArxivEntryBlock(entry) {
  const tag = t => { const m = entry.match(new RegExp(`<${t}[^>]*>(.*?)</${t}>`, 's')); return m ? m[1].trim() : '' }
  const title = tag('title').replace(/\n/g, ' ').replace(/\s+/g, ' ')
  if (!title || title === 'Error') return null
  const year = (tag('published') || '').slice(0, 4) || '20xx'
  const names = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1])
  const idM = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/)
  const arxivId = idM ? idM[1].replace(/v\d+$/, '') : ''
  if (!arxivId) return null
  const dm = entry.match(/doi\.org\/(10\.\S+?)[<"']/)
  const k = ck(names[0] || '', year, title)
  return {
    ...emptyRef(), citeKey: k, title, year, doi: dm ? dm[1] : '', arxivId,
    authors: names.join(', '), authorCount: names.length, _ab: names.join(' and '),
    journal: 'arXiv preprint', url: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`, venue: 'arXiv',
    abstract: tag('summary').replace(/\n/g, ' ').replace(/\s+/g, ' '),
  }
}

// ═══ Crossref ═══
async function crByDOI(doi) {
  const r = await sf(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/json' } })
  if (!r) return null
  try { return (await r.json()).message } catch { return null }
}

async function crSearchTitle(query) {
  const r = await sf(`https://api.crossref.org/works?${new URLSearchParams({ 'query.title': query, rows: '15' })}`, { headers: { Accept: 'application/json' } })
  if (!r) return null
  try {
    const items = (await r.json()).message?.items || []
    // STRICT MATCHING: exact normalized title match preferred
    let candidates = []
    for (const item of items) {
      const t = (item.title || [''])[0]
      const sim = titleMatch(query, t)
      if (sim < 0.4) continue
      const yr = item.published?.['date-parts']?.[0]?.[0] || item.created?.['date-parts']?.[0]?.[0] || 9999
      const cited = item['is-referenced-by-count'] || 0
      candidates.push({ item, sim, yr, cited })
    }
    if (!candidates.length) return null
    // Sort: exact match first, then most cited, then oldest
    candidates.sort((a, b) => {
      // Exact match always wins
      const aExact = a.sim > 0.95 ? 1 : 0, bExact = b.sim > 0.95 ? 1 : 0
      if (aExact !== bExact) return bExact - aExact
      // Then most cited
      if (a.cited !== b.cited) return b.cited - a.cited
      // Then oldest
      return a.yr - b.yr
    })
    return candidates[0].item
  } catch { return null }
}

function crToRef(cr) {
  if (!cr) return null
  const ab = (cr.author || []).map(a => `${a.family || ''}, ${a.given || ''}`).join(' and ')
  const as = (cr.author || []).map(a => `${a.given || ''} ${a.family || ''}`).join(', ')
  const t = (cr.title || [''])[0]; const y = String(cr.published?.['date-parts']?.[0]?.[0] || cr.created?.['date-parts']?.[0]?.[0] || 'n.d.')
  const j = (cr['container-title'] || [''])[0]; const v = cr.volume || ''; const pg = cr.page || ''; const doi = cr.DOI || ''; const pub = cr.publisher || ''
  const fa = (cr.author || [])[0]; const k = ck(fa ? `${fa.given} ${fa.family}` : '', y, t)
  return { ...emptyRef(), citeKey: k, title: t, year: y, doi, authors: as, authorCount: (cr.author || []).length, _ab: ab, journal: j, volume: v, pages: pg, publisher: pub, url: doi ? `https://doi.org/${doi}` : '', venue: j }
}

function crUpgrade(ref, cr) {
  if (!cr) return ref
  const j = (cr['container-title'] || [''])[0]; if (!j) return ref
  const v = cr.volume || ''; const pg = cr.page || ''; const y = String(cr.published?.['date-parts']?.[0]?.[0] || ref.year); const pub = cr.publisher || ''
  const ab = (cr.author || []).map(a => `${a.family || ''}, ${a.given || ''}`).join(' and ')
  const fa = (cr.author || [])[0]
  ref.journal = j; ref.venue = ref.venue || j; ref.volume = v; ref.pages = pg; ref.year = y; ref.publisher = pub; ref._ab = ab
  ref.citeKey = ck(fa ? `${fa.given} ${fa.family}` : ref.authors?.split(', ')[0] || '', y, ref.title)
  if (cr.author?.length) { ref.authors = (cr.author || []).map(a => `${a.given || ''} ${a.family || ''}`).join(', '); ref.authorCount = cr.author.length }
  return ref
}

// ═══ Semantic Scholar ═══
const S2F = 'paperId,title,abstract,authors,year,venue,externalIds,openAccessPdf,tldr,fieldsOfStudy,citationCount,url'

async function s2Enrich(ref) {
  try {
    const id = ref.arxivId ? `ARXIV:${ref.arxivId}` : ref.doi ? `DOI:${ref.doi}` : null
    if (!id) return ref
    const r = await sf(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${S2F}`, {}, 6000)
    if (!r) return ref
    const d = await r.json(); if (!d || d.error) return ref
    ref.abstract = d.abstract || ref.abstract || ''; ref.tldr = d.tldr?.text || ref.tldr || ''
    ref.fields = d.fieldsOfStudy || ref.fields || []; ref.citations = d.citationCount || ref.citations || 0
    ref.s2Url = d.url || ''; ref.pdfUrl = d.openAccessPdf?.url || ref.pdfUrl || ''
    ref.venue = d.venue || ref.venue || ''
    if (!ref.doi && d.externalIds?.DOI) ref.doi = d.externalIds.DOI
    if (!ref.arxivId && d.externalIds?.ArXiv) ref.arxivId = d.externalIds.ArXiv
  } catch {}
  return ref
}

function s2ItemToRef(item) {
  const authors = (item.authors || []).map(a => a.name)
  const year = String(item.year || 'n.d.'); const doi = item.externalIds?.DOI || ''; const arxivId = item.externalIds?.ArXiv || ''
  const k = ck(authors[0] || '', year, item.title || '')
  return { ...emptyRef(), citeKey: k, title: item.title || '', year, doi, arxivId, authors: authors.join(', '), authorCount: authors.length, _ab: authors.join(' and '), journal: item.venue || '', url: arxivId ? `https://arxiv.org/abs/${arxivId}` : (doi ? `https://doi.org/${doi}` : item.url || ''), pdfUrl: item.openAccessPdf?.url || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : ''), venue: item.venue || '', abstract: item.abstract || '', tldr: item.tldr?.text || '', fields: item.fieldsOfStudy || [], citations: item.citationCount || 0, s2Url: item.url || '' }
}

// S2 Match endpoint — designed for exact title lookup
async function s2MatchTitle(query) {
  try {
    const r = await sf(`https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(query)}&fields=${S2F}`, {}, 8000)
    if (!r) return null
    const d = await r.json(); const items = d.data || []
    if (!items.length) return null
    // Match endpoint returns best match first; verify similarity
    const best = items[0]
    const sim = titleMatch(query, best.title || '')
    if (sim < 0.7) return null
    return s2ItemToRef(best)
  } catch { return null }
}

async function s2SearchTitle(query) {
  try {
    const r = await sf(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=10&fields=${S2F}`, {}, 8000)
    if (!r) return null
    const d = await r.json(); const items = d.data || []
    let best = null, bestScore = -1
    for (const item of items) {
      const sim = titleMatch(query, item.title || '')
      if (sim < 0.4) continue
      // Exact match gets massive bonus — always pick the exact title
      const exactBonus = sim > 0.95 ? 500000 : 0
      const cit = item.citationCount || 0
      const score = exactBonus + sim * 50000 + Math.log10(cit + 1) * 10000
      if (score > bestScore) { best = item; bestScore = score }
    }
    if (!best) return null
    return s2ItemToRef(best)
  } catch { return null }
}

// ═══ PUBLIC API ═══

export async function fetchByDOI(doi) {
  const cached = getCachedPaper(`doi:${doi}`); if (cached) return cached
  const cr = await crByDOI(doi); let ref = crToRef(cr)
  if (!ref) throw new Error(`DOI not found: ${doi}`)
  ref = await s2Enrich(ref)
  ref.bib = buildBib(ref); ref.url = buildUrl(ref)
  cachePaper(`doi:${doi}`, ref); return ref
}

export async function fetchByArxiv(id) {
  const cached = getCachedPaper(`arxiv:${id}`); if (cached) return cached
  // arXiv ONLY — no Crossref fallback that could return wrong paper
  let ref = await arxivById(id)
  if (!ref) throw new Error(`arXiv ${id} not found. Check ID or network.`)
  ref = await s2Enrich(ref)
  if (ref.doi) { const cr = await crByDOI(ref.doi); ref = crUpgrade(ref, cr) }
  ref.bib = buildBib(ref); ref.url = buildUrl(ref)
  cachePaper(`arxiv:${id}`, ref); return ref
}

export async function fetchByTitle(title) {
  const cacheId = `title:${title.toLowerCase().trim()}`
  const cached = getCachedPaper(cacheId); if (cached) return cached
  // Fuzzy title cache lookup (catches slightly different input for same paper)
  const fuzzyHit = getCachedByTitle(title); if (fuzzyHit) { cachePaper(cacheId, fuzzyHit); return fuzzyHit }

  // ── Strategy: try S2 match first (exact title), then all sources in parallel ──
  const [s2Match, s2Result, arxivResult, crResult] = await Promise.all([
    s2MatchTitle(title),
    s2SearchTitle(title),
    arxivSearchTitle(title),
    crSearchTitle(title).then(cr => crToRef(cr)),
  ])

  // Score each result: exact match >>> citation count >>> similarity
  function score(ref) {
    if (!ref) return -1
    const sim = titleMatch(title, ref.title)
    const cit = ref.citations || 0
    // Exact title match (sim=1.0) gets massive bonus so it always wins
    const exactBonus = sim > 0.95 ? 500000 : 0
    // Citation weight: heavily favor highly-cited originals
    const citScore = Math.log10(cit + 1) * 10000
    return exactBonus + sim * 50000 + citScore
  }

  const candidates = [
    { ref: s2Match, src: 's2match' },
    { ref: s2Result, src: 's2' },
    { ref: arxivResult, src: 'arxiv' },
    { ref: crResult, src: 'cr' },
  ].filter(c => c.ref).sort((a, b) => score(b.ref) - score(a.ref))

  if (candidates.length === 0) throw new Error(`No match for: "${title}"`)

  let ref = candidates[0].ref

  // Enrich
  ref = await s2Enrich(ref)
  if (ref.doi && !ref.journal) { const cr = await crByDOI(ref.doi); ref = crUpgrade(ref, cr) }

  ref.bib = buildBib(ref); ref.url = buildUrl(ref)
  cachePaper(cacheId, ref); return ref
}

// ═══ Author Helpers ═══
function _authorList(authors, style = 'full') {
  if (!authors) return ''
  const list = authors.split(', ').map(a => a.trim()).filter(Boolean)
  if (list.length === 0) return ''

  // Parse "First Last" → { first, last }
  const parsed = list.map(a => {
    const parts = a.split(' ')
    const last = parts.pop()
    const first = parts.join(' ')
    return { first, last, full: a }
  })

  if (style === 'apa') {
    // APA: Last, F. I., Last, F. I., & Last, F. I.
    const fmt = p => `${p.last}, ${p.first.split(' ').map(n => n[0] + '.').join(' ')}`
    if (parsed.length === 1) return fmt(parsed[0])
    if (parsed.length === 2) return `${fmt(parsed[0])}, & ${fmt(parsed[1])}`
    if (parsed.length <= 20) return parsed.slice(0, -1).map(fmt).join(', ') + ', & ' + fmt(parsed[parsed.length - 1])
    return parsed.slice(0, 19).map(fmt).join(', ') + ', ... ' + fmt(parsed[parsed.length - 1])
  }

  if (style === 'mla') {
    // MLA: Last, First, et al.
    if (parsed.length === 1) return `${parsed[0].last}, ${parsed[0].first}`
    if (parsed.length === 2) return `${parsed[0].last}, ${parsed[0].first}, and ${parsed[1].full}`
    return `${parsed[0].last}, ${parsed[0].first}, et al.`
  }

  if (style === 'chicago') {
    // Chicago: Last, First, First Last, and First Last.
    if (parsed.length === 1) return `${parsed[0].last}, ${parsed[0].first}`
    if (parsed.length <= 3) return `${parsed[0].last}, ${parsed[0].first}, ` + parsed.slice(1, -1).map(p => p.full).join(', ') + (parsed.length > 2 ? ', ' : '') + `and ${parsed[parsed.length - 1].full}`
    return `${parsed[0].last}, ${parsed[0].first}, ${parsed[1].full}, ${parsed[2].full}, et al.`
  }

  if (style === 'vancouver') {
    // Vancouver: Last FI, Last FI, Last FI.
    const fmt = p => `${p.last} ${p.first.split(' ').map(n => n[0]).join('')}`
    if (parsed.length <= 6) return parsed.map(fmt).join(', ')
    return parsed.slice(0, 6).map(fmt).join(', ') + ', et al'
  }

  if (style === 'ieee') {
    // IEEE: F. I. Last, F. I. Last, and F. I. Last
    const fmt = p => `${p.first.split(' ').map(n => n[0] + '.').join(' ')} ${p.last}`
    if (parsed.length === 1) return fmt(parsed[0])
    if (parsed.length === 2) return `${fmt(parsed[0])} and ${fmt(parsed[1])}`
    return parsed.slice(0, -1).map(fmt).join(', ') + ', and ' + fmt(parsed[parsed.length - 1])
  }

  return authors // fallback: as-is
}

// ═══ Formatters ═══

export function formatBib(refs) { return refs.filter(r => !r.error).map(r => r.bib).join('\n\n') }

export function formatNumbered(refs) {
  return refs.filter(r => !r.error).map((r, i) => {
    const p = [`[${i + 1}]`]; if (r.authors) p.push(r.authors + '.'); if (r.title) p.push(r.title + '.')
    if (r.journal && r.journal !== 'arXiv preprint') p.push(r.journal + '.')
    const vp = [r.year, r.volume ? `;${r.volume}` : '', r.pages ? `:${r.pages}` : ''].join('')
    if (vp) p.push(vp + '.'); if (r.doi) p.push(`doi:${r.doi}`)
    if (r.arxivId) p.push(`arXiv:${r.arxivId}`)
    return p.join(' ')
  }).join('\n\n')
}

// APA 7th: Author, A. B., & Author, C. D. (Year). Title. Journal, Volume(Issue), Pages. https://doi.org/xxx
export function formatAPA(refs) {
  return refs.filter(r => !r.error).map(r => {
    const parts = []
    parts.push(_authorList(r.authors, 'apa'))
    parts.push(` (${r.year || 'n.d.'}).`)
    parts.push(` ${r.title}.`)
    if (r.journal && r.journal !== 'arXiv preprint') {
      let j = ` _${r.journal}_`
      if (r.volume) j += `, _${r.volume}_`
      if (r.pages) j += `, ${r.pages}`
      j += '.'
      parts.push(j)
    }
    if (r.doi) parts.push(` https://doi.org/${r.doi}`)
    else if (r.arxivId) parts.push(` https://arxiv.org/abs/${r.arxivId}`)
    return parts.join('')
  }).join('\n\n')
}

// MLA 9th: Last, First, et al. "Title." Journal, vol. X, no. Y, Year, pp. Pages.
export function formatMLA(refs) {
  return refs.filter(r => !r.error).map(r => {
    const parts = []
    parts.push(_authorList(r.authors, 'mla') + '.')
    parts.push(` "${r.title}."`)
    if (r.journal && r.journal !== 'arXiv preprint') {
      let j = ` _${r.journal}_`
      if (r.volume) j += `, vol. ${r.volume}`
      if (r.year) j += `, ${r.year}`
      if (r.pages) j += `, pp. ${r.pages}`
      j += '.'
      parts.push(j)
    } else {
      if (r.year) parts.push(` ${r.year}.`)
    }
    if (r.doi) parts.push(` https://doi.org/${r.doi}`)
    return parts.join('')
  }).join('\n\n')
}

// Chicago 17th (Author-Date): Last, First, First Last, and First Last. Year. "Title." Journal Volume (Issue): Pages.
export function formatChicago(refs) {
  return refs.filter(r => !r.error).map(r => {
    const parts = []
    parts.push(_authorList(r.authors, 'chicago') + '.')
    parts.push(` ${r.year || 'n.d.'}.`)
    parts.push(` "${r.title}."`)
    if (r.journal && r.journal !== 'arXiv preprint') {
      let j = ` _${r.journal}_`
      if (r.volume) j += ` ${r.volume}`
      if (r.pages) j += `: ${r.pages}`
      j += '.'
      parts.push(j)
    }
    if (r.doi) parts.push(` https://doi.org/${r.doi}`)
    return parts.join('')
  }).join('\n\n')
}

// Vancouver (ICMJE): 1. Last FI, Last FI. Title. Journal. Year;Volume:Pages.
export function formatVancouver(refs) {
  return refs.filter(r => !r.error).map((r, i) => {
    const parts = []
    parts.push(`${i + 1}. `)
    parts.push(_authorList(r.authors, 'vancouver') + '.')
    parts.push(` ${r.title}.`)
    if (r.journal && r.journal !== 'arXiv preprint') {
      let j = ` ${r.journal}.`
      j += ` ${r.year || ''}`
      if (r.volume) j += `;${r.volume}`
      if (r.pages) j += `:${r.pages}`
      j += '.'
      parts.push(j)
    } else {
      if (r.year) parts.push(` ${r.year}.`)
    }
    if (r.doi) parts.push(` doi:${r.doi}`)
    return parts.join('')
  }).join('\n\n')
}

// IEEE: [1] F. I. Last, F. I. Last, and F. I. Last, "Title," Journal, vol. X, pp. Pages, Year.
export function formatIEEE(refs) {
  return refs.filter(r => !r.error).map((r, i) => {
    const parts = []
    parts.push(`[${i + 1}] `)
    parts.push(_authorList(r.authors, 'ieee'))
    parts.push(`, "${r.title},"`)
    if (r.journal && r.journal !== 'arXiv preprint') {
      parts.push(` _${r.journal}_`)
      if (r.volume) parts.push(`, vol. ${r.volume}`)
      if (r.pages) parts.push(`, pp. ${r.pages}`)
    }
    if (r.year) parts.push(`, ${r.year}`)
    parts.push('.')
    if (r.doi) parts.push(` doi:${r.doi}`)
    return parts.join('')
  }).join('\n\n')
}

// ═══ Export Formats ═══

// RIS (EndNote / RefMan compatible)
export function formatRIS(refs) {
  return refs.filter(r => !r.error).map(r => {
    const L = ['TY  - JOUR']
    if (r.title) L.push(`TI  - ${r.title}`)
    if (r.authors) r.authors.split(', ').forEach(a => L.push(`AU  - ${a}`))
    if (r.year) L.push(`PY  - ${r.year}`)
    if (r.journal) L.push(`JO  - ${r.journal}`)
    if (r.volume) L.push(`VL  - ${r.volume}`)
    if (r.pages) { const [sp, ep] = r.pages.split('-'); L.push(`SP  - ${sp}`); if (ep) L.push(`EP  - ${ep}`) }
    if (r.doi) L.push(`DO  - ${r.doi}`)
    if (r.url) L.push(`UR  - ${r.url}`)
    if (r.abstract) L.push(`AB  - ${r.abstract}`)
    if (r.publisher) L.push(`PB  - ${r.publisher}`)
    L.push('ER  - ')
    return L.join('\n')
  }).join('\n\n')
}

// RefWorks Tagged Format
export function formatRefWorks(refs) {
  return refs.filter(r => !r.error).map(r => {
    const L = ['RT Journal Article']
    if (r.title) L.push(`T1 ${r.title}`)
    if (r.authors) r.authors.split(', ').forEach(a => L.push(`A1 ${a}`))
    if (r.year) L.push(`YR ${r.year}`)
    if (r.journal) L.push(`JF ${r.journal}`)
    if (r.volume) L.push(`VO ${r.volume}`)
    if (r.pages) L.push(`SP ${r.pages}`)
    if (r.doi) L.push(`DO ${r.doi}`)
    if (r.url) L.push(`UL ${r.url}`)
    if (r.abstract) L.push(`AB ${r.abstract}`)
    return L.join('\n')
  }).join('\n\n')
}
