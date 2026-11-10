'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle, BookOpen, Check, Loader2, Pencil, Plus, ShieldCheck, Trash2, X,
} from 'lucide-react'
import type { MemoryCategory, StoredMemory } from '@/lib/memory/types.ts'

export function PersonalMemorySection() {
  const [memories, setMemories] = useState<StoredMemory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryCategory>('preference')
  const [userApproved, setUserApproved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const loadMemories = async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/memory')
      const data = await res.json()
      if (data.success && Array.isArray(data.memories)) {
        setMemories(data.memories)
      }
    } catch {
      setErrorMsg('Failed to load saved personal memories.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadMemories()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newContent.trim() || !userApproved) return
    setIsSaving(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newContent.trim(),
          category: newCategory,
          approvedByUser: true,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setNewContent('')
        setUserApproved(false)
        await loadMemories()
      } else {
        setErrorMsg(data.error || 'Could not save memory.')
      }
    } catch {
      setErrorMsg('Network error saving personal memory.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveEdit = async (id: string) => {
    if (!editContent.trim()) return
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/memory/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setEditingId(null)
        await loadMemories()
      } else {
        setErrorMsg(data.error || 'Could not update memory.')
      }
    } catch {
      setErrorMsg('Network error updating memory.')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this saved memory?')) return
    try {
      const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setMemories((prev) => prev.filter((m) => m.id !== id))
      }
    } catch {
      setErrorMsg('Could not delete memory.')
    }
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <span className="section-kicker">TRANSPARENT PERSONAL MEMORY</span>
          <h2>Personal memory</h2>
          <p className="subcopy">Approved personal preferences stored separately from LifeFile document facts.</p>
        </div>
      </div>

      <div className="panel" style={{ padding: '14px 16px', marginBottom: '18px', background: '#f8efe9', borderColor: '#f0dfd5', display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '12px' }}>
        <ShieldCheck size={17} style={{ color: 'var(--coral)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong>Explicit permission &amp; privacy guarantee</strong>
          <p style={{ margin: '4px 0 0', color: '#6b625b', lineHeight: 1.5 }}>
            AURA never silently saves personal information from chat. Only notes you explicitly approve are stored here, and sensitive details (passwords, PINs, card numbers, Aadhaar/PAN) are automatically blocked.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', background: '#fae9e5', color: '#c96656', borderRadius: '8px', marginBottom: '14px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
          <span><AlertCircle size={14} style={{ display: 'inline', marginRight: '6px' }} />{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none' }}><X size={14} /></button>
        </div>
      )}

      <div className="overview-grid">
        <div className="panel">
          <span className="section-kicker">ADD APPROVED MEMORY</span>
          <h3 style={{ marginBottom: '12px' }}>Save a personal preference</h3>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <textarea
              rows={3}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="e.g. Prefer evening service visits after 6 PM, or remind me 7 days before bills."
              style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '13px' }}
              required
            />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
              style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: '#fff' }}
            >
              <option value="preference">Preference</option>
              <option value="home">Home / Service Note</option>
              <option value="reminder_rule">Reminder Rule</option>
              <option value="family">Family Note</option>
              <option value="other">Other</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#4d4a45' }}>
              <input
                type="checkbox"
                checked={userApproved}
                onChange={(e) => setUserApproved(e.target.checked)}
              />
              I approve saving this note in my Personal Memory for AURA responses.
            </label>
            <button type="submit" className="primary-button" disabled={!userApproved || !newContent.trim() || isSaving} style={{ alignSelf: 'flex-start' }}>
              <Plus size={15} /> {isSaving ? 'Saving...' : 'Save approved memory'}
            </button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-head" style={{ marginBottom: '12px' }}>
            <div>
              <span className="section-kicker">SAVED MEMORIES ({memories.length})</span>
              <h3>What AURA remembers with your permission</h3>
            </div>
          </div>
          {isLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#77736c' }}>
              <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto 6px' }} />
              Loading memories...
            </div>
          ) : memories.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#77736c' }}>
              <BookOpen size={26} style={{ margin: '0 auto 8px', color: 'var(--coral)' }} />
              <p style={{ margin: 0, fontSize: '12px' }}>No personal memories saved yet.</p>
            </div>
          ) : (
            <div className="task-list">
              {memories.map((m) => (
                <div className="task-row" key={m.id} style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <span className="tag violet" style={{ display: 'inline-block', marginBottom: '4px' }}>{m.category}</span>
                    {editingId === m.id ? (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <input
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }}
                        />
                        <button className="primary-button" style={{ padding: '6px 10px' }} onClick={() => handleSaveEdit(m.id)}>
                          <Check size={13} />
                        </button>
                        <button className="outline-button" style={{ padding: '6px 10px' }} onClick={() => setEditingId(null)}>
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <strong style={{ display: 'block', lineHeight: 1.5 }}>{m.content}</strong>
                    )}
                    <span style={{ fontSize: '10px', color: '#999' }}>
                      Approved · Updated {new Date(m.updatedAt).toLocaleDateString('en-IN')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => {
                        setEditingId(m.id)
                        setEditContent(m.content)
                      }}
                      title="Edit memory"
                      style={{ background: 'none', border: 'none', color: '#888' }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(m.id)}
                      title="Delete memory"
                      style={{ background: 'none', border: 'none', color: '#c96656' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
