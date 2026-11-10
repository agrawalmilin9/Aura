'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle, Check, Clock3, ExternalLink, FileText, Loader2, Mail, Package,
  Pencil, Phone, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-react'
import type { StoredProduct } from '@/lib/products/types.ts'
import type { StoredDocument } from '@/lib/lifefile/types.ts'
import type { StoredContact } from '@/lib/contacts/types.ts'
import type { AssistanceMode, ProductAssistanceReport } from '@/lib/intelligence/connected-intelligence.ts'

const DEMO_PRODUCTS = [
  { name: 'LG 8kg Washing Machine', brand: 'LG India', serial: 'LGWM-2303-8842', expiry: '15 Mar 2028', tone: 'blue' },
  { name: 'MacBook Air M2', brand: 'Apple', serial: 'C02ZK0ABCDEF', expiry: '20 Nov 2027', tone: 'violet' },
  { name: 'Samsung Galaxy S23', brand: 'Samsung', serial: 'R5CT1234ABC', expiry: '14 Feb 2027', tone: 'green' },
]

export function ProductsSection({
  onAskAura,
}: {
  onAskAura?: (prompt: string) => void
}) {
  const [products, setProducts] = useState<StoredProduct[]>([])
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [contacts, setContacts] = useState<StoredContact[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Add/Edit Modal
  const [showModal, setShowModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<StoredProduct | null>(null)
  const [formName, setFormName] = useState('')
  const [formBrand, setFormBrand] = useState('')
  const [formModel, setFormModel] = useState('')
  const [formSerial, setFormSerial] = useState('')
  const [formPurchaseDate, setFormPurchaseDate] = useState('')
  const [formWarrantyExpiry, setFormWarrantyExpiry] = useState('')
  const [formWarrantyDuration, setFormWarrantyDuration] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Assistance Modal (Checklist / Email Draft / Service Draft / Coverage)
  const [assistProduct, setAssistProduct] = useState<StoredProduct | null>(null)
  const [assistMode, setAssistMode] = useState<AssistanceMode>('warranty_checklist')
  const [assistReport, setAssistReport] = useState<ProductAssistanceReport | null>(null)
  const [isGeneratingAssist, setIsGeneratingAssist] = useState(false)

  const loadAll = async () => {
    try {
      setIsLoading(true)
      const [prodRes, docRes, contRes] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/documents'),
        fetch('/api/contacts'),
      ])
      const [prodData, docData, contData] = await Promise.all([
        prodRes.json(),
        docRes.json(),
        contRes.json(),
      ])
      if (prodData.success && Array.isArray(prodData.products)) setProducts(prodData.products)
      if (docData.success && Array.isArray(docData.documents)) setDocuments(docData.documents)
      if (contData.success && Array.isArray(contData.contacts)) setContacts(contData.contacts)
    } catch {
      setErrorMsg('Could not load products from server.')
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
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const data = await res.json()
      if (data.success) {
        await loadAll()
      } else {
        setErrorMsg(data.error || 'Failed to sync products from LifeFile.')
      }
    } catch {
      setErrorMsg('Network error during LifeFile product sync.')
    } finally {
      setIsSyncing(false)
    }
  }

  const openCreateModal = () => {
    setEditingProduct(null)
    setFormName('')
    setFormBrand('')
    setFormModel('')
    setFormSerial('')
    setFormPurchaseDate('')
    setFormWarrantyExpiry('')
    setFormWarrantyDuration('')
    setFormNotes('')
    setShowModal(true)
  }

  const openEditModal = (prod: StoredProduct) => {
    setEditingProduct(prod)
    setFormName(prod.productName)
    setFormBrand(prod.brand || '')
    setFormModel(prod.modelNumber || '')
    setFormSerial(prod.serialNumber || '')
    setFormPurchaseDate(prod.purchaseDate || '')
    setFormWarrantyExpiry(prod.warrantyExpiry || '')
    setFormWarrantyDuration(prod.warrantyDuration || '')
    setFormNotes(prod.notes || '')
    setShowModal(true)
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) return
    setIsSaving(true)
    setErrorMsg(null)
    try {
      const payload = {
        productName: formName.trim(),
        brand: formBrand.trim() || null,
        modelNumber: formModel.trim() || null,
        serialNumber: formSerial.trim() || null,
        purchaseDate: formPurchaseDate.trim() || null,
        warrantyExpiry: formWarrantyExpiry.trim() || null,
        warrantyDuration: formWarrantyDuration.trim() || null,
        notes: formNotes.trim() || null,
      }
      const res = editingProduct
        ? await fetch(`/api/products/${editingProduct.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await res.json()
      if (data.success) {
        setShowModal(false)
        await loadAll()
      } else {
        setErrorMsg(data.error || 'Could not save product.')
      }
    } catch {
      setErrorMsg('Network error while saving product.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('Delete this product record? Linked LifeFile documents remain safe.')) return
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setProducts((prev) => prev.filter((p) => p.id !== id))
      } else {
        setErrorMsg(data.error || 'Could not delete product.')
      }
    } catch {
      setErrorMsg('Network error deleting product.')
    }
  }

  const openAssistance = async (prod: StoredProduct, mode: AssistanceMode = 'warranty_checklist') => {
    setAssistProduct(prod)
    setAssistMode(mode)
    setIsGeneratingAssist(true)
    setAssistReport(null)
    try {
      const res = await fetch('/api/intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: prod.id, mode }),
      })
      const data = await res.json()
      if (data.success && data.report) {
        setAssistReport(data.report)
      }
    } catch {
      setAssistReport(null)
    } finally {
      setIsGeneratingAssist(false)
    }
  }

  const activeCount = products.filter(
    (p) => p.warrantyStatus === 'active' || p.warrantyStatus === 'expiring_soon'
  ).length
  const expiringSoonCount = products.filter((p) => p.warrantyStatus === 'expiring_soon').length
  const progressPct = products.length > 0 ? Math.min(100, Math.round((activeCount / products.length) * 100)) : 0

  const statusBadgeStyle = (status: StoredProduct['warrantyStatus']) => {
    if (status === 'expiring_soon') return { background: '#fef3c7', color: '#b45309' }
    if (status === 'expired') return { background: '#fae9e5', color: '#c96656' }
    if (status === 'active') return { background: '#edf5ee', color: '#5f916e' }
    return { background: '#f0efec', color: '#77736c' }
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <span className="section-kicker">PRODUCTS & WARRANTY · CONNECTED INTELLIGENCE</span>
          <h2>Things you own</h2>
          <p className="subcopy">Auto-linked invoices, warranty cards, manuals, service records &amp; support contacts.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="outline-button" onClick={handleSync} disabled={isSyncing}>
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Sync from LifeFile'}</span>
          </button>
          <button className="primary-button" onClick={openCreateModal}>
            <Plus size={16} /> Add product
          </button>
        </div>
      </div>

      {errorMsg && (
        <div style={{ padding: '10px 14px', background: '#fae9e5', color: '#c96656', borderRadius: '8px', marginBottom: '14px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><AlertCircle size={14} style={{ display: 'inline', marginRight: '6px' }} />{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      <div className="product-summary">
        <div>
          <span className="stat-label">ACTIVE WARRANTIES</span>
          <strong>{activeCount}</strong>
          <small>of {products.length} tracked real products</small>
        </div>
        <div className="summary-line">
          <span>Warranties expiring soon</span>
          <b>{expiringSoonCount}</b>
          <i className="progress"><em style={{ width: `${progressPct}%` }} /></i>
        </div>
        <ShieldCheck size={25} />
      </div>

      {isLoading ? (
        <div className="panel" style={{ padding: '32px', textAlign: 'center', color: '#77736c' }}>
          <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto 8px' }} />
          Loading connected product records...
        </div>
      ) : products.length === 0 ? (
        <div className="panel" style={{ padding: '28px', textAlign: 'center', marginBottom: '28px' }}>
          <Package size={28} style={{ color: 'var(--coral)', margin: '0 auto 10px' }} />
          <h3 style={{ margin: '0 0 6px' }}>No real products tracked yet</h3>
          <p className="muted" style={{ maxWidth: '460px', margin: '0 auto 14px' }}>
            Upload an invoice, warranty card, or manual in My Documents and click &quot;Sync from LifeFile&quot;, or add a product manually.
          </p>
        </div>
      ) : (
        <div className="product-grid" style={{ marginBottom: '32px' }}>
          {products.map((p) => {
            const linkedDocs = documents.filter((d) => p.linkedDocumentIds.includes(d.id))
            const relatedContact = contacts.find(
              (c) =>
                c.linkedProductIds.includes(p.id) ||
                (p.brand && c.companyName.toLowerCase().includes(p.brand.toLowerCase()))
            )

            return (
              <article className="panel product-card" key={p.id}>
                <div className="product-head">
                  <span className="icon-box blue"><Package size={17} strokeWidth={1.8} /></span>
                  <span className="warranty-pill" style={statusBadgeStyle(p.warrantyStatus)}>
                    {p.warrantyStatus.replace('_', ' ').toUpperCase()}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => openEditModal(p)}
                      title="Edit product"
                      style={{ background: 'none', border: 'none', color: '#888', padding: '2px' }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteProduct(p.id)}
                      title="Delete product"
                      style={{ background: 'none', border: 'none', color: '#c96656', padding: '2px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <h3>{p.productName}</h3>
                <p>
                  {p.brand || 'Unknown brand'}
                  {p.modelNumber ? ` · Model ${p.modelNumber}` : ''}
                  {p.serialNumber ? ` · SN ${p.serialNumber}` : ''}
                </p>

                <div className="warranty-date">
                  <Clock3 size={14} />
                  <span>
                    {p.warrantyExpiry ? (
                      <>Warranty ends <strong>{p.warrantyExpiry}</strong></>
                    ) : (
                      <>Purchased: <strong>{p.purchaseDate || 'Date not specified'}</strong></>
                    )}
                  </span>
                </div>

                {/* Linked Documents */}
                {linkedDocs.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {linkedDocs.map((d) => {
                      const role = p.documentRoles?.[d.id] || d.extractedData?.documentType || 'doc'
                      return (
                        <a
                          key={d.id}
                          href={`/api/documents/${d.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '10px',
                            padding: '3px 7px',
                            borderRadius: '4px',
                            background: '#f7f6f3',
                            border: '1px solid var(--border)',
                            color: '#2563eb',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title={`Open ${d.originalFilename}`}
                        >
                          <FileText size={10} />
                          <span>{role}: {d.originalFilename}</span>
                          <ExternalLink size={9} />
                        </a>
                      )
                    })}
                  </div>
                )}

                <div className="product-actions" style={{ flexWrap: 'wrap' }}>
                  <button onClick={() => openAssistance(p, 'warranty_checklist')}>
                    <Sparkles size={12} /> Claim Checklist
                  </button>
                  {onAskAura && (
                    <button onClick={() => onAskAura(`Show all documents and support details for ${p.productName}`)}>
                      Ask AURA
                    </button>
                  )}
                  {relatedContact?.phone && (
                    <a href={`tel:${relatedContact.phone}`} title={`Call ${relatedContact.companyName}`}>
                      <Phone size={12} /> {relatedContact.phone}
                    </a>
                  )}
                  {!relatedContact?.phone && relatedContact?.email && (
                    <a href={`mailto:${relatedContact.email}`} title={`Email ${relatedContact.companyName}`}>
                      <Mail size={12} /> Email support
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Sample Demo Products (Clearly Separated) */}
      <div style={{ marginTop: '30px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
        <div style={{ marginBottom: '12px' }}>
          <span className="section-kicker">DEMO SHOWCASE PRODUCTS (SAMPLE DATA · ANANYA KAPOOR)</span>
        </div>
        <div className="product-grid" style={{ opacity: 0.85 }}>
          {DEMO_PRODUCTS.map((p) => (
            <article className="panel product-card" key={p.name}>
              <div className="product-head">
                <span className={`icon-box ${p.tone}`}><Package size={17} /></span>
                <span className="warranty-pill">SAMPLE</span>
              </div>
              <h3>{p.name}</h3>
              <p>{p.brand} · Serial {p.serial}</p>
              <div className="warranty-date">
                <Clock3 size={14} />
                <span>Sample expiry: <strong>{p.expiry}</strong></span>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
          onClick={() => setShowModal(false)}
        >
          <div className="panel" style={{ maxWidth: '500px', width: '100%', background: '#fff', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>{editingProduct ? 'Edit Product' : 'Add Product'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveProduct} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Product Name *</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} required placeholder="e.g. LG 8kg Washing Machine" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Brand</label>
                  <input value={formBrand} onChange={(e) => setFormBrand(e.target.value)} placeholder="e.g. LG India" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Model Number</label>
                  <input value={formModel} onChange={(e) => setFormModel(e.target.value)} placeholder="e.g. FHM1408BDL" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Serial Number</label>
                  <input value={formSerial} onChange={(e) => setFormSerial(e.target.value)} placeholder="Serial number" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Warranty Duration</label>
                  <input value={formWarrantyDuration} onChange={(e) => setFormWarrantyDuration(e.target.value)} placeholder="e.g. 2 Years" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Purchase Date</label>
                  <input type="date" value={formPurchaseDate} onChange={(e) => setFormPurchaseDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Warranty Expiry</label>
                  <input type="date" value={formWarrantyExpiry} onChange={(e) => setFormWarrantyExpiry(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Notes</label>
                <textarea rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" className="outline-button" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={isSaving}>
                  {isSaving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Document-Based Assistance Modal */}
      {assistProduct && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
          onClick={() => setAssistProduct(null)}
        >
          <div className="panel" style={{ maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#fff', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <span className="section-kicker">DOCUMENT-BASED ASSISTANCE</span>
                <h3 style={{ margin: '4px 0 0' }}>{assistProduct.productName}</h3>
              </div>
              <button onClick={() => setAssistProduct(null)} style={{ background: 'none', border: 'none' }}><X size={18} /></button>
            </div>

            <div className="category-row" style={{ marginBottom: '14px' }}>
              {(
                [
                  ['warranty_checklist', 'Claim Checklist'],
                  ['support_email_draft', 'Support Email Draft'],
                  ['service_request_draft', 'Service Draft'],
                  ['warranty_coverage', 'Coverage Terms'],
                ] as Array<[AssistanceMode, string]>
              ).map(([modeKey, label]) => (
                <button
                  key={modeKey}
                  className={`category ${assistMode === modeKey ? 'active' : ''}`}
                  onClick={() => openAssistance(assistProduct, modeKey)}
                >
                  {label}
                </button>
              ))}
            </div>

            {isGeneratingAssist ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#77736c' }}>
                <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto 6px' }} />
                Preparing grounded assistance...
              </div>
            ) : assistReport ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
                <div style={{ background: '#edf5ee', border: '1px solid #d5e6d7', borderRadius: '8px', padding: '12px' }}>
                  <strong style={{ display: 'block', color: '#456f51', marginBottom: '6px' }}>
                    <Check size={13} style={{ display: 'inline', marginRight: '4px' }} />
                    Extracted Document Facts (Verified)
                  </strong>
                  <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
                    {assistReport.extractedFacts.map((fact, idx) => (
                      <li key={idx}>{fact}</li>
                    ))}
                  </ul>
                </div>

                {assistReport.missingInformation.length > 0 && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px' }}>
                    <strong style={{ display: 'block', color: '#92400e', marginBottom: '6px' }}>
                      Missing Required Information
                    </strong>
                    <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
                      {assistReport.missingInformation.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ background: '#faf9f7', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px' }}>
                  <strong style={{ display: 'block', marginBottom: '6px' }}>
                    Suggestion / Draft (Requires Your Approval — Never Auto-Sent)
                  </strong>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6, color: '#374151' }}>
                    {assistReport.suggestionsAndDraft}
                  </pre>
                </div>

                {assistReport.sources.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {assistReport.sources.map((src) => (
                      <a
                        key={src.documentId}
                        href={src.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="outline-button"
                        style={{ fontSize: '11px', padding: '5px 9px', textDecoration: 'none' }}
                      >
                        <FileText size={12} /> Source: {src.originalFilename} <ExternalLink size={10} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="muted">Could not generate assistance report.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
