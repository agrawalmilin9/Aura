'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle, Archive, ArrowUpRight, Bell, BookOpen, BriefcaseBusiness, CalendarDays, Camera, Check, ChevronDown,
  CircleHelp, Clock3, Download, ExternalLink, Eye, FileCheck2, FileText, Filter, Headphones, LayoutDashboard, LifeBuoy, Loader2, LogOut, Menu, Mic,
  MoreHorizontal, Package, Paperclip, Pencil, Phone, Plus, ReceiptIndianRupee, RefreshCw, Search, Send, Settings,
  ShieldCheck, Sparkles, Square, Tag, Trash2, Upload, UserRound, Volume2, VolumeX, WalletCards, X, Zap,
} from 'lucide-react'
import { useVoiceAssistant } from '@/lib/hooks/useVoiceAssistant.ts'
import { useReminders, type InAppReminderItem, type BrowserPermissionState } from '@/lib/hooks/useReminders.ts'
import { useProfile, getProfileInitials, type UserProfile } from '@/lib/hooks/useProfile.ts'
import { useTasks } from '@/lib/hooks/useTasks.ts'
import type { PublicUser } from '@/lib/auth/types.ts'
import type { StoredDocument } from '@/lib/lifefile/types.ts'
import type { StoredTask, TaskCategory, TaskPriority, TaskRecurrence } from '@/lib/tasks/types.ts'
import type { ProactiveSuggestion } from '@/lib/intelligence/proactive-suggestions.ts'
import type { MemoryProposal } from '@/lib/memory/types.ts'
import { ProductsSection } from '@/components/aura/ProductsSection.tsx'
import { SupportContactsSection } from '@/components/aura/SupportContactsSection.tsx'
import { PersonalMemorySection } from '@/components/aura/PersonalMemorySection.tsx'
import { ProfileSection } from '@/components/aura/ProfileSection.tsx'
import { GuidedUploadModal } from '@/components/aura/GuidedUploadModal.tsx'
import { FormFillingGuideModal } from '@/components/aura/FormFillingGuideModal.tsx'
import { looksLikeFormDocument } from '@/lib/lifefile/form-assistant.ts'
import { postDocumentUpload } from '@/lib/lifefile/client-upload.ts'

const nav: Array<{ label: string; icon: any; id: string }> = [
  { label: 'Overview', icon: LayoutDashboard, id: 'overview' },
  { label: 'AI Assistant', icon: Sparkles, id: 'assistant' },
  { label: 'My Documents', icon: Archive, id: 'documents' },
  { label: 'Products & Warranty', icon: Package, id: 'products' },
  { label: 'Tasks & Reminders', icon: CalendarDays, id: 'tasks' },
  { label: 'Bills & Payments', icon: ReceiptIndianRupee, id: 'bills' },
  { label: 'Support Contacts', icon: Headphones, id: 'support' },
]

const documents = [
  { name: 'HDFC Ergo Health Insurance', type: 'Insurance', date: '12 Oct 2026', meta: 'Policy · Expires 30 Dec 2026', color: 'rose', icon: ShieldCheck },
  { name: 'LG Washing Machine Invoice', type: 'Invoice', date: '15 Mar 2026', meta: 'LG India · ₹32,490', color: 'amber', icon: ReceiptIndianRupee },
  { name: 'Adani Electricity — Oct 2026', type: 'Bill', date: '02 Nov 2026', meta: 'Due 25 Nov 2026 · ₹2,840', color: 'blue', icon: Zap },
  { name: 'MacBook Air M2 Warranty Card', type: 'Warranty', date: '10 Nov 2025', meta: 'Apple · expires Nov 2027', color: 'violet', icon: Package },
]

const tasks = [
  { title: 'Pay Adani Electricity bill', detail: 'Due in 15 days (25 Nov 2026) · ₹2,840', tag: 'Bills', tone: 'coral', done: false },
  { title: 'Renew HDFC Ergo health policy', detail: '30 Dec 2026 · Renewal upcoming', tag: 'Renewal', tone: 'violet', done: false },
  { title: 'Schedule LG washing machine service', detail: 'Warranty active till Mar 2028', tag: 'Service', tone: 'blue', done: false },
  { title: 'Download Form 16 from employer', detail: 'Tax filing record archived', tag: 'Personal', tone: 'green', done: true },
]

function IconBox({ icon: Icon, tone = 'neutral' }: { icon: any; tone?: string }) {
  return <span className={`icon-box ${tone}`}><Icon size={17} strokeWidth={1.8} /></span>
}

function formatStorageBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function Topbar({
  title,
  onMenu,
  reminders,
  browserPermission,
  browserEnabled,
  onEnableBrowserNotif,
  onDisableBrowserNotif,
  onSnoozeTask,
  onCompleteTask,
  onAskAura,
  onOpenSearch,
  profile,
  onNavigate,
  onLogout,
}: {
  title: string
  onMenu: () => void
  reminders: InAppReminderItem[]
  browserPermission: BrowserPermissionState
  browserEnabled: boolean
  onEnableBrowserNotif: () => void
  onDisableBrowserNotif: () => void
  onSnoozeTask: (taskId: string) => void
  onCompleteTask: (taskId: string) => void
  onAskAura: (prompt: string) => void
  onOpenSearch: () => void
  profile: UserProfile
  onNavigate: (id: string) => void
  onLogout: () => void
}) {
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement | null>(null)
  const profileRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setNotifOpen(false)
    setProfileOpen(false)
  }, [title])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (profileOpen && profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false)
      }
      if (notifOpen && notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [notifOpen, profileOpen])

  const displayName = profile.isCustom && profile.name.trim() ? profile.name.trim() : 'Default Profile'
  const initials = getProfileInitials(profile.name)

  return (
    <header className="topbar" style={{ position: 'relative' }}>
      <button className="mobile-menu" onClick={onMenu} aria-label="Open navigation"><Menu size={21} /></button>
      <div><div className="eyebrow">PERSONAL COMMAND CENTRE</div><h1>{title}</h1></div>
      <div className="top-actions">
        <button className="icon-button" onClick={onOpenSearch} aria-label="Search workspace" title="Quick search across LifeFile, Products & Tasks">
          <Search size={18} />
        </button>
        <div ref={notifRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            className="notification"
            onClick={() => {
              setProfileOpen(false)
              setNotifOpen((prev) => !prev)
            }}
            aria-label="Notifications"
            title="Reminders & proactive alerts"
          >
            <Bell size={18} />
            {reminders.length > 0 && <span />}
          </button>

          {notifOpen && (
            <div
              className="panel"
              style={{
                position: 'absolute',
                right: '-44px',
                top: '44px',
                width: 'min(370px, calc(100vw - 32px))',
                maxHeight: '460px',
                overflowY: 'auto',
                zIndex: 90,
                boxShadow: '0 18px 40px rgba(0,0,0,0.16)',
                padding: '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <span className="section-kicker">IN-APP REMINDERS ({reminders.length})</span>
                  <h3 style={{ margin: '2px 0 0', fontSize: '14px' }}>Due &amp; Proactive Alerts</h3>
                </div>
                <button onClick={() => setNotifOpen(false)} style={{ background: 'none', border: 'none', color: '#888' }}>
                  <X size={16} />
                </button>
              </div>

              <div style={{ padding: '8px 10px', background: '#faf9f7', border: '1px solid var(--border)', borderRadius: '7px', fontSize: '11px', marginBottom: '12px' }}>
                {browserPermission === 'unsupported' ? (
                  <span>Browser notifications are not supported in this browser.</span>
                ) : browserPermission === 'denied' ? (
                  <span style={{ color: '#c96656' }}>Browser notification permission is blocked in browser settings. In-app reminders remain active here.</span>
                ) : browserEnabled ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#5f916e' }}>✓ Browser alerts enabled (while tab is open)</span>
                    <button className="outline-button" style={{ padding: '3px 8px', fontSize: '10px' }} onClick={onDisableBrowserNotif}>Pause</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span>Enable browser alerts while AURA is open</span>
                    <button className="primary-button" style={{ padding: '4px 8px', fontSize: '10px' }} onClick={onEnableBrowserNotif}>Enable</button>
                  </div>
                )}
              </div>

              {reminders.length === 0 ? (
                <p className="muted" style={{ margin: '12px 0', fontSize: '12px' }}>No urgent overdue or upcoming reminders right now.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {reminders.map((r) => (
                    <div key={r.id} style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', background: r.urgency === 'overdue' ? '#fef2f2' : '#fff', fontSize: '12px' }}>
                      <strong style={{ display: 'block', marginBottom: '2px' }}>{r.title}</strong>
                      <span style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>{r.detail}</span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {r.taskId && (
                          <>
                            <button className="outline-button" style={{ padding: '4px 8px', fontSize: '10px' }} onClick={() => onCompleteTask(r.taskId!)}>
                              Mark Done
                            </button>
                            <button className="outline-button" style={{ padding: '4px 8px', fontSize: '10px' }} onClick={() => onSnoozeTask(r.taskId!)}>
                              Snooze +1d
                            </button>
                          </>
                        )}
                        {r.suggestedPrompt && (
                          <button
                            className="outline-button"
                            style={{ padding: '4px 8px', fontSize: '10px', color: 'var(--coral)', borderColor: '#f0d4cc' }}
                            onClick={() => {
                              setNotifOpen(false)
                              onAskAura(r.suggestedPrompt!)
                            }}
                          >
                            Prepare with AURA
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="avatar-button"
            onClick={() => {
              setNotifOpen(false)
              setProfileOpen((prev) => !prev)
            }}
            aria-label="Open profile menu"
            aria-expanded={profileOpen}
            title="Profile & Settings"
          >
            <div className="avatar">
              {profile.photoDataUrl ? (
                <img src={profile.photoDataUrl} alt={displayName} />
              ) : (
                initials
              )}
            </div>
          </button>

          {profileOpen && (
            <div
              className="panel"
              role="menu"
              style={{
                position: 'absolute',
                right: 0,
                top: '44px',
                width: 'min(230px, calc(100vw - 24px))',
                padding: '10px',
                zIndex: 95,
                boxShadow: '0 16px 36px rgba(0,0,0,0.14)',
              }}
            >
              <div style={{ padding: '6px 8px 10px', borderBottom: '1px solid var(--border)', marginBottom: '6px' }}>
                <strong style={{ display: 'block', fontSize: '12px' }}>{displayName}</strong>
                <span style={{ display: 'block', fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {profile.email || 'Private AURA account'}
                </span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false)
                  onNavigate('profile')
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  border: 0,
                  borderRadius: '6px',
                  background: 'transparent',
                  fontSize: '12px',
                  color: 'var(--ink)',
                  textAlign: 'left',
                }}
              >
                <UserRound size={15} style={{ color: 'var(--coral)' }} />
                <span>View Profile</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false)
                  onNavigate('settings')
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  border: 0,
                  borderRadius: '6px',
                  background: 'transparent',
                  fontSize: '12px',
                  color: 'var(--ink)',
                  textAlign: 'left',
                }}
              >
                <Settings size={15} style={{ color: '#77736c' }} />
                <span>Settings</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false)
                  onLogout()
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  border: 0,
                  borderTop: '1px solid var(--border)',
                  marginTop: '4px',
                  borderRadius: '6px',
                  background: 'transparent',
                  fontSize: '12px',
                  color: '#c96656',
                  textAlign: 'left',
                }}
              >
                <LogOut size={15} />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function Sidebar({
  active,
  setActive,
  open,
  close,
  liveStats,
  pendingTaskCount,
}: {
  active: string
  setActive: (id: string) => void
  open: boolean
  close: () => void
  liveStats: {
    documentsCount: number
    productsCount: number
    pendingTaskCount: number
    contactsCount: number
    totalStorageBytes: number
  } | null
  pendingTaskCount: number
}) {
  const getBadge = (id: string): string | null => {
    if (id === 'tasks' && pendingTaskCount > 0) return String(pendingTaskCount)
    if (!liveStats) return null
    if (id === 'documents' && liveStats.documentsCount > 0) return String(liveStats.documentsCount)
    if (id === 'products' && liveStats.productsCount > 0) return String(liveStats.productsCount)
    if (id === 'support' && liveStats.contactsCount > 0) return String(liveStats.contactsCount)
    return null
  }

  const usedBytes = liveStats?.totalStorageBytes || 0
  const maxLocalBytes = 100 * 1024 * 1024
  const pct = usedBytes > 0 ? Math.max(2, Math.min(100, Math.round((usedBytes / maxLocalBytes) * 100))) : 0

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-pill">
          <img src="/aura-logo-lockup.png" alt="AURA — Your Personal AI Assistant" className="brand-lockup" />
        </div>
        <button className="sidebar-close" onClick={close} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <nav>
        <div className="nav-label">WORKSPACE</div>
        {nav.map((item) => {
          const Icon = item.icon
          const badge = getBadge(item.id)
          return (
            <button key={item.id} className={`nav-item ${active === item.id ? 'active' : ''}`} onClick={() => { setActive(item.id); close() }}>
              <Icon size={17} strokeWidth={1.8} style={{ flexShrink: 0 }} />
              <span className="nav-item-text">
                <span>{item.label}</span>
              </span>
              {badge && <em>{badge}</em>}
            </button>
          )
        })}
        <div className="nav-label nav-bottom">PERSONAL</div>
        <button className={`nav-item ${active === 'memory' ? 'active' : ''}`} onClick={() => { setActive('memory'); close() }}>
          <BookOpen size={17} /><span>Personal Memory</span>
        </button>
      </nav>
      <div className="sidebar-footer">
        <div className="secure"><ShieldCheck size={15} /><span>Your data stays yours</span></div>
        <div className="storage">
          <div><span>Account Storage</span><b>{pct}%</b></div>
          <div className="progress"><i style={{ width: `${pct}%` }} /></div>
          <small>{formatStorageBytes(usedBytes)} stored in your private LifeFile</small>
        </div>
      </div>
    </aside>
  )
}

function Overview({
  setActive,
  onAskAura,
  sharedTasks,
  onToggleTask,
  togglingTaskIds,
  taskError,
  profile,
}: {
  setActive: (id: string) => void
  onAskAura: (prompt: string) => void
  sharedTasks: StoredTask[]
  onToggleTask: (task: StoredTask) => void
  togglingTaskIds?: Set<string>
  taskError: string | null
  profile: UserProfile
}) {
  const [liveStats, setLiveStats] = useState<{
    documentsCount: number
    productsCount: number
    activeWarrantyCount: number
    pendingTaskCount: number
    contactsCount: number
  } | null>(null)
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([])

  useEffect(() => {
    fetch('/api/intelligence', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          if (data.stats) setLiveStats(data.stats)
          if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions)
        }
      })
      .catch(() => {})
  }, [sharedTasks])

  const activeTasks = sharedTasks.filter((t) => t.status !== 'dismissed')
  const pendingCount = activeTasks.filter((t) => t.status === 'pending').length
  const completedCount = activeTasks.filter((t) => t.status === 'completed').length

  // Show pending tasks first, then recently completed so checking a box keeps it visible to uncheck!
  const overviewTasks = [
    ...activeTasks.filter((t) => t.status === 'pending'),
    ...activeTasks.filter((t) => t.status === 'completed'),
  ].slice(0, 4)

  const docCountDisplay = liveStats && liveStats.documentsCount > 0 ? liveStats.documentsCount : 0
  const prodCountDisplay = liveStats && liveStats.productsCount > 0 ? liveStats.productsCount : 0
  const warrantySubtext =
    prodCountDisplay > 0
      ? `${liveStats?.activeWarrantyCount || 0} active warranties`
      : 'Sync from invoices & warranties'

  const firstName =
    profile.isCustom && profile.name.trim() ? profile.name.trim().split(/\s+/)[0] : ''

  return (
    <div className="content">
      <section className="welcome">
        <div>
          <p className="eyebrow coral-text">TUESDAY, 10 NOVEMBER 2026 · CONNECTED PERSONAL INTELLIGENCE</p>
          <h2>{firstName ? `Good morning, ${firstName}` : 'Good morning'}<span>.</span></h2>
          <p className="subcopy">
            {docCountDisplay > 0 || activeTasks.length > 0
              ? `Connected view across ${docCountDisplay} LifeFile document(s), ${prodCountDisplay} product(s), and ${pendingCount} pending task(s).`
              : 'Upload documents or add tasks to start building your personal LifeFile.'}
          </p>
        </div>
        <button className="primary-button" onClick={() => setActive('assistant')}><Sparkles size={16} /> Ask AURA</button>
      </section>
      <section className="stats-grid">
        <button className="stat-card" onClick={() => setActive('documents')}><div><span className="stat-label">IN YOUR LIFEFILE</span><strong>{docCountDisplay}</strong><small>{docCountDisplay > 0 ? 'uploaded documents' : 'LifeFile archive ready'}</small></div><IconBox icon={Archive} tone="coral" /></button>
        <button className="stat-card" onClick={() => setActive('tasks')}><div><span className="stat-label">NEEDS ATTENTION</span><strong>{pendingCount}</strong><small>{completedCount} completed · {activeTasks.length} total</small></div><IconBox icon={Bell} tone="violet" /></button>
        <button className="stat-card" onClick={() => setActive('products')}><div><span className="stat-label">PROTECTED PRODUCTS</span><strong>{prodCountDisplay}</strong><small>{warrantySubtext}</small></div><IconBox icon={ShieldCheck} tone="green" /></button>
        <button className="stat-card" onClick={() => setActive('support')}><div><span className="stat-label">SUPPORT CONTACTS</span><strong>{liveStats?.contactsCount || 0}</strong><small>verified company helplines</small></div><IconBox icon={Headphones} tone="blue" /></button>
      </section>
      <section className="overview-grid">
        <div className="panel assistant-prompt">
          <div className="panel-head"><div><span className="section-kicker">AURA AI</span><h3>What can I help you with?</h3></div><span className="online"><i /> Ready</span></div>
          <p className="muted">Ask naturally across your documents, products, support contacts, and approved memories.</p>
          <div className="prompt-input" onClick={() => setActive('assistant')}><span>Try &quot;Show my products with their invoices and manuals&quot;</span><ArrowUpRight size={17} /></div>
          <div className="suggestions">
            <button onClick={() => onAskAura('Which products have warranties expiring soon?')}><Package size={14} />Expiring warranties</button>
            <button onClick={() => onAskAura('Which upcoming tasks are linked to my insurance documents?')}><Clock3 size={14} />Insurance tasks</button>
            <button onClick={() => onAskAura('Which company should I contact for my washing machine?')}><Phone size={14} />Support contacts</button>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">LIFE ADMIN · {pendingCount} PENDING · {completedCount} DONE</span>
              <h3>Coming up</h3>
            </div>
            <button className="text-button" onClick={() => setActive('tasks')}>View all <ArrowUpRight size={14} /></button>
          </div>
          {taskError && (
            <div style={{ marginTop: '8px', padding: '7px 10px', background: '#fae9e5', color: '#c96656', borderRadius: '6px', fontSize: '11px' }}>
              {taskError}
            </div>
          )}
          <div className="task-list">
            {overviewTasks.length > 0 ? (
              overviewTasks.map((task) => {
                const isDone = task.status === 'completed'
                const tone =
                  task.category === 'insurance'
                    ? 'violet'
                    : task.category === 'warranty'
                    ? 'blue'
                    : task.category === 'personal'
                    ? 'green'
                    : 'coral'
                return (
                  <div className="task-row" key={task.id}>
                    <button
                      type="button"
                      className={`check ${isDone ? 'checked' : ''}`}
                      onClick={() => onToggleTask(task)}
                      aria-label={isDone ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                      aria-pressed={isDone}
                      aria-busy={togglingTaskIds?.has(task.id) || undefined}
                    >
                      {isDone && <Check size={13} />}
                    </button>
                    <div>
                      <strong style={{ textDecoration: isDone ? 'line-through' : 'none', color: isDone ? '#8c8880' : undefined }}>
                        {task.title}
                      </strong>
                      <span>Due {task.dueDate} · {task.category}{isDone ? ' · Completed' : ''}</span>
                    </div>
                    <span className={`task-dot ${tone}`} />
                  </div>
                )
              })
            ) : (
              <div style={{ padding: '18px 0', fontSize: '12px', color: 'var(--muted-foreground)' }}>
                No pending or completed tasks yet. Open <button className="text-button" style={{ display: 'inline' }} onClick={() => setActive('tasks')}>Tasks &amp; Reminders</button> to add or sync from LifeFile.
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="bottom-grid">
        <div className="panel"><div className="panel-head"><div><span className="section-kicker">RECENTLY ADDED · SAMPLE SHOWCASE</span><h3>Demo reference documents</h3></div><button className="text-button" onClick={() => setActive('documents')}>Open LifeFile <ArrowUpRight size={14} /></button></div><div className="document-list">{documents.slice(0, 3).map(doc => <div className="document-row" key={doc.name}><IconBox icon={doc.icon} tone={doc.color} /><div><strong>{doc.name}</strong><span>{doc.meta} (Demo)</span></div><span className="date">{doc.date}</span><MoreHorizontal size={17} className="more" /></div>)}</div></div>
        <div className="panel insight"><div className="insight-icon"><Sparkles size={18} /></div><span className="section-kicker">PROACTIVE SUGGESTION</span><h3>{suggestions.length > 0 ? suggestions[0].title : 'All your records, linked cleanly.'}</h3><p>{suggestions.length > 0 ? suggestions[0].description : 'Upload invoices, warranties, and insurance documents to connect products, helplines, and ask AURA to explain clauses or checklists.'}</p><button className="outline-button" onClick={() => suggestions.length > 0 ? onAskAura(suggestions[0].suggestedPrompt) : setActive('assistant')}>{suggestions.length > 0 ? 'Prepare with AURA' : 'Ask AURA AI'} <ArrowUpRight size={14} /></button></div>
      </section>
    </div>
  )
}

function Assistant({
  setActive,
  initialPrompt,
  clearInitialPrompt,
  profile,
  onOpenFormGuide,
}: {
  setActive?: (id: string) => void
  initialPrompt?: string | null
  clearInitialPrompt?: () => void
  profile: UserProfile
  onOpenFormGuide?: (docId: string) => void
}) {
  const userInitials = getProfileInitials(profile.name)
  const [messages, setMessages] = useState<Array<{
    from: 'aura' | 'user'
    text: string
    action?: string
    sources?: Array<{
      documentId: string
      originalFilename: string
      documentType: string
      relevantField?: string
      fileUrl: string
    }>
    memoryProposal?: MemoryProposal | null
    memorySaved?: boolean
    memoryRejected?: boolean
    formGuideDoc?: {
      documentId: string
      originalFilename: string
      formTitle: string | null
    } | null
  }>>([
    { from: 'aura', text: 'Hello! I am AURA, your personal assistant. I can help you search your LifeFile, manage products & support contacts, or track warranties and bills.' },
    { from: 'user', text: 'When does my laptop warranty expire?' },
    { from: 'aura', text: 'Your MacBook Air M2 warranty expires on 20 November 2027. (Sample demonstration record).', action: 'warranty' },
  ])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isAttaching, setIsAttaching] = useState(false)
  const [autoSpeakEnabled, setAutoSpeakEnabled] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const attachInputRef = useRef<HTMLInputElement | null>(null)

  const {
    state,
    errorMessage,
    clearError,
    toggleRecording,
    speakText,
    stopSpeaking,
  } = useVoiceAssistant({ defaultLanguage: 'hi-IN', autoSpeakResponse: autoSpeakEnabled })

  const send = async (textOverride?: string) => {
    const textToSend = (textOverride || input).trim()
    if (!textToSend || isSending || state === 'recording') return

    setInput('')
    setIsSending(true)
    clearError()

    const newMessages = [...messages, { from: 'user' as const, text: textToSend }]
    setMessages(newMessages)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          messages: newMessages.map((m) => ({
            role: m.from === 'aura' ? 'assistant' : 'user',
            content: m.text,
          })),
        }),
      })

      const data = await response.json()
      if (data.success && data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            from: 'aura' as const,
            text: data.reply,
            sources: data.sources,
            memoryProposal: data.memoryProposal || null,
            formGuideDoc: data.formGuideDoc || null,
          },
        ])
        if (autoSpeakEnabled) {
          speakText(data.reply)
        }
      } else {
        setMessages((prev) => [
          ...prev,
          { from: 'aura' as const, text: data.error || 'AURA was unable to answer right now.' },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { from: 'aura' as const, text: 'Network connection to AURA assistant failed.' },
      ])
    } finally {
      setIsSending(false)
    }
  }

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      const p = initialPrompt.trim()
      clearInitialPrompt?.()
      send(p)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt])

  const handleApproveMemory = async (msgIndex: number, proposal: MemoryProposal) => {
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: proposal.proposedContent,
          category: proposal.category,
          approvedByUser: true,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setMessages((prev) =>
          prev.map((msg, idx) =>
            idx === msgIndex ? { ...msg, memorySaved: true, memoryProposal: null } : msg
          )
        )
      }
    } catch {}
  }

  const handleDismissMemoryProposal = (msgIndex: number) => {
    setMessages((prev) =>
      prev.map((msg, idx) =>
        idx === msgIndex ? { ...msg, memoryProposal: null, memoryRejected: true } : msg
      )
    )
  }

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsAttaching(true)
    try {
      const res = await postDocumentUpload({ endpoint: '/api/documents', file })
      const data = await res.json()
      if (data.success && data.document) {
        const doc: StoredDocument = data.document
        const summaryInfo =
          doc.extractionStatus === 'completed' && doc.extractedData
            ? `${doc.extractedData.documentType}${doc.extractedData.issuer ? ` from ${doc.extractedData.issuer}` : ''}${doc.extractedData.totalAmount != null ? ` (₹${doc.extractedData.totalAmount})` : ''}`
            : 'uploaded (extraction pending/failed)'
        const isFormUpload = Boolean(doc.extractedData?.isForm || doc.extractedData?.formAnalysis?.isForm)
        setMessages((prev) => [
          ...prev,
          { from: 'user' as const, text: `Uploaded document: ${doc.originalFilename}` },
          {
            from: 'aura' as const,
            text: isFormUpload
              ? `I saved your form "${doc.originalFilename}" and detected ${doc.extractedData?.formAnalysis?.fields?.length || 0} field(s). Ask "What should I fill in this form?" or open the step-by-step Interactive Form Guide below.`
              : `I saved "${doc.originalFilename}" (${summaryInfo}) to your LifeFile and synced linked products, contacts & deadlines. What would you like to know about it?`,
            sources: [
              {
                documentId: doc.id,
                originalFilename: doc.originalFilename,
                documentType: doc.extractedData?.documentType || 'Other',
                fileUrl: `/api/documents/${doc.id}/file`,
              },
            ],
            formGuideDoc: isFormUpload
              ? {
                  documentId: doc.id,
                  originalFilename: doc.originalFilename,
                  formTitle: doc.extractedData?.formAnalysis?.formTitle || doc.extractedData?.documentTitle || null,
                }
              : null,
          },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { from: 'aura' as const, text: `Upload failed: ${data.error || 'Unsupported or invalid file.'}` },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { from: 'aura' as const, text: 'Network error while uploading attachment to LifeFile.' },
      ])
    } finally {
      setIsAttaching(false)
      if (attachInputRef.current) attachInputRef.current.value = ''
    }
  }

  const handleExportChat = () => {
    const text = messages.map((m) => `[${m.from.toUpperCase()}]: ${m.text}`).join('\n\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aura-conversation-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleVoiceToggle = () => {
    const history = messages.map((m) => ({
      role: (m.from === 'aura' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.text,
    }))
    toggleRecording(
      (transcript) => {
        setMessages((prev) => [...prev, { from: 'user' as const, text: transcript }])
      },
      (reply, sources, memoryProposal) => {
        setMessages((prev) => [
          ...prev,
          { from: 'aura' as const, text: reply, sources, memoryProposal: memoryProposal || null },
        ])
      },
      history
    )
  }

  const placeholderText =
    state === 'recording'
      ? '🎙️ Listening... (click mic or stop to finish)'
      : state === 'transcribing'
      ? '⏳ Transcribing speech with Gnani Prisma...'
      : state === 'thinking' || isSending
      ? '✨ AURA is thinking...'
      : 'Ask AURA anything (in English or हिन्दी)...'

  return (
    <div className="content assistant-page">
      <div className="page-heading">
        <div>
          <span className="section-kicker">AURA AI</span>
          <h2>Your personal assistant</h2>
          <p className="subcopy">One place to ask, understand and get things done.</p>
        </div>
        <button className="outline-button" onClick={() => setShowHistory((prev) => !prev)}>
          <Clock3 size={15} /> {showHistory ? 'Hide history' : 'Conversation history'}
        </button>
      </div>
      {showHistory && (
        <div className="panel" style={{ marginBottom: '14px', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '12px' }}>
            <strong>Current Session:</strong> {messages.length} message(s) · Voice auto-speak is <strong>{autoSpeakEnabled ? 'ON' : 'MUTED'}</strong>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="outline-button" style={{ padding: '6px 10px', fontSize: '11px' }} onClick={handleExportChat}>
              <Download size={13} /> Export TXT
            </button>
            <button
              className="outline-button"
              style={{ padding: '6px 10px', fontSize: '11px', color: '#c96656', borderColor: '#f0d4cc' }}
              onClick={() => {
                setMessages([
                  { from: 'aura', text: 'Conversation cleared. Ask me anything about your LifeFile, products, tasks, or support contacts.' },
                ])
                setShowHistory(false)
              }}
            >
              <Trash2 size={13} /> Clear Chat
            </button>
          </div>
        </div>
      )}
      <div className="chat-layout">
        <div className="panel chat-panel">
          <div className="chat-head">
            <div className="aura-orb">
              <Sparkles size={20} />
            </div>
            <div>
              <strong>AURA</strong>
              <span>
                <i /> Online · Gnani Prisma STT &amp; Timbre TTS ready
              </span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {state === 'speaking' && (
                <button
                  onClick={stopSpeaking}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: '#fae9e5',
                    border: '1px solid #f0d4cc',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    color: 'var(--coral)',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                  title="Stop speaking"
                >
                  <Volume2 size={13} />
                  <span>Speaking · Stop</span>
                </button>
              )}
              <button
                onClick={() => {
                  if (autoSpeakEnabled) stopSpeaking()
                  setAutoSpeakEnabled((v) => !v)
                }}
                className="outline-button"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                title={autoSpeakEnabled ? 'Mute voice replies' : 'Enable voice replies'}
              >
                {autoSpeakEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                <span>{autoSpeakEnabled ? 'Voice On' : 'Muted'}</span>
              </button>
            </div>
          </div>
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`message ${m.from}`}>
                <div className="message-avatar">
                  {m.from === 'aura' ? <Sparkles size={14} /> : userInitials}
                </div>
                <div>
                  <p>{m.text}</p>
                  {m.sources && m.sources.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {m.sources.map((src, idx) => (
                        <a
                          key={idx}
                          href={src.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '11px',
                            padding: '3px 8px',
                            background: '#eff6ff',
                            color: '#2563eb',
                            borderRadius: '4px',
                            textDecoration: 'none',
                            border: '1px solid #dbeafe',
                            fontWeight: 500,
                          }}
                          title={`Open ${src.originalFilename} in LifeFile`}
                        >
                          <FileText size={12} />
                          <span>Source: <strong>{src.originalFilename}</strong> ({src.documentType})</span>
                          <ExternalLink size={10} />
                        </a>
                      ))}
                    </div>
                  )}
                  {m.formGuideDoc && onOpenFormGuide && (
                    <div style={{ marginTop: '8px' }}>
                      <button
                        type="button"
                        onClick={() => onOpenFormGuide(m.formGuideDoc!.documentId)}
                        className="primary-button"
                        style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '7px' }}
                      >
                        <FileCheck2 size={13} />
                        Open Interactive Form Guide
                        {m.formGuideDoc.formTitle ? ` · ${m.formGuideDoc.formTitle}` : ''}
                      </button>
                    </div>
                  )}
                  {m.memoryProposal && (
                    <div style={{ marginTop: '8px', padding: '10px 12px', background: '#f8efe9', border: '1px solid #f0dfd5', borderRadius: '8px', fontSize: '11px' }}>
                      <strong style={{ display: 'block', marginBottom: '4px' }}>Save to Personal Memory? (Requires Approval)</strong>
                      <p style={{ margin: '0 0 8px', background: 'transparent', padding: 0 }}>{m.memoryProposal.proposedContent} <em>({m.memoryProposal.category})</em></p>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="primary-button" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleApproveMemory(i, m.memoryProposal!)}>
                          Save to Memory
                        </button>
                        <button className="outline-button" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleDismissMemoryProposal(i)}>
                          Don&apos;t Save
                        </button>
                      </div>
                    </div>
                  )}
                  {m.memorySaved && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#5f916e', fontWeight: 600 }}>
                      ✓ Saved to your Personal Memory
                    </div>
                  )}
                  {m.memoryRejected && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#77736c' }}>
                      Not saved to Personal Memory — kept private.
                    </div>
                  )}
                  {m.from === 'aura' && (
                    <div className="message-actions">
                      {i === 2 && (
                        <>
                          <button onClick={() => setActive?.('products')}>Show document</button>
                          <button onClick={() => setActive?.('tasks')}>Set reminder</button>
                        </>
                      )}
                      <button
                        onClick={() => speakText(m.text)}
                        title="Listen to this response"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Volume2 size={11} /> Speak
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(isSending || state === 'thinking') && (
              <div className="message aura">
                <div className="message-avatar">
                  <Sparkles size={14} />
                </div>
                <div>
                  <p style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Loader2 size={13} className="animate-spin" /> Thinking...
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="chat-composer">
            {errorMessage && (
              <div
                style={{
                  padding: '7px 11px',
                  background: '#fae9e5',
                  color: '#c96656',
                  borderRadius: '6px',
                  fontSize: '11px',
                  marginBottom: '10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{errorMessage}</span>
                <button
                  onClick={clearError}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="composer-row">
              <div className="composer-field">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) send()
                  }}
                  disabled={state === 'recording' || state === 'transcribing' || isSending}
                  placeholder={placeholderText}
                  aria-label="Ask AURA"
                />
                <input
                  type="file"
                  ref={attachInputRef}
                  onChange={handleAttachFile}
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="attach-button"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={isAttaching}
                  aria-label="Attach document"
                  title="Upload PDF/image directly to LifeFile"
                >
                  {isAttaching ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={18} />}
                </button>
              </div>
              <div className="composer-actions">
                <button
                  type="button"
                  className={`mic-button ${
                    state === 'recording'
                      ? 'is-recording'
                      : state === 'speaking'
                      ? 'is-speaking'
                      : ''
                  }`}
                  onClick={handleVoiceToggle}
                  disabled={state === 'transcribing' || isSending}
                  aria-label={state === 'recording' ? 'Stop recording' : 'Voice input'}
                  title={state === 'recording' ? 'Stop recording & send' : 'Speak in Hindi/English'}
                >
                  {state === 'recording' ? (
                    <Square size={15} fill="currentColor" />
                  ) : state === 'transcribing' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : state === 'speaking' ? (
                    <Volume2 size={18} />
                  ) : (
                    <Mic size={18} />
                  )}
                </button>
                <button
                  type="button"
                  className="send-button"
                  onClick={() => send()}
                  disabled={isSending || state === 'recording' || state === 'transcribing'}
                  aria-label="Send message"
                  title="Send text message"
                >
                  {isSending ? <Loader2 size={15} className="animate-spin" /> : <Send size={17} />}
                </button>
              </div>
            </div>
            <small>
              {state === 'recording'
                ? '🔴 Recording your voice with microphone... click the stop button to send to Gnani Prisma.'
                : 'AURA uses Gnani Prisma STT & Timbre TTS with grounded LifeFile context.'}
            </small>
          </div>
        </div>
        <aside className="assistant-aside">
          <div className="panel">
            <span className="section-kicker">DOCUMENT &amp; LIFE INTELLIGENCE</span>
            <h3>Try asking</h3>
            <div className="question-list">
              <button onClick={() => send('What should I fill in this form?')}>
                What should I fill in this form? <ArrowUpRight size={14} />
              </button>
              <button onClick={() => send('Explain complicated clauses, fees, exclusions, and deadlines in my uploaded documents in simple language')}>
                Explain clauses, fees &amp; deadlines simply <ArrowUpRight size={14} />
              </button>
              <button onClick={() => send('Compare my uploaded documents or warranty versions and prepare a claim checklist')}>
                Compare docs &amp; prepare claim checklist <ArrowUpRight size={14} />
              </button>
              <button onClick={() => send('Draft a customer support email for my product (approval required)')}>
                Draft a support email (approval required) <ArrowUpRight size={14} />
              </button>
              <button onClick={() => send('मेरा बिजली का बिल कितना है?')}>
                मेरा बिजली का बिल कितना है? <ArrowUpRight size={14} />
              </button>
              <button onClick={() => send('Show my products with their invoices and manuals')}>
                Show my products with their invoices and manuals <ArrowUpRight size={14} />
              </button>
              <button onClick={() => send('Which upcoming tasks are linked to my insurance documents?')}>
                Which upcoming tasks are linked to my insurance documents? <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
          <div className="panel privacy-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Private by design</strong>
              <p>Your conversations are part of your personal memory. You can review or delete them anytime.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Documents({
  setActive,
  onDocumentsChanged,
  onAskAura,
  onOpenFormGuide,
}: {
  setActive: (id: string) => void
  onDocumentsChanged?: () => void
  onAskAura?: (prompt: string) => void
  onOpenFormGuide?: (docId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [uploadedDocs, setUploadedDocs] = useState<StoredDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<StoredDocument | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed'>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'amount' | 'issuer'>('newest')
  const [showPreview, setShowPreview] = useState(false)
  const [isEditingMeta, setIsEditingMeta] = useState(false)
  const [guidedOpen, setGuidedOpen] = useState(false)
  const [guidedUseCamera, setGuidedUseCamera] = useState(false)
  const [metaIssuer, setMetaIssuer] = useState('')
  const [metaAmount, setMetaAmount] = useState('')
  const [metaDueDate, setMetaDueDate] = useState('')
  const [metaWarrantyExpiry, setMetaWarrantyExpiry] = useState('')
  const [metaProductName, setMetaProductName] = useState('')
  const [metaSerialNumber, setMetaSerialNumber] = useState('')
  const [metaContactDetails, setMetaContactDetails] = useState('')
  const [isSavingMeta, setIsSavingMeta] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Fetch uploaded documents on mount
  useEffect(() => {
    async function loadDocuments() {
      try {
        setIsLoading(true)
        const res = await fetch('/api/documents')
        const data = await res.json()
        if (data.success && Array.isArray(data.documents)) {
          setUploadedDocs(data.documents)
        }
      } catch (err) {
        console.warn('Could not load uploaded documents:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadDocuments()
  }, [])

  // File upload handler
  const handleUploadFile = async (file: File) => {
    setUploadError(null)
    setIsUploading(true)
    setUploadStatus(`Uploading ${file.name} & extracting data with Gemini...`)

    try {
      const response = await postDocumentUpload({ endpoint: '/api/documents', file })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Upload failed with status ${response.status}`)
      }

      const newDoc: StoredDocument = data.document
      setUploadedDocs((prev) => [newDoc, ...prev.filter((d) => d.id !== newDoc.id)])
      setUploadStatus(null)

      // Open details modal for the newly processed document
      openDocModal(newDoc)
      onDocumentsChanged?.()
    } catch (err: any) {
      setUploadError(err.message || 'An unexpected error occurred during upload.')
    } finally {
      setIsUploading(false)
      setUploadStatus(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleUploadFile(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleUploadFile(file)
    }
  }

  // Delete document handler
  const handleDeleteDoc = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document from LifeFile?')) return

    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setUploadedDocs((prev) => prev.filter((d) => d.id !== id))
        if (selectedDoc?.id === id) {
          setSelectedDoc(null)
        }
        onDocumentsChanged?.()
      } else {
        alert(data.error || 'Failed to delete document.')
      }
    } catch {
      alert('Network error while deleting document.')
    }
  }

  // Retry extraction handler
  const handleRetryExtraction = async (id: string) => {
    setIsRetrying(true)
    try {
      const res = await fetch(`/api/documents/${id}/extract`, { method: 'POST' })
      const data = await res.json()
      if (data.success && data.document) {
        const updated = data.document
        setUploadedDocs((prev) => prev.map((d) => (d.id === id ? updated : d)))
        openDocModal(updated)
        onDocumentsChanged?.()
      } else {
        alert(data.error || 'Retry extraction failed.')
      }
    } catch {
      alert('Network error during extraction retry.')
    } finally {
      setIsRetrying(false)
    }
  }

  const openDocModal = (doc: StoredDocument) => {
    setSelectedDoc(doc)
    setShowPreview(false)
    setIsEditingMeta(false)
    setMetaIssuer(doc.extractedData?.issuer || '')
    setMetaAmount(doc.extractedData?.totalAmount != null ? String(doc.extractedData.totalAmount) : '')
    setMetaDueDate(doc.extractedData?.dueDate || doc.extractedData?.expiryDate || '')
    setMetaWarrantyExpiry(doc.extractedData?.warrantyExpiry || '')
    setMetaProductName(doc.extractedData?.productName || '')
    setMetaSerialNumber(doc.extractedData?.serialNumber || '')
    setMetaContactDetails(doc.extractedData?.contactDetails || '')
  }

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDoc) return
    setIsSavingMeta(true)
    try {
      const parsedAmount = metaAmount.trim() ? Number(metaAmount.trim()) : null
      const res = await fetch(`/api/documents/${selectedDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractedData: {
            issuer: metaIssuer.trim() || null,
            totalAmount: parsedAmount !== null && !Number.isNaN(parsedAmount) ? parsedAmount : null,
            dueDate: metaDueDate.trim() || null,
            warrantyExpiry: metaWarrantyExpiry.trim() || null,
            productName: metaProductName.trim() || null,
            serialNumber: metaSerialNumber.trim() || null,
            contactDetails: metaContactDetails.trim() || null,
          },
        }),
      })
      const data = await res.json()
      if (data.success && data.document) {
        setUploadedDocs((prev) => prev.map((d) => (d.id === selectedDoc.id ? data.document : d)))
        openDocModal(data.document)
        onDocumentsChanged?.()
      }
    } catch {
      alert('Failed to save metadata edits.')
    } finally {
      setIsSavingMeta(false)
    }
  }

  // Filter & sort uploaded documents
  const filteredUploaded = useMemo(() => {
    const filtered = uploadedDocs.filter((doc) => {
      const q = search.toLowerCase()
      const matchesSearch =
        doc.originalFilename.toLowerCase().includes(q) ||
        (doc.extractedData?.issuer && doc.extractedData.issuer.toLowerCase().includes(q)) ||
        (doc.extractedData?.documentType && doc.extractedData.documentType.toLowerCase().includes(q)) ||
        (doc.extractedData?.productName && doc.extractedData.productName.toLowerCase().includes(q)) ||
        (doc.extractedData?.summary && doc.extractedData.summary.toLowerCase().includes(q))

      if (!matchesSearch) return false
      if (statusFilter === 'completed' && doc.extractionStatus !== 'completed') return false
      if (statusFilter === 'failed' && doc.extractionStatus === 'completed') return false

      if (categoryFilter === 'All') return true
      const cat = doc.extractedData?.documentType || 'Other'
      if (categoryFilter === 'Bills') return cat === 'Bill' || cat === 'Receipt'
      if (categoryFilter === 'Insurance') return cat === 'Insurance'
      if (categoryFilter === 'Warranties') return cat === 'Warranty'
      if (categoryFilter === 'Invoices') return cat === 'Invoice'
      if (categoryFilter === 'Contracts') return cat === 'Contract' || cat === 'Manual'
      return false
    })

    return [...filtered].sort((a, b) => {
      if (sortBy === 'amount') {
        return (b.extractedData?.totalAmount || 0) - (a.extractedData?.totalAmount || 0)
      }
      if (sortBy === 'issuer') {
        return (a.extractedData?.issuer || a.originalFilename).localeCompare(
          b.extractedData?.issuer || b.originalFilename
        )
      }
      return new Date(b.uploadTimestamp).getTime() - new Date(a.uploadTimestamp).getTime()
    })
  }, [uploadedDocs, search, categoryFilter, statusFilter, sortBy])

  // Filter sample documents
  const filteredSample = useMemo(() => {
    return documents.filter((d) => {
      const q = search.toLowerCase()
      const matchesSearch = d.name.toLowerCase().includes(q) || d.type.toLowerCase().includes(q) || d.meta.toLowerCase().includes(q)
      if (!matchesSearch) return false
      if (categoryFilter === 'All') return true
      if (categoryFilter === 'Bills' && d.type === 'Bill') return true
      if (categoryFilter === 'Insurance' && d.type === 'Insurance') return true
      if (categoryFilter === 'Warranties' && d.type === 'Warranty') return true
      if (categoryFilter === 'Invoices' && d.type === 'Invoice') return true
      return false
    })
  }, [search, categoryFilter])

  // Helper for visual card colors based on category
  const getCategoryTheme = (type?: string | null) => {
    switch (type) {
      case 'Insurance':
        return { color: 'rose', icon: ShieldCheck }
      case 'Invoice':
        return { color: 'amber', icon: ReceiptIndianRupee }
      case 'Bill':
        return { color: 'blue', icon: Zap }
      case 'Warranty':
        return { color: 'violet', icon: Package }
      case 'Receipt':
        return { color: 'green', icon: ReceiptIndianRupee }
      default:
        return { color: 'amber', icon: FileText }
    }
  }

  return (
    <div className="content">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
      />

      <div className="page-heading">
        <div>
          <span className="section-kicker">LIFEFILE ARCHIVE</span>
          <h2>My documents</h2>
          <p className="subcopy">Secure persistent storage & automated Gemini multimodal extraction.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <a
            href="/api/lifefile/export"
            download
            className="outline-button"
            style={{ textDecoration: 'none' }}
            title="Download full LifeFile JSON backup"
          >
            <Download size={15} /> Export Backup
          </a>
          <button
            type="button"
            className="outline-button"
            onClick={() => {
              setGuidedUseCamera(true)
              setGuidedOpen(true)
            }}
            disabled={isUploading}
          >
            <Camera size={16} /> Use Camera
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setGuidedUseCamera(false)
              setGuidedOpen(true)
            }}
            disabled={isUploading}
          >
            {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {isUploading ? 'Uploading & Processing...' : 'Guided Upload'}
          </button>
        </div>
      </div>

      {/* Upload Notification / Progress Banner */}
      {isUploading && (
        <div
          style={{
            padding: '12px 16px',
            background: '#e7f1f5',
            border: '1px solid #6b9ab5',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '12px',
            color: '#242322',
          }}
        >
          <Loader2 size={16} className="animate-spin" style={{ color: '#6b9ab5' }} />
          <span>{uploadStatus || 'Processing document...'}</span>
        </div>
      )}

      {/* Upload Error Banner */}
      {uploadError && (
        <div
          style={{
            padding: '12px 16px',
            background: '#fae9e5',
            border: '1px solid #e47866',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: '#c96656',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{uploadError}</span>
          </div>
          <button
            onClick={() => setUploadError(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Search and Filters Toolbar */}
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by file name, issuer, amount or content..."
          />
        </div>
        <button
          className="filter-button"
          onClick={() =>
            setStatusFilter((prev) =>
              prev === 'all' ? 'completed' : prev === 'completed' ? 'failed' : 'all'
            )
          }
          title="Cycle extraction status filter"
        >
          <Filter size={16} /> Status: {statusFilter === 'all' ? 'All' : statusFilter === 'completed' ? 'Extracted' : 'Failed'}
        </button>
        <button
          className="filter-button"
          onClick={() =>
            setSortBy((prev) =>
              prev === 'newest' ? 'amount' : prev === 'amount' ? 'issuer' : 'newest'
            )
          }
          title="Change document sort order"
        >
          Sort: {sortBy === 'newest' ? 'Recently added' : sortBy === 'amount' ? 'Highest amount' : 'Issuer A-Z'}
        </button>
      </div>

      {/* Category Pills */}
      <div className="category-row">
        {['All', 'Bills', 'Insurance', 'Warranties', 'Invoices', 'Contracts'].map((x) => (
          <button
            className={`category ${categoryFilter === x ? 'active' : ''}`}
            key={x}
            onClick={() => setCategoryFilter(x)}
          >
            {x} {x === 'All' && <b>{uploadedDocs.length + documents.length}</b>}
          </button>
        ))}
      </div>

      {/* Section 1: Real Uploaded Documents (LifeFile Storage) */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <span className="section-kicker" style={{ color: 'var(--coral)', fontWeight: 700 }}>
            YOUR UPLOADED LIFEFILE DOCUMENTS ({uploadedDocs.length})
          </span>
          <span style={{ fontSize: '10px', color: '#97958f' }}>
            Private per-account LifeFile storage · Verified signatures
          </span>
        </div>

        <div className="document-grid">
          {/* Real Uploaded Document Cards */}
          {filteredUploaded.map((doc) => {
            const theme = getCategoryTheme(doc.extractedData?.documentType)
            const Icon = theme.icon
            const typeLabel = doc.extractedData?.documentType || 'Uploaded File'
            const issuer = doc.extractedData?.issuer || 'Unknown Issuer'
            const formattedDate = new Date(doc.uploadTimestamp).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
            const amountText =
              doc.extractedData?.totalAmount != null
                ? ` · ₹${doc.extractedData.totalAmount.toLocaleString('en-IN')}`
                : ''

            return (
              <article className="doc-card" key={doc.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div className={`doc-cover ${theme.color}`}>
                  <Icon size={28} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span>{typeLabel}</span>
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background:
                          doc.extractionStatus === 'completed'
                            ? '#edf5ee'
                            : doc.extractionStatus === 'processing'
                            ? '#eeeaf8'
                            : '#fae9e5',
                        color:
                          doc.extractionStatus === 'completed'
                            ? '#6d9979'
                            : doc.extractionStatus === 'processing'
                            ? '#7365a7'
                            : '#c96656',
                        fontWeight: 600,
                      }}
                    >
                      {doc.extractionStatus === 'completed'
                        ? '✓ Extracted'
                        : doc.extractionStatus === 'processing'
                        ? 'Extracting...'
                        : 'Failed'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteDoc(doc.id)}
                    aria-label="Delete document"
                    title="Delete document"
                    style={{ position: 'absolute', right: '12px', top: '12px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="doc-card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <h3 title={doc.originalFilename} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.originalFilename}
                  </h3>
                  <p>
                    {issuer}
                    {amountText}
                  </p>
                  {(doc.extractedData?.isForm || looksLikeFormDocument(doc)) && (
                    <div style={{ marginTop: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#fae9e5', color: '#b44838', border: '1px solid #f0c9bf' }}>
                        {doc.extractedData?.formAnalysis?.fields?.length
                          ? `Fillable Form · ${doc.extractedData.formAnalysis.fields.length} fields`
                          : 'Blank / Printable Form'}
                      </span>
                    </div>
                  )}
                  <div className="doc-footer" style={{ marginTop: 'auto', paddingTop: '12px' }}>
                    <span>{formattedDate}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {(doc.extractedData?.isForm || looksLikeFormDocument(doc)) && onOpenFormGuide && (
                        <button
                          type="button"
                          onClick={() => onOpenFormGuide(doc.id)}
                          style={{ background: '#fae9e5', border: '1px solid #f0c9bf', borderRadius: '5px', padding: '3px 7px', color: '#b44838', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          <FileCheck2 size={11} /> Fill Guide
                        </button>
                      )}
                      <button
                        onClick={() => openDocModal(doc)}
                        style={{ background: 'transparent', border: 0, color: 'var(--coral)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', cursor: 'pointer' }}
                      >
                        <Eye size={12} /> View Details
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}

          {/* Guided Upload / Drag & Drop Card */}
          <button
            type="button"
            className="upload-card"
            onClick={() => {
              setGuidedUseCamera(false)
              setGuidedOpen(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={
              isDragging
                ? { borderColor: 'var(--coral)', background: '#fae9e5' }
                : undefined
            }
          >
            <div>
              <Plus size={24} />
            </div>
            <strong>{isDragging ? 'Drop file to upload' : 'Guided upload or drop file'}</strong>
            <span>PDF, JPG, PNG, WEBP up to 10 MB · Camera supported</span>
          </button>
        </div>
      </div>

      {/* Section 2: Sample Demonstration Documents */}
      <div style={{ marginTop: '36px', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <span className="section-kicker">SAMPLE DEMONSTRATION DOCUMENTS (PRE-LOADED)</span>
          <span style={{ fontSize: '10px', color: '#97958f' }}>Reference records for Ananya Kapoor</span>
        </div>

        <div className="document-grid">
          {filteredSample.map((doc) => (
            <article className="doc-card" key={doc.name}>
              <div className={`doc-cover ${doc.color}`}>
                <doc.icon size={28} />
                <span>{doc.type} (Sample)</span>
                <button aria-label="More options">
                  <MoreHorizontal size={17} />
                </button>
              </div>
              <div className="doc-card-body">
                <h3>{doc.name}</h3>
                <p>{doc.meta}</p>
                <div className="doc-footer">
                  <span>{doc.date}</span>
                  <button onClick={() => setActive('assistant')}>
                    Ask AURA <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Document Details Modal */}
      {selectedDoc && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(2px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setSelectedDoc(null)}
        >
          <div
            className="panel"
            style={{
              maxWidth: '620px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#fff',
              borderRadius: '12px',
              padding: '28px',
              position: 'relative',
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '20px' }}>
              <div>
                <span className="section-kicker">DOCUMENT INTELLIGENCE</span>
                <h3 style={{ fontSize: '18px', margin: '4px 0' }}>{selectedDoc.originalFilename}</h3>
                <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                  ID: {selectedDoc.id} · {(selectedDoc.fileSize / 1024).toFixed(1)} KB · {selectedDoc.mimeType}
                </span>
              </div>
              <button
                onClick={() => setSelectedDoc(null)}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Extraction Status Indicator */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                borderRadius: '8px',
                background:
                  selectedDoc.extractionStatus === 'completed'
                    ? '#edf5ee'
                    : selectedDoc.extractionStatus === 'processing'
                    ? '#eeeaf8'
                    : '#fae9e5',
                color:
                  selectedDoc.extractionStatus === 'completed'
                    ? '#5f916e'
                    : selectedDoc.extractionStatus === 'processing'
                    ? '#7365a7'
                    : '#c96656',
                fontSize: '11px',
                fontWeight: 600,
                marginBottom: '18px',
              }}
            >
              {selectedDoc.extractionStatus === 'completed' ? (
                <>
                  <Check size={14} />
                  <span>Gemini multimodal extraction completed successfully.</span>
                </>
              ) : selectedDoc.extractionStatus === 'processing' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Processing document extraction with Gemini...</span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} />
                  <span>
                    Extraction failed: {selectedDoc.extractionError || 'Could not extract facts from document.'}
                  </span>
                </>
              )}
            </div>

            {/* Inline File Preview */}
            {showPreview && (
              <div style={{ marginBottom: '18px', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', background: '#faf9f7' }}>
                {selectedDoc.mimeType.startsWith('image/') ? (
                  <img
                    src={`/api/documents/${selectedDoc.id}/file`}
                    alt={selectedDoc.originalFilename}
                    style={{ width: '100%', maxHeight: '320px', objectFit: 'contain', display: 'block' }}
                  />
                ) : (
                  <iframe
                    src={`/api/documents/${selectedDoc.id}/file`}
                    title={selectedDoc.originalFilename}
                    style={{ width: '100%', height: '320px', border: 0 }}
                  />
                )}
              </div>
            )}

            {/* Edit Metadata Form OR Extracted Facts Grid */}
            {isEditingMeta ? (
              <form onSubmit={handleSaveMeta} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600 }}>Issuer / Company</label>
                  <input value={metaIssuer} onChange={(e) => setMetaIssuer(e.target.value)} style={{ width: '100%', padding: '7px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600 }}>Total Amount</label>
                  <input type="number" step="0.01" value={metaAmount} onChange={(e) => setMetaAmount(e.target.value)} style={{ width: '100%', padding: '7px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600 }}>Due Date (YYYY-MM-DD)</label>
                  <input value={metaDueDate} onChange={(e) => setMetaDueDate(e.target.value)} placeholder="YYYY-MM-DD" style={{ width: '100%', padding: '7px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600 }}>Warranty Expiry (YYYY-MM-DD)</label>
                  <input value={metaWarrantyExpiry} onChange={(e) => setMetaWarrantyExpiry(e.target.value)} placeholder="YYYY-MM-DD" style={{ width: '100%', padding: '7px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600 }}>Product Name</label>
                  <input value={metaProductName} onChange={(e) => setMetaProductName(e.target.value)} style={{ width: '100%', padding: '7px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600 }}>Serial Number</label>
                  <input value={metaSerialNumber} onChange={(e) => setMetaSerialNumber(e.target.value)} style={{ width: '100%', padding: '7px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600 }}>Customer Care Contact Details</label>
                  <input value={metaContactDetails} onChange={(e) => setMetaContactDetails(e.target.value)} style={{ width: '100%', padding: '7px', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                  <button type="button" className="outline-button" onClick={() => setIsEditingMeta(false)}>Cancel</button>
                  <button type="submit" className="primary-button" disabled={isSavingMeta}>{isSavingMeta ? 'Saving...' : 'Save Metadata'}</button>
                </div>
              </form>
            ) : (
              selectedDoc.extractedData && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '12px' }}>
                <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Document Type</span>
                  <strong style={{ display: 'block', fontSize: '14px', marginTop: '4px', color: 'var(--coral)' }}>
                    {selectedDoc.extractedData.documentType}
                  </strong>
                </div>

                <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Issuer / Provider</span>
                  <strong style={{ display: 'block', fontSize: '14px', marginTop: '4px' }}>
                    {selectedDoc.extractedData.issuer || 'Not found'}
                  </strong>
                </div>

                <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Customer / Name</span>
                  <strong style={{ display: 'block', fontSize: '13px', marginTop: '4px' }}>
                    {selectedDoc.extractedData.customerName || 'Not found'}
                  </strong>
                </div>

                <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Total Amount</span>
                  <strong style={{ display: 'block', fontSize: '14px', marginTop: '4px', color: selectedDoc.extractedData.totalAmount != null ? '#6d9979' : '#78746c' }}>
                    {selectedDoc.extractedData.totalAmount != null
                      ? `${selectedDoc.extractedData.currency || '₹'} ${selectedDoc.extractedData.totalAmount.toLocaleString('en-IN')}`
                      : 'Not found'}
                  </strong>
                </div>

                <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Document Date</span>
                  <strong style={{ display: 'block', fontSize: '13px', marginTop: '4px' }}>
                    {selectedDoc.extractedData.documentDate || 'Not found'}
                  </strong>
                </div>

                <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Due / Expiry Date</span>
                  <strong style={{ display: 'block', fontSize: '13px', marginTop: '4px', color: selectedDoc.extractedData.dueDate ? 'var(--coral)' : undefined }}>
                    {selectedDoc.extractedData.dueDate || selectedDoc.extractedData.expiryDate || selectedDoc.extractedData.warrantyExpiry || 'Not found'}
                  </strong>
                </div>

                {selectedDoc.extractedData.serialNumber && (
                  <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', gridColumn: 'span 2' }}>
                    <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Serial Number / Model</span>
                    <strong style={{ display: 'block', fontSize: '13px', marginTop: '4px' }}>
                      {selectedDoc.extractedData.serialNumber} {selectedDoc.extractedData.modelNumber ? `(${selectedDoc.extractedData.modelNumber})` : ''}
                    </strong>
                  </div>
                )}

                {selectedDoc.extractedData.policyNumber && (
                  <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', gridColumn: 'span 2' }}>
                    <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>Policy Number</span>
                    <strong style={{ display: 'block', fontSize: '13px', marginTop: '4px' }}>
                      {selectedDoc.extractedData.policyNumber}
                    </strong>
                  </div>
                )}

                {selectedDoc.extractedData.summary && (
                  <div style={{ background: '#faf9f7', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', gridColumn: 'span 2' }}>
                    <span style={{ fontSize: '10px', color: '#97958f', fontWeight: 600, textTransform: 'uppercase' }}>AI Summary</span>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#555', lineHeight: 1.5 }}>
                      {selectedDoc.extractedData.summary}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {/* Modal Actions */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '18px' }}>
              <button
                className="outline-button"
                onClick={() => handleDeleteDoc(selectedDoc.id)}
                style={{ color: '#c96656', borderColor: '#f0d4cc' }}
              >
                <Trash2 size={14} /> Delete
              </button>

              <button
                className="outline-button"
                onClick={() => setIsEditingMeta((v) => !v)}
              >
                <Pencil size={14} /> {isEditingMeta ? 'Cancel Edit' : 'Edit Metadata'}
              </button>

              <button
                className="outline-button"
                onClick={() => setShowPreview((v) => !v)}
              >
                <Eye size={14} /> {showPreview ? 'Hide Preview' : 'Preview'}
              </button>

              <button
                className="outline-button"
                onClick={() => handleRetryExtraction(selectedDoc.id)}
                disabled={isRetrying}
                title="Re-run Gemini multimodal extraction"
              >
                <RefreshCw size={14} className={isRetrying ? 'animate-spin' : ''} />
                {isRetrying ? 'Extracting...' : 'Re-extract'}
              </button>

              {onOpenFormGuide && (selectedDoc.extractedData?.isForm || looksLikeFormDocument(selectedDoc) || selectedDoc.extractionStatus === 'completed') && (
                <button
                  type="button"
                  className={selectedDoc.extractedData?.isForm || looksLikeFormDocument(selectedDoc) ? 'primary-button' : 'outline-button'}
                  onClick={() => {
                    const targetId = selectedDoc.id
                    setSelectedDoc(null)
                    onOpenFormGuide(targetId)
                  }}
                >
                  <FileCheck2 size={14} /> {selectedDoc.extractedData?.isForm || looksLikeFormDocument(selectedDoc) ? 'Open AI Form Guide' : 'Check Form Guide'}
                </button>
              )}

              {onAskAura && (
                <button
                  className="outline-button"
                  onClick={() => {
                    const name = selectedDoc.originalFilename
                    setSelectedDoc(null)
                    onAskAura(`Explain the key clauses, fees, deadlines, conditions, and any missing info in ${name} in simple language.`)
                  }}
                >
                  <Sparkles size={14} /> Ask AURA
                </button>
              )}

              <a
                href={`/api/documents/${selectedDoc.id}/file?download=1`}
                download={selectedDoc.originalFilename}
                className="outline-button"
                style={{ textDecoration: 'none' }}
              >
                <Download size={14} /> Download
              </a>

              <button className="primary-button" onClick={() => setSelectedDoc(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <GuidedUploadModal
        open={guidedOpen}
        initialUseCamera={guidedUseCamera}
        onClose={() => setGuidedOpen(false)}
        onSaved={(newDoc) => {
          setUploadedDocs((prev) => [newDoc, ...prev.filter((d) => d.id !== newDoc.id)])
          openDocModal(newDoc)
          onDocumentsChanged?.()
        }}
      />
    </div>
  )
}

function Products({ onAskAura }: { onAskAura: (prompt: string) => void }) {
  return <ProductsSection onAskAura={onAskAura} />
}

function Tasks({
  setActive,
  realTasks,
  isLoading,
  isSyncing,
  taskError,
  togglingTaskIds,
  onClearTaskError,
  onToggleTask,
  onSnoozeTask,
  onDismissTask,
  onDeleteTask,
  onSaveOrUpdateTask,
  onSyncLifeFile,
}: {
  setActive?: (id: string) => void
  realTasks: StoredTask[]
  isLoading: boolean
  isSyncing: boolean
  taskError: string | null
  togglingTaskIds?: Set<string>
  onClearTaskError: () => void
  onToggleTask: (task: StoredTask) => Promise<void>
  onSnoozeTask: (id: string, days: number) => Promise<void>
  onDismissTask: (id: string) => Promise<void>
  onDeleteTask: (id: string) => Promise<void>
  onSaveOrUpdateTask: (
    payload: {
      title: string
      dueDate: string
      category: TaskCategory
      priority: TaskPriority
      recurrence: TaskRecurrence
      description: string
    },
    editingTaskId?: string | null
  ) => Promise<{ success: boolean; error?: string }>
  onSyncLifeFile: () => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<'all' | 'overdue' | 'today' | 'upcoming' | 'completed'>('all')
  const [showNewModal, setShowNewModal] = useState(false)

  // Form state for creating / editing a task
  const [editingTask, setEditingTask] = useState<StoredTask | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDueDate, setNewDueDate] = useState(new Date().toISOString().split('T')[0])
  const [newCategory, setNewCategory] = useState<TaskCategory>('bill')
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium')
  const [newRecurrence, setNewRecurrence] = useState<TaskRecurrence>('none')
  const [newDescription, setNewDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Sample tasks toggle state for showcase consistency
  const [sampleItems, setSampleItems] = useState(tasks)

  const handleSyncLifeFile = () => onSyncLifeFile()
  const handleToggleTask = (task: StoredTask) => onToggleTask(task)
  const handleSnoozeTask = (id: string, days: number) => onSnoozeTask(id, days)
  const handleDismissTask = (id: string) => onDismissTask(id)

  const openNewTaskModal = () => {
    setEditingTask(null)
    setNewTitle('')
    setNewDueDate(new Date().toISOString().split('T')[0])
    setNewCategory('bill')
    setNewPriority('medium')
    setNewRecurrence('none')
    setNewDescription('')
    setFormError(null)
    setShowNewModal(true)
  }

  const openEditTaskModal = (task: StoredTask) => {
    setEditingTask(task)
    setNewTitle(task.title)
    setNewDueDate(task.dueDate)
    setNewCategory(task.category)
    setNewPriority(task.priority)
    setNewRecurrence(task.recurrence || 'none')
    setNewDescription(task.description)
    setFormError(null)
    setShowNewModal(true)
  }

  const handleDeleteTask = async (id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return
    await onDeleteTask(id)
  }

  const handleCreateOrUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) {
      setFormError('Task title is required.')
      return
    }
    if (!newDueDate) {
      setFormError('Due date is required.')
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    const result = await onSaveOrUpdateTask(
      {
        title: newTitle.trim(),
        dueDate: newDueDate,
        category: newCategory,
        priority: newPriority,
        recurrence: newRecurrence,
        description: newDescription.trim(),
      },
      editingTask?.id || null
    )

    if (result.success) {
      setShowNewModal(false)
      setEditingTask(null)
    } else {
      setFormError(result.error || 'Failed to save task.')
    }
    setIsSubmitting(false)
  }

  // Reference today string
  const todayStr = new Date().toISOString().split('T')[0]

  // Filter tasks based on activeTab
  const filteredTasks = realTasks.filter((t) => {
    if (activeTab === 'completed') return t.status === 'completed'
    if (activeTab === 'overdue') return t.status === 'pending' && t.dueDate < todayStr
    if (activeTab === 'today') return t.status === 'pending' && t.dueDate === todayStr
    if (activeTab === 'upcoming') return t.status === 'pending' && t.dueDate > todayStr
    return t.status !== 'dismissed' // 'all' tab shows pending and completed
  })

  // Summary counts
  const countOverdue = realTasks.filter((t) => t.status === 'pending' && t.dueDate < todayStr).length
  const countToday = realTasks.filter((t) => t.status === 'pending' && t.dueDate === todayStr).length
  const countUpcoming = realTasks.filter((t) => t.status === 'pending' && t.dueDate > todayStr).length
  const countCompleted = realTasks.filter((t) => t.status === 'completed').length

  // Next deadline calculation for sidebar widget
  const pendingTasksSorted = [...realTasks]
    .filter((t) => t.status === 'pending')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const nextDeadlineTask = pendingTasksSorted[0]

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <span className="section-kicker">LIFE ADMIN · PROACTIVE INTELLIGENCE</span>
          <h2>Tasks & Deadlines</h2>
          <p className="subcopy">Important dates, payments, warranties and renewals from your LifeFile.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="outline-button"
            onClick={handleSyncLifeFile}
            disabled={isSyncing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Scan LifeFile documents for new deadlines"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Sync with LifeFile'}</span>
          </button>
          <button
            className="primary-button"
            onClick={openNewTaskModal}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} /> New task
          </button>
        </div>
      </div>

      {taskError && (
        <div style={{ padding: '10px 14px', background: '#fae9e5', border: '1px solid #f0d4cc', color: '#c96656', borderRadius: '8px', marginBottom: '14px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><AlertCircle size={14} style={{ display: 'inline', marginRight: '6px' }} />{taskError}</span>
          <button onClick={onClearTaskError} style={{ background: 'none', border: 'none', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* New Task Modal */}
      {showNewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="panel"
            style={{ maxWidth: '480px', width: '100%', background: '#fff', borderRadius: '12px', padding: '24px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{editingTask ? 'Edit Task' : 'Create New Task'}</h3>
              <button
                onClick={() => setShowNewModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}
              >
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '13px', marginBottom: '14px' }}>
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateOrUpdateTask} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Task Title *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Pay Internet Bill or Schedule Car Service"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                    Due Date *
                  </label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                    Category
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as TaskCategory)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', background: '#fff' }}
                  >
                    <option value="bill">Bill Payment</option>
                    <option value="insurance">Insurance Policy</option>
                    <option value="warranty">Warranty Expiry</option>
                    <option value="subscription">Subscription</option>
                    <option value="personal">Personal</option>
                    <option value="general">General</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                    Priority
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', background: '#fff' }}
                  >
                    <option value="high">High Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="low">Low Priority</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                    Recurrence
                  </label>
                  <select
                    value={newRecurrence}
                    onChange={(e) => setNewRecurrence(e.target.value as TaskRecurrence)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', background: '#fff' }}
                  >
                    <option value="none">One-time</option>
                    <option value="monthly">Monthly Bill / Cycle</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly Renewal</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Details, reference numbers, or notes..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => setShowNewModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : editingTask ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="task-tabs">
        <button className={activeTab === 'all' ? 'active' : ''} onClick={() => setActiveTab('all')}>
          All <b>{realTasks.length}</b>
        </button>
        <button className={activeTab === 'overdue' ? 'active' : ''} onClick={() => setActiveTab('overdue')}>
          Overdue <b style={{ color: countOverdue > 0 ? '#ef4444' : undefined }}>{countOverdue}</b>
        </button>
        <button className={activeTab === 'today' ? 'active' : ''} onClick={() => setActiveTab('today')}>
          Today <b>{countToday}</b>
        </button>
        <button className={activeTab === 'upcoming' ? 'active' : ''} onClick={() => setActiveTab('upcoming')}>
          Upcoming <b>{countUpcoming}</b>
        </button>
        <button className={activeTab === 'completed' ? 'active' : ''} onClick={() => setActiveTab('completed')}>
          Completed <b>{countCompleted}</b>
        </button>
      </div>

      <div className="task-page-grid">
        <div className="panel large-task-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">ACTIVE SCHEDULE</span>
              <h3>
                {activeTab === 'overdue'
                  ? 'Overdue Tasks'
                  : activeTab === 'today'
                  ? 'Due Today'
                  : activeTab === 'upcoming'
                  ? 'Upcoming Responsibilities'
                  : activeTab === 'completed'
                  ? 'Completed Tasks'
                  : 'All Tasks'}
              </h3>
            </div>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
            </span>
          </div>

          {isLoading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              <p>Loading your Life Admin schedule...</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#6b7280' }}>
              <Clock3 size={32} style={{ margin: '0 auto 10px', color: '#9ca3af' }} />
              <p style={{ fontWeight: 500, color: '#374151' }}>No tasks found in this view</p>
              <p style={{ fontSize: '12px', margin: '4px 0 16px' }}>
                Use <strong>&quot;Sync with LifeFile&quot;</strong> to automatically import deadlines from your uploaded bills and warranties, or click <strong>&quot;New task&quot;</strong>.
              </p>
            </div>
          ) : (
            filteredTasks.map((task) => {
              const isDone = task.status === 'completed'
              const isOverdue = task.status === 'pending' && task.dueDate < todayStr
              const isDueToday = task.status === 'pending' && task.dueDate === todayStr

              let categoryTone = 'neutral'
              if (task.category === 'bill') categoryTone = 'coral'
              if (task.category === 'insurance') categoryTone = 'violet'
              if (task.category === 'warranty') categoryTone = 'blue'
              if (task.category === 'personal') categoryTone = 'green'

              return (
                <div className={`full-task ${isDone ? 'is-done' : ''}`} key={task.id}>
                  <button
                    type="button"
                    className={`check ${isDone ? 'checked' : ''}`}
                    onClick={() => handleToggleTask(task)}
                    aria-label={isDone ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                    aria-pressed={isDone}
                    aria-busy={togglingTaskIds?.has(task.id) || undefined}
                  >
                    {isDone && <Check size={13} />}
                  </button>
                  <div className="full-task-copy">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ textDecoration: isDone ? 'line-through' : 'none' }}>
                        {task.title}
                      </strong>
                      <span className={`tag ${categoryTone}`}>{task.category}</span>
                      {isOverdue && (
                        <span style={{ fontSize: '11px', padding: '1px 6px', background: '#fee2e2', color: '#b91c1c', borderRadius: '4px', fontWeight: 600 }}>
                          Overdue ({task.dueDate})
                        </span>
                      )}
                      {isDueToday && (
                        <span style={{ fontSize: '11px', padding: '1px 6px', background: '#fef3c7', color: '#b45309', borderRadius: '4px', fontWeight: 600 }}>
                          Due Today
                        </span>
                      )}
                      {!isOverdue && !isDueToday && !isDone && (
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>
                          Due: {task.dueDate}
                        </span>
                      )}
                      {task.priority === 'high' && !isDone && (
                        <span style={{ fontSize: '10px', padding: '1px 4px', border: '1px solid #f87171', color: '#ef4444', borderRadius: '3px' }}>
                          HIGH
                        </span>
                      )}
                      {task.recurrence && task.recurrence !== 'none' && (
                        <span style={{ fontSize: '10px', padding: '1px 5px', background: '#eff6ff', color: '#2563eb', borderRadius: '3px', fontWeight: 600 }}>
                          {task.recurrence.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#4b5563' }}>
                      {task.description}
                    </p>
                    {task.linkedDocumentId && (
                      <div style={{ marginTop: '4px' }}>
                        <a
                          href={`/api/documents/${task.linkedDocumentId}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '11px',
                            color: '#3b82f6',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <FileText size={11} />
                          <span>Linked Document: {task.linkedDocumentName || 'View Document'}</span>
                          <ExternalLink size={9} />
                        </a>
                      </div>
                    )}
                    {!isDone && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                        <button
                          className="outline-button"
                          style={{ padding: '3px 7px', fontSize: '10px' }}
                          onClick={() => handleSnoozeTask(task.id, 1)}
                          title="Snooze due date by 1 day"
                        >
                          Snooze +1d
                        </button>
                        <button
                          className="outline-button"
                          style={{ padding: '3px 7px', fontSize: '10px' }}
                          onClick={() => handleSnoozeTask(task.id, 3)}
                          title="Snooze due date by 3 days"
                        >
                          +3d
                        </button>
                        <button
                          className="outline-button"
                          style={{ padding: '3px 7px', fontSize: '10px' }}
                          onClick={() => handleSnoozeTask(task.id, 7)}
                          title="Snooze due date by 1 week"
                        >
                          +1w
                        </button>
                        <button
                          className="outline-button"
                          style={{ padding: '3px 7px', fontSize: '10px', color: '#6b7280' }}
                          onClick={() => handleDismissTask(task.id)}
                          title="Dismiss this task"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <button
                      className="more-button"
                      onClick={() => openEditTaskModal(task)}
                      title="Edit task"
                      style={{ color: '#6b7280' }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="more-button"
                      onClick={() => handleDeleteTask(task.id)}
                      title="Delete task"
                      style={{ color: '#9ca3af' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {/* Fallback Sample Showcase Tasks */}
          <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '24px', paddingTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
              <span className="section-kicker" style={{ margin: 0 }}>DEMO SHOWCASE TASKS (ANANYA KAPOOR)</span>
            </div>
            {sampleItems.map((task, i) => (
              <div className={`full-task ${task.done ? 'is-done' : ''}`} key={task.title} style={{ opacity: 0.85 }}>
                <button
                  className={`check ${task.done ? 'checked' : ''}`}
                  onClick={() =>
                    setSampleItems(sampleItems.map((x, n) => (n === i ? { ...x, done: !x.done } : x)))
                  }
                  aria-label="Toggle sample task"
                >
                  {task.done && <Check size={13} />}
                </button>
                <div className="full-task-copy">
                  <div>
                    <strong>{task.title}</strong>
                    <span className={`tag ${task.tone}`}>{task.tag}</span>
                  </div>
                  <p>{task.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Sidebar Next Deadline Card */}
        <div className="panel deadline-card">
          <span className="section-kicker">NEXT DEADLINE</span>
          {nextDeadlineTask ? (
            <>
              <div className="deadline-date">
                <strong>{nextDeadlineTask.dueDate.split('-')[2] || '—'}</strong>
                <span>
                  {new Date(nextDeadlineTask.dueDate).toLocaleString('en-US', { month: 'short' }).toUpperCase()}
                  <br />
                  {nextDeadlineTask.dueDate.split('-')[0]}
                </span>
              </div>
              <h3>{nextDeadlineTask.title}</h3>
              <p>{nextDeadlineTask.description}</p>
              {nextDeadlineTask.linkedDocumentId && (
                <a
                  href={`/api/documents/${nextDeadlineTask.linkedDocumentId}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="outline-button"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                >
                  Open document <ArrowUpRight size={14} />
                </a>
              )}
            </>
          ) : (
            <>
              <div className="deadline-date">
                <strong>25</strong>
                <span>NOV<br />2026</span>
              </div>
              <h3>Adani Electricity bill</h3>
              <p>₹2,840 due in 15 days (25 Nov 2026)</p>
              <button className="outline-button" onClick={() => setActive?.('documents')}>
                Open LifeFile <ArrowUpRight size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function GenericPage({
  id,
  setActive,
  onAskAura,
}: {
  id: string
  setActive: (id: string) => void
  onAskAura: (prompt: string) => void
}) {
  const [billDocs, setBillDocs] = useState<StoredDocument[]>([])
  const [billTasks, setBillTasks] = useState<StoredTask[]>([])

  useEffect(() => {
    if (id === 'bills') {
      Promise.all([fetch('/api/documents').then((r) => r.json()), fetch('/api/tasks?category=bill').then((r) => r.json())])
        .then(([d, t]) => {
          if (d.success && Array.isArray(d.documents)) {
            setBillDocs(
              d.documents.filter(
                (doc: StoredDocument) =>
                  doc.extractedData?.documentType === 'Bill' ||
                  doc.extractedData?.documentType === 'Receipt' ||
                  doc.extractedData?.totalAmount != null
              )
            )
          }
          if (t.success && Array.isArray(t.tasks)) {
            setBillTasks(t.tasks)
          }
        })
        .catch(() => {})
    }
  }, [id])

  if (id === 'settings') {
    return (
      <div className="content">
        <div className="page-heading">
          <div>
            <span className="section-kicker">AURA WORKSPACE · PRIVACY &amp; ARCHITECTURE</span>
            <h2>Settings &amp; Security Notice</h2>
            <p className="subcopy">Manage your private AURA account, workspace backup, and notification preferences.</p>
          </div>
          <a href="/api/lifefile/export" download className="outline-button" style={{ textDecoration: 'none' }}>
            <Download size={14} /> Export Workspace Backup
          </a>
        </div>
        <div className="panel" style={{ marginBottom: '14px' }}>
          <h3 style={{ marginTop: 0 }}>Account Isolation &amp; Password Authentication</h3>
          <p className="muted" style={{ lineHeight: 1.6 }}>
            Your account is secured with bcrypt password hashing and HTTP-only signed session cookies. All LifeFile documents, tasks, products, support contacts, and approved memories are strictly isolated inside your dedicated per-account server directory and inaccessible to other accounts.
          </p>
        </div>
        <div className="panel" style={{ marginBottom: '14px' }}>
          <h3 style={{ marginTop: 0 }}>Notifications &amp; Browser Reminders</h3>
          <p className="muted" style={{ lineHeight: 1.6 }}>
            In-app reminders and browser notifications check active tasks while AURA is open in your browser. There is no background push server or offline service-worker scheduler, so browser notifications do not fire when the app tab is closed.
          </p>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>AI Providers &amp; Key Protection</h3>
          <p className="muted" style={{ lineHeight: 1.6 }}>
            Gnani Prisma v2.5 STT, Gnani Timbre v2.5 TTS, and Google Gemini API keys remain strictly server-side via environment variables and are never exposed to browser clients.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <span className="section-kicker">CONNECTED BILLS &amp; RECEIPTS</span>
          <h2>Bills &amp; payments</h2>
          <p className="subcopy">Extracted amounts, recurring bill schedules &amp; source files from your uploaded LifeFile documents.</p>
        </div>
        <button className="primary-button" onClick={() => setActive('documents')}>
          <Plus size={16} /> Upload bill
        </button>
      </div>
      {billDocs.length === 0 && billTasks.length === 0 ? (
        <div className="empty-module panel">
          <div className="empty-icon"><WalletCards size={25} /></div>
          <h3>No uploaded bills yet</h3>
          <p>Upload an electricity, broadband, or utility bill in My Documents to see extracted totals and due dates here.</p>
          <button className="outline-button" onClick={() => onAskAura('What bills are due this week?')}>
            <Sparkles size={15} /> Ask AURA
          </button>
        </div>
      ) : (
        <>
          {billTasks.length > 0 && (
            <div className="panel" style={{ marginBottom: '20px' }}>
              <div className="panel-head" style={{ marginBottom: '10px' }}>
                <div>
                  <span className="section-kicker">BILL SCHEDULE ({billTasks.length})</span>
                  <h3>Pending &amp; completed bill cycles</h3>
                </div>
                <button className="text-button" onClick={() => setActive('tasks')}>Manage in Tasks <ArrowUpRight size={14} /></button>
              </div>
              <div className="task-list">
                {billTasks.map((t) => (
                  <div className="task-row" key={t.id}>
                    <div>
                      <strong style={{ textDecoration: t.status === 'completed' ? 'line-through' : 'none' }}>{t.title}</strong>
                      <span>Due: {t.dueDate} · Status: {t.status}{t.recurrence && t.recurrence !== 'none' ? ` · ${t.recurrence}` : ''}</span>
                    </div>
                    <button className="outline-button" style={{ padding: '4px 8px', fontSize: '10px' }} onClick={() => onAskAura(`Status of ${t.title}`)}>
                      Ask AURA
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="document-grid">
            {billDocs.map((doc) => (
              <article className="doc-card" key={doc.id}>
                <div className="doc-cover blue">
                  <Zap size={24} />
                  <span>{doc.extractedData?.documentType || 'Bill'}</span>
                </div>
                <div className="doc-card-body">
                  <h3>{doc.extractedData?.issuer || doc.originalFilename}</h3>
                  <p>
                    {doc.extractedData?.totalAmount != null
                      ? `${doc.extractedData?.currency || '₹'}${doc.extractedData.totalAmount.toLocaleString('en-IN')}`
                      : 'Amount not extracted'}
                    {doc.extractedData?.dueDate ? ` · Due ${doc.extractedData.dueDate}` : ''}
                  </p>
                  <div className="doc-footer">
                    <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>
                      Open File
                    </a>
                    <button onClick={() => onAskAura(`Summarize charges in ${doc.originalFilename}`)}>
                      Ask AURA <ArrowUpRight size={13} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function AuraWorkspaceClient({ initialUser }: { initialUser: PublicUser }) {
  const router = useRouter()
  const [active, setActive] = useState('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [activeFormGuideDocId, setActiveFormGuideDocId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [quickQuery, setQuickQuery] = useState('')
  const [liveStats, setLiveStats] = useState<{
    documentsCount: number
    productsCount: number
    pendingTaskCount: number
    contactsCount: number
    totalStorageBytes: number
  } | null>(null)

  const { profile, saveProfile, clearProfile } = useProfile(initialUser)

  const {
    reminders,
    browserPermission,
    browserEnabled,
    refreshReminders,
    requestBrowserNotifications,
    disableBrowserNotifications,
  } = useReminders(initialUser.id)

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {}
    router.replace('/login')
    router.refresh()
  }

  const refreshLiveStats = () => {
    fetch('/api/intelligence', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.stats) setLiveStats(d.stats)
      })
      .catch(() => {})
  }

  const handleWorkspaceMutated = () => {
    refreshLiveStats()
    refreshReminders()
  }

  const tasksHook = useTasks(handleWorkspaceMutated)

  useEffect(() => {
    refreshLiveStats()
  }, [active])

  const handleAskAura = (prompt: string) => {
    setPendingPrompt(prompt)
    setActive('assistant')
  }

  const handleReminderComplete = async (taskId: string) => {
    const task = tasksHook.tasks.find((t) => t.id === taskId)
    if (task) {
      await tasksHook.toggleTaskStatus(task)
    } else {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      }).catch(() => {})
      await tasksHook.refreshTasks()
      handleWorkspaceMutated()
    }
  }

  const handleReminderSnooze = async (taskId: string) => {
    await tasksHook.snoozeTaskByDays(taskId, 1)
  }

  const pendingTaskCount = tasksHook.tasks.filter((t) => t.status === 'pending').length

  const title =
    nav.find((n) => n.id === active)?.label ||
    ({ memory: 'Personal Memory', settings: 'Settings', profile: 'View Profile' } as Record<string, string>)[active] ||
    'Overview'

  const page =
    active === 'overview' ? (
      <Overview
        setActive={setActive}
        onAskAura={handleAskAura}
        sharedTasks={tasksHook.tasks}
        onToggleTask={tasksHook.toggleTaskStatus}
        togglingTaskIds={tasksHook.togglingTaskIds}
        taskError={tasksHook.taskError}
        profile={profile}
      />
    ) : active === 'assistant' ? (
      <Assistant
        setActive={setActive}
        initialPrompt={pendingPrompt}
        clearInitialPrompt={() => setPendingPrompt(null)}
        profile={profile}
        onOpenFormGuide={(docId) => setActiveFormGuideDocId(docId)}
      />
    ) : active === 'documents' ? (
      <Documents
        setActive={setActive}
        onDocumentsChanged={() => {
          tasksHook.refreshTasks()
          handleWorkspaceMutated()
        }}
        onAskAura={handleAskAura}
        onOpenFormGuide={(docId) => setActiveFormGuideDocId(docId)}
      />
    ) : active === 'products' ? (
      <Products onAskAura={handleAskAura} />
    ) : active === 'tasks' ? (
      <Tasks
        setActive={setActive}
        realTasks={tasksHook.tasks}
        isLoading={tasksHook.isLoading}
        isSyncing={tasksHook.isSyncing}
        taskError={tasksHook.taskError}
        togglingTaskIds={tasksHook.togglingTaskIds}
        onClearTaskError={tasksHook.clearTaskError}
        onToggleTask={tasksHook.toggleTaskStatus}
        onSnoozeTask={tasksHook.snoozeTaskByDays}
        onDismissTask={tasksHook.dismissTaskById}
        onDeleteTask={tasksHook.deleteTaskById}
        onSaveOrUpdateTask={tasksHook.saveOrUpdateTask}
        onSyncLifeFile={tasksHook.syncTasksFromDocs}
      />
    ) : active === 'support' ? (
      <SupportContactsSection onAskAura={handleAskAura} />
    ) : active === 'memory' ? (
      <PersonalMemorySection />
    ) : active === 'profile' ? (
      <ProfileSection
        profile={profile}
        onSaveProfile={saveProfile}
        onResetProfile={clearProfile}
      />
    ) : (
      <GenericPage id={active} setActive={setActive} onAskAura={handleAskAura} />
    )

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        setActive={setActive}
        open={mobileOpen}
        close={() => setMobileOpen(false)}
        liveStats={liveStats}
        pendingTaskCount={pendingTaskCount}
      />
      {mobileOpen && (
        <button className="overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
      )}
      <main className="main">
        <Topbar
          title={title}
          onMenu={() => setMobileOpen(true)}
          reminders={reminders}
          browserPermission={browserPermission}
          browserEnabled={browserEnabled}
          onEnableBrowserNotif={requestBrowserNotifications}
          onDisableBrowserNotif={disableBrowserNotifications}
          onSnoozeTask={handleReminderSnooze}
          onCompleteTask={handleReminderComplete}
          onAskAura={handleAskAura}
          onOpenSearch={() => {
            setQuickQuery('')
            setSearchOpen(true)
          }}
          profile={profile}
          onNavigate={setActive}
          onLogout={handleLogout}
        />
        {page}
      </main>

      {searchOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '90px', zIndex: 1000 }}
          onClick={() => setSearchOpen(false)}
        >
          <div className="panel" style={{ width: 'min(520px, calc(100vw - 32px))', background: '#fff', padding: '20px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <strong>Ask or Search Across AURA</strong>
              <button onClick={() => setSearchOpen(false)} style={{ background: 'none', border: 'none' }}><X size={16} /></button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!quickQuery.trim()) return
                setSearchOpen(false)
                handleAskAura(quickQuery.trim())
              }}
              style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}
            >
              <input
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder="Ask anything across documents, products, contacts & tasks..."
                autoFocus
                style={{ flex: 1, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: '7px', fontSize: '13px' }}
              />
              <button type="submit" className="primary-button">Ask AURA</button>
            </form>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                ['My Documents', 'documents'],
                ['Products & Warranty', 'products'],
                ['Tasks & Reminders', 'tasks'],
                ['Support Contacts', 'support'],
                ['Personal Memory', 'memory'],
              ].map(([label, tabId]) => (
                <button
                  key={tabId}
                  className="outline-button"
                  style={{ fontSize: '11px', padding: '5px 9px' }}
                  onClick={() => {
                    setSearchOpen(false)
                    setActive(tabId)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <FormFillingGuideModal
        documentId={activeFormGuideDocId}
        onClose={() => setActiveFormGuideDocId(null)}
        onAskAura={handleAskAura}
        onSavedProgress={handleWorkspaceMutated}
      />
    </div>
  )
}
