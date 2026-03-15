import { useState, useCallback, useEffect } from 'react'
import { classify, fetchByDOI, fetchByArxiv, fetchByTitle, formatBib, formatNumbered } from './api'
import * as store from './store'
import './index.css'

const PLACEHOLDER = `e.g.,
10.1016/j.media.2024.103064
1706.03762
https://arxiv.org/abs/2010.11929
Attention Is All You Need`

// ═══ Atoms ═══
const TypeBadge = ({ type }) => {
  const c = { doi: { bg: '#dbeafe', fg: '#1d4ed8' }, arxiv: { bg: '#fce7f3', fg: '#be185d' }, title: { bg: '#e0e7ff', fg: '#4338ca' } }[type] || { bg: '#e0e7ff', fg: '#4338ca' }
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: c.bg, color: c.fg, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{type}</span>
}
const Spinner = () => <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #bfdbfe', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin .5s linear infinite' }} />
const StatusIcon = ({ status }) => {
  if (status === 'loading') return <Spinner />
  if (status === 'done') return <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
  if (status === 'error') return <span style={{ color: '#ef4444', fontSize: 12 }}>✗</span>
  return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#cbd5e1' }} />
}

// ═══ Sidebar ═══
function Sidebar({ projects, activeId, onSelect, onCreate, onDelete, onRename }) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const submit = () => {
    const name = newName.trim()
    if (name) { onCreate(name); setNewName(''); setCreating(false) }
  }

  return (
    <div style={{ width: 260, minWidth: 260, height: '100vh', background: '#f8fafc', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg,#3b82f6,#60a5fa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📎</div>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>RefForge</span>
        </div>
        <button onClick={() => setCreating(true)} style={{ width: '100%', padding: '8px 12px', background: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: 'white', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(37,99,235,0.2)' }}>
          + New Project
        </button>
      </div>

      {/* New project input */}
      {creating && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: '#eff6ff' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Project name"
            autoFocus onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setCreating(false) }}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #bfdbfe', borderRadius: 6, fontFamily: 'inherit', fontSize: 12, outline: 'none', background: 'white' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={submit} style={{ flex: 1, padding: '5px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Create</button>
            <button onClick={() => setCreating(false)} style={{ flex: 1, padding: '5px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Project list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
        {projects.length === 0 && !creating && (
          <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94a3b8', fontSize: 12 }}>No projects yet</div>
        )}
        {projects.map(proj => {
          const isActive = proj.id === activeId
          const isEditing = editingId === proj.id
          return (
            <div key={proj.id}
              onClick={() => !isEditing && onSelect(proj.id)}
              style={{
                padding: '9px 10px', borderRadius: 8, marginBottom: 2, cursor: 'pointer',
                background: isActive ? '#eff6ff' : 'transparent',
                border: isActive ? '1px solid #bfdbfe' : '1px solid transparent',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f1f5f9' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              {isEditing ? (
                <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') { onRename(proj.id, editName); setEditingId(null) }; if (e.key === 'Escape') setEditingId(null) }}
                  onBlur={() => { onRename(proj.id, editName); setEditingId(null) }}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '100%', padding: '3px 6px', border: '1px solid #bfdbfe', borderRadius: 4, fontFamily: 'inherit', fontSize: 12, outline: 'none' }} />
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: isActive ? 600 : 500, color: isActive ? '#1d4ed8' : '#334155', lineHeight: 1.3 }}>📁 {proj.name}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{proj.papers?.length || 0} papers</div>
                  </div>
                  {isActive && (
                    <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingId(proj.id); setEditName(proj.name) }} style={{ width: 22, height: 22, background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: '#94a3b8' }} title="Rename">✎</button>
                      <button onClick={() => { if (confirm('Delete this project?')) onDelete(proj.id) }} style={{ width: 22, height: 22, background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: '#94a3b8' }} title="Delete">✕</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {/* Clear cache button */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid #e2e8f0' }}>
        <button onClick={() => { if (confirm('Clear all API cache?')) { import('./store').then(s => { s.clearAllCache(); alert('Cache cleared. Re-add papers to fetch fresh data.') }) } }}
          style={{ width: '100%', padding: '5px', background: 'none', color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
          Clear cache
        </button>
      </div>
    </div>
  )
}

// ═══ Paper Card (right panel) ═══
function PaperCard({ paper, index, onRemove }) {
  const short = paper.authorCount > 4 ? paper.authors.split(', ').slice(0, 3).join(', ') + ' et al.' : paper.authors
  const hasUrl = paper.url?.length > 5, hasPdf = paper.pdfUrl?.length > 5
  return (
    <div style={{ background: index % 2 === 0 ? 'white' : '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', marginBottom: 6, animation: 'slideUp 0.2s ease', position: 'relative' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#93c5fd' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0' }}>
      {/* Remove btn */}
      <button onClick={() => onRemove(index)} style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, background: 'none', border: 'none', fontSize: 12, cursor: 'pointer', color: '#cbd5e1', borderRadius: 4 }}
        onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = '#cbd5e1'}>✕</button>
      {/* Num + Title */}
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 3, paddingRight: 20 }}>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', minWidth: 18 }}>{index + 1}.</span>
        <a href={hasUrl ? paper.url : `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.35, textDecoration: 'none', flex: 1 }} onMouseEnter={e => e.target.style.color = '#2563eb'} onMouseLeave={e => e.target.style.color = '#0f172a'}>{paper.title}</a>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, paddingLeft: 25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{short}</div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 25 }}>
        <span style={{ fontSize: 9, background: '#eff6ff', padding: '1px 6px', borderRadius: 3, color: '#2563eb', fontWeight: 600 }}>{paper.year}</span>
        {paper.venue && <span style={{ fontSize: 9, background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, color: '#475569', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{paper.venue}</span>}
        {paper.citations > 0 && <span style={{ fontSize: 9, color: '#94a3b8' }}>cited {paper.citations.toLocaleString()}</span>}
        <span style={{ flex: 1 }} />
        {hasUrl && <a href={paper.url} target="_blank" rel="noreferrer" style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, textDecoration: 'none', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>Paper ↗</a>}
        {hasPdf && <a href={paper.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, textDecoration: 'none', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>PDF ↗</a>}
        {paper.s2Url && <a href={paper.s2Url} target="_blank" rel="noreferrer" style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, textDecoration: 'none', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>S2 ↗</a>}
        <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noreferrer" style={{ fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 4, textDecoration: 'none', background: '#fefce8', color: '#a16207', border: '1px solid #fde68a' }}>Scholar ↗</a>
      </div>
    </div>
  )
}

// ═══ Main App ═══
export default function App() {
  const [projects, setProjects] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [input, setInput] = useState('')
  const [statuses, setStatuses] = useState([])
  const [types, setTypes] = useState([])
  const [processing, setProcessing] = useState(false)
  const [mode, setMode] = useState('bib')
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Load from localStorage
  useEffect(() => {
    setProjects(store.getProjects())
    setActiveId(store.getActiveId())
  }, [])

  const refresh = () => { setProjects(store.getProjects()); setActiveId(store.getActiveId()) }
  const activeProject = projects.find(p => p.id === activeId) || null
  const papers = activeProject?.papers || []
  const valid = papers.filter(r => !r.error)

  const entries = input.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
  const count = entries.length
  const sN = statuses.filter(s => s === 'done').length
  const eN = statuses.filter(s => s === 'error').length

  const output = mode === 'bib' ? formatBib(valid) : formatNumbered(valid)

  // ─── Actions ───
  const createProject = (name) => { store.createProject(name); refresh() }
  const selectProject = (id) => { store.setActiveId(id); refresh(); setStatuses([]); setTypes([]) }
  const deleteProject = (id) => { store.deleteProject(id); refresh() }
  const renameProject = (id, name) => { if (name.trim()) store.renameProject(id, name.trim()); refresh() }
  const removePaper = (idx) => { if (activeId) { store.removePaperFromProject(activeId, idx); refresh() } }

  const run = useCallback(async () => {
    if (!activeId) { alert('Create a project first'); return }
    const lines = input.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    if (!lines.length) return
    setProcessing(true)
    const cls = lines.map(l => classify(l))
    setTypes(cls.map(c => c.type))
    setStatuses(lines.map(() => 'pending'))
    let added = 0
    for (let i = 0; i < lines.length; i++) {
      setStatuses(p => p.map((s, j) => j === i ? 'loading' : s))
      try {
        let r
        if (cls[i].type === 'doi') r = await fetchByDOI(cls[i].value)
        else if (cls[i].type === 'arxiv') r = await fetchByArxiv(cls[i].value)
        else r = await fetchByTitle(cls[i].value)
        const wasAdded = store.addPaperToProject(activeId, r)
        setStatuses(p => p.map((s, j) => j === i ? 'done' : s))
        if (wasAdded) added++
        refresh()
      } catch (err) {
        setStatuses(p => p.map((s, j) => j === i ? 'error' : s))
      }
      if (i < lines.length - 1) await new Promise(r => setTimeout(r, 500))
    }
    setProcessing(false)
    if (added > 0) setInput('')
  }, [input, activeId])

  const cp = () => { navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1800) }
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([output], { type: 'text/plain' })); a.download = mode === 'bib' ? `${activeProject?.name || 'refs'}.bib` : `${activeProject?.name || 'refs'}.txt`; a.click() }
  const drop = e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) { const r = new FileReader(); r.onload = ev => setInput(ev.target.result); r.readAsText(f) } }

  const ST = {
    card: { background: 'rgba(255,255,255,0.95)', border: '1px solid #e0eafc', borderRadius: 12, boxShadow: '0 1px 3px rgba(148,163,184,0.06)' },
    tog: { display: 'inline-flex', background: '#f1f5f9', borderRadius: 7, padding: 2 },
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'IBM Plex Sans',-apple-system,sans-serif" }}>
      {/* ═══ SIDEBAR ═══ */}
      <Sidebar projects={projects} activeId={activeId} onSelect={selectProject} onCreate={createProject} onDelete={deleteProject} onRename={renameProject} />

      {/* ═══ CENTER ═══ */}
      <div style={{ flex: 5, display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 18px', overflowY: 'auto', background: 'linear-gradient(180deg, #f0f5ff 0%, #f8fafc 100%)' }}>
        {!activeId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📎</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>RefForge</div>
              <div style={{ fontSize: 13 }}>Create a project to get started</div>
            </div>
          </div>
        ) : (
          <>
            {/* Project title */}
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>📁 {activeProject?.name}</div>

            {/* Input */}
            <div style={{ ...ST.card, padding: '16px 18px' }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={drop}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Add references</span>
                <span className="mono" style={{ fontSize: 10, color: '#94a3b8' }}>{count > 0 ? `${count} entries` : 'one per line'}</span>
              </div>
              <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={PLACEHOLDER}
                style={{ width: '100%', minHeight: 220, background: dragOver ? '#eff6ff' : '#f8fafc', border: `1.5px ${dragOver ? 'solid #60a5fa' : 'dashed #cbd5e1'}`, borderRadius: 8, padding: '10px 12px', color: '#1e293b', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, lineHeight: 1.8, resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: 'all 0.2s' }}
                onFocus={e => { e.target.style.borderColor = '#60a5fa'; e.target.style.borderStyle = 'solid'; e.target.style.boxShadow = '0 0 0 3px rgba(96,165,250,0.12)' }}
                onBlur={e => { e.target.style.borderColor = '#cbd5e1'; e.target.style.borderStyle = 'dashed'; e.target.style.boxShadow = 'none' }} />
              {/* Line preview with alternating colors */}
              {entries.length > 0 && (
                <div style={{ marginTop: 8, borderRadius: 6, overflow: 'hidden', border: '1px solid #e2e8f0', maxHeight: 160, overflowY: 'auto' }}>
                  {entries.map((line, i) => {
                    const cls = classify(line.trim())
                    const typeColor = { doi: '#dbeafe', arxiv: '#fce7f3', title: '#eef2ff' }[cls.type] || '#eef2ff'
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: i % 2 === 0 ? '#ffffff' : typeColor, borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                        <span className="mono" style={{ fontSize: 9, color: '#94a3b8', minWidth: 18, textAlign: 'right' }}>{i + 1}</span>
                        <TypeBadge type={cls.type} />
                        <span className="mono" style={{ fontSize: 11, color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.trim()}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <button onClick={run} disabled={processing || count === 0}
                  style={{ padding: '8px 22px', background: processing ? '#94a3b8' : 'linear-gradient(135deg,#3b82f6,#2563eb)', color: 'white', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: processing ? 'wait' : 'pointer', boxShadow: processing ? 'none' : '0 2px 8px rgba(37,99,235,0.2)' }}>
                  {processing ? `${sN}/${count}` : 'Add'}
                </button>
                {count > 0 && !processing && <button onClick={() => setInput('')} style={{ padding: '8px 14px', background: 'none', color: '#94a3b8', border: 'none', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' }}>Clear</button>}
              </div>
            </div>

            {/* Progress */}
            {statuses.length > 0 && (
              <div style={{ ...ST.card, padding: '12px 16px', animation: 'slideUp 0.2s ease' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>Progress</span>
                  <div className="mono" style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                    {sN > 0 && <span style={{ color: '#16a34a' }}>✓ {sN}</span>}
                    {eN > 0 && <span style={{ color: '#ef4444' }}>✗ {eN}</span>}
                  </div>
                </div>
                <div style={{ height: 2, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg,#3b82f6,#22c55e)', transition: 'width 0.5s ease', width: `${((sN + eN) / statuses.length) * 100}%` }} />
                </div>
                <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                  {entries.map((line, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 4, background: i % 2 === 0 ? 'transparent' : '#f8fafc' }}>
                      <span className="mono" style={{ fontSize: 9, color: '#cbd5e1', minWidth: 16, textAlign: 'right' }}>{i + 1}</span>
                      <StatusIcon status={statuses[i]} />
                      <TypeBadge type={types[i] || 'title'} />
                      <span className="mono" style={{ fontSize: 10.5, flex: 1, color: statuses[i] === 'error' ? '#dc2626' : statuses[i] === 'done' ? '#15803d' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Output */}
            {valid.length > 0 && (
              <div style={{ ...ST.card, padding: '14px 18px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                  <div style={ST.tog}>
                    {[{ k: 'bib', l: 'BibTeX' }, { k: 'numbered', l: '[1] Numbered' }].map(({ k, l }) => (
                      <button key={k} onClick={() => setMode(k)} style={{ padding: '4px 12px', border: 'none', borderRadius: 5, fontFamily: 'inherit', fontSize: 11, fontWeight: mode === k ? 600 : 400, color: mode === k ? '#2563eb' : '#64748b', background: mode === k ? 'white' : 'transparent', cursor: 'pointer', boxShadow: mode === k ? '0 1px 3px rgba(0,0,0,0.05)' : 'none' }}>{l}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={cp} style={{ padding: '4px 10px', borderRadius: 5, fontFamily: 'inherit', fontSize: 10, fontWeight: 500, cursor: 'pointer', background: copied ? '#dcfce7' : '#f1f5f9', color: copied ? '#16a34a' : '#475569', border: `1px solid ${copied ? '#bbf7d0' : '#e2e8f0'}` }}>{copied ? '✓' : 'Copy'}</button>
                    <button onClick={dl} style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 5, fontFamily: 'inherit', fontSize: 10, fontWeight: 500, cursor: 'pointer' }}>↓ {mode === 'bib' ? '.bib' : '.txt'}</button>
                  </div>
                </div>
                <pre style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 11, lineHeight: 1.65, fontFamily: "'IBM Plex Mono',monospace", overflow: 'auto', flex: 1, minHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#334155', margin: 0 }}>{output}</pre>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ RIGHT — Paper Library ═══ */}
      <div style={{ flex: 5, minWidth: 360, borderLeft: '1px solid #e2e8f0', background: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>📚 Paper Library</span>
          {valid.length > 0 && <span className="mono" style={{ fontSize: 11, color: '#94a3b8' }}>{valid.length}</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {!activeId ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#cbd5e1', fontSize: 12 }}>Select a project</div>
          ) : valid.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#cbd5e1', fontSize: 12 }}>
              <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}>📄</div>
              No papers yet
            </div>
          ) : (
            valid.map((p, i) => <PaperCard key={p.citeKey || i} paper={p} index={i} onRemove={removePaper} />)
          )}
        </div>
      </div>
    </div>
  )
}
