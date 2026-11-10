'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle, ExternalLink, FileText, Globe, Headphones, Loader2, Mail,
  Package, Pencil, Phone, Plus, RefreshCw, ShieldCheck, Trash2, X,
} from 'lucide-react'
import type { StoredContact } from '@/lib/contacts/types.ts'
import type { StoredProduct } from '@/lib/products/types.ts'
import type { StoredDocument } from '@/lib/lifefile/types.ts'

export function SupportContactsSection({
  onAskAura,
}: {
  onAskAura?: (prompt: string) => void
}) {
  const [contacts, setContacts] = useState<StoredContact[]>([])
  const [products, setProducts] = useState<StoredProduct[]>([])
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<StoredContact | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const loadAll = async () => {
    try {
      setIsLoading(true)
      const [cRes, pRes, dRes] = await Promise.all([
        fetch('/api/contacts'),
        fetch('/api/products'),
        fetch('/api/documents'),
      ])
      const [cData, pData, dData] = await Promise.all([cRes.json(), pRes.json(), dRes.json()])
      if (cData.success && Array.isArray(cData.contacts)) setContacts(cData.contacts)
      if (pData.success && Array.isArray(pData.products)) setProducts(pData.products)
      if (dData.success && Array.isArray(dData.documents)) setDocuments(dData.documents)
    } catch {
      setErrorMsg('Failed to load customer support contacts.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const handleSync = async () => {
    setIsSyncing(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const data = await res.json()
      if (data.success) {
        await loadAll()
      } else {
        setErrorMsg(data.error || 'Sync failed.')
      }
    } catch {
      setErrorMsg('Network error syncing contacts.')
    } finally {
      setIsSyncing(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setCompanyName('')
    setPhone('')
    setEmail('')
    setWebsite('')
    setNotes('')
    setSelectedProductIds([])
    setShowModal(true)
  }

  const openEdit = (c: StoredContact) => {
    setEditing(c)
    setCompanyName(c.companyName)
    setPhone(c.phone || '')
    setEmail(c.email || '')
    setWebsite(c.website || '')
    setNotes(c.notes || '')
    setSelectedProductIds(c.linkedProductIds || [])
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyName.trim()) return
    setIsSaving(true)
    setErrorMsg(null)
    try {
      const payload = {
        companyName: companyName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        notes: notes.trim() || null,
        linkedProductIds: selectedProductIds,
      }
      const res = editing
        ? await fetch(`/api/contacts/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await res.json()
      if (data.success) {
        setShowModal(false)
        await loadAll()
      } else {
        setErrorMsg(data.error || 'Could not save contact.')
      }
    } catch {
      setErrorMsg('Network error saving contact.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this support contact?')) return
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setContacts((prev) => prev.filter((c) => c.id !== id))
      }
    } catch {
      setErrorMsg('Could not delete contact.')
    }
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <span className="section-kicker">CUSTOMER SUPPORT DIRECTORY</span>
          <h2>Support contacts</h2>
          <p className="subcopy">Extracted helplines, support emails &amp; service portals linked to your products and documents.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="outline-button" onClick={handleSync} disabled={isSyncing}>
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Extracting...' : 'Extract from LifeFile'}</span>
          </button>
          <button className="primary-button" onClick={openCreate}>
            <Plus size={16} /> Add contact
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: '12px 16px', marginBottom: '18px', background: '#f8efe9', borderColor: '#f0dfd5', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
        <ShieldCheck size={16} style={{ color: 'var(--coral)', flexShrink: 0 }} />
        <span>AURA never places calls or sends emails automatically. Links open only when you click them, or AURA can prepare a draft for your review.</span>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', background: '#fae9e5', color: '#c96656', borderRadius: '8px', marginBottom: '14px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
          <span><AlertCircle size={14} style={{ display: 'inline', marginRight: '6px' }} />{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none' }}><X size={14} /></button>
        </div>
      )}

      {isLoading ? (
        <div className="panel" style={{ padding: '32px', textAlign: 'center', color: '#77736c' }}>
          <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto 8px' }} />
          Loading customer support contacts...
        </div>
      ) : contacts.length === 0 ? (
        <div className="empty-module panel">
          <div className="empty-icon"><Headphones size={25} /></div>
          <h3>No support contacts stored yet</h3>
          <p>Click &quot;Extract from LifeFile&quot; to pull phone numbers, emails and websites from your uploaded bills/warranties, or add one manually.</p>
        </div>
      ) : (
        <div className="product-grid">
          {contacts.map((c) => {
            const linkedProds = products.filter((p) => c.linkedProductIds.includes(p.id))
            const linkedDocs = documents.filter((d) => c.linkedDocumentIds.includes(d.id))
            return (
              <article className="panel product-card" key={c.id}>
                <div className="product-head">
                  <span className="icon-box coral"><Headphones size={17} /></span>
                  <span className="warranty-pill">{c.source === 'auto' ? 'EXTRACTED' : 'MANUAL'}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    <button onClick={() => openEdit(c)} title="Edit contact" style={{ background: 'none', border: 'none', color: '#888' }}><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(c.id)} title="Delete contact" style={{ background: 'none', border: 'none', color: '#c96656' }}><Trash2 size={14} /></button>
                  </div>
                </div>

                <h3>{c.companyName}</h3>
                {c.notes && <p>{c.notes}</p>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', fontSize: '12px' }}>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} style={{ color: 'var(--ink)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Phone size={13} style={{ color: 'var(--coral)' }} /> {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} style={{ color: 'var(--ink)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Mail size={13} style={{ color: 'var(--coral)' }} /> {c.email}
                    </a>
                  )}
                  {c.website && (
                    <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Globe size={13} /> {c.website} <ExternalLink size={10} />
                    </a>
                  )}
                </div>

                {(linkedProds.length > 0 || linkedDocs.length > 0) && (
                  <div style={{ borderTop: '1px solid #efede9', paddingTop: '10px', marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {linkedProds.map((p) => (
                      <span key={p.id} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', background: '#e7f1f5', color: '#3b6d8c', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Package size={10} /> {p.productName}
                      </span>
                    ))}
                    {linkedDocs.map((d) => (
                      <a key={d.id} href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', background: '#f7f6f3', border: '1px solid var(--border)', color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <FileText size={10} /> {d.originalFilename}
                      </a>
                    ))}
                  </div>
                )}

                {onAskAura && (
                  <div className="product-actions">
                    <button onClick={() => onAskAura(`Draft a customer support email to ${c.companyName}`)}>
                      <Mail size={12} /> Draft support email
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }} onClick={() => setShowModal(false)}>
          <div className="panel" style={{ maxWidth: '480px', width: '100%', background: '#fff', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>{editing ? 'Edit Support Contact' : 'Add Support Contact'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Company Name *</label>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required placeholder="e.g. LG India Customer Care" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Phone / Helpline</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 1800-315-9999" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Support Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. service@lg.com" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Website</label>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.lg.com/in/support" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
              </div>
              {products.length > 0 && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Associated Products</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {products.map((p) => {
                      const active = selectedProductIds.includes(p.id)
                      return (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() =>
                            setSelectedProductIds((prev) =>
                              active ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                            )
                          }
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            borderRadius: '5px',
                            border: '1px solid var(--border)',
                            background: active ? '#e7f1f5' : '#fff',
                            color: active ? '#2b5f7a' : '#555',
                          }}
                        >
                          {p.productName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="outline-button" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
