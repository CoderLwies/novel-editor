import { useState } from 'react'
import { Plus, Trash2, User, Map, ScrollText, Swords, Package, Users, BookMarked, ChevronDown, ChevronRight, Wand2, GitBranch, RefreshCcw, ShieldCheck, Loader2 } from 'lucide-react'
import { useStore, actions, volumesOf, chaptersOf } from '../store'
import type { Book, Chapter, SettingCategory, ForeshadowStatus, OutlineStatus, ID } from '../types'
import { countWords, formatNumber } from '../utils'
import { chatJSON, writebackPrompt, snapshotCast, SYS_PLANNER, type GenWriteback } from '../ai'
import { AiSettingsModal, AiSplitModal, AiBranchModal, AiCheckModal } from './AiModals'

export type SideTab = 'outline' | 'characters' | 'settings' | 'foreshadow'

const CATEGORY_META: Record<SettingCategory, { label: string; icon: typeof Map }> = {
  location: { label: '地点', icon: Map },
  item: { label: '物品', icon: Package },
  faction: { label: '势力', icon: Users },
  rule: { label: '规则', icon: BookMarked },
  power: { label: '功法/战力', icon: Swords },
}

const FS_META: Record<ForeshadowStatus, { label: string; cls: string }> = {
  planted: { label: '已埋', cls: 'fs-planted' },
  progressing: { label: '推进中', cls: 'fs-progressing' },
  resolved: { label: '已回收', cls: 'fs-resolved' },
}

export default function SidePanel({
  book,
  chapter,
  tab,
  onTabChange,
}: {
  book: Book
  chapter?: Chapter
  tab: SideTab
  onTabChange: (t: SideTab) => void
}) {
  const tabs: { key: SideTab; label: string }[] = [
    { key: 'outline', label: '大纲' },
    { key: 'characters', label: '角色' },
    { key: 'settings', label: '设定' },
    { key: 'foreshadow', label: '伏笔' },
  ]

  return (
    <div className="side">
      <div className="side-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`side-tab ${tab === t.key ? 'active' : ''}`} onClick={() => onTabChange(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'outline' && <OutlineTab book={book} chapter={chapter} />}
      {tab === 'characters' && <CharactersTab bookId={book.id} />}
      {tab === 'settings' && <SettingsTab bookId={book.id} />}
      {tab === 'foreshadow' && <ForeshadowTab bookId={book.id} />}

      <div className="side-add">
        {tab === 'characters' && (
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => actions.createCharacter(book.id, { name: '新角色' })}>
            <Plus size={15} /> 新增角色
          </button>
        )}
        {tab === 'settings' && (
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => actions.createSetting(book.id, { name: '新设定', category: 'rule' })}>
            <Plus size={15} /> 新增设定
          </button>
        )}
        {tab === 'foreshadow' && (
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => actions.createForeshadow(book.id, { title: '新伏笔', chapterId: chapter?.id })}>
            <Plus size={15} /> 登记伏笔
          </button>
        )}
      </div>
    </div>
  )
}

function OutlineTab({ book, chapter }: { book: Book; chapter?: Chapter }) {
  const state = useStore()
  const volumes = volumesOf(state, book.id)
  const [openVols, setOpenVols] = useState<Set<ID>>(() => new Set(volumes.map((v) => v.id)))
  const [openCh, setOpenCh] = useState<ID | null>(chapter?.id ?? null)
  const [aiModal, setAiModal] = useState<
    | { kind: 'split'; volId: ID }
    | { kind: 'branch'; chId: ID }
    | { kind: 'check' }
    | null
  >(null)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const castPool = state.characters.filter((c) => c.bookId === book.id)
  const fsPool = state.foreshadows.filter((f) => f.bookId === book.id)

  const toggleVol = (id: ID) =>
    setOpenVols((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleRef = (ch: Chapter, key: 'cast' | 'foreshadowIds', id: ID) => {
    const list = ch[key]
    actions.updateChapter(ch.id, {
      [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    } as Partial<Chapter>)
  }

  return (
    <div className="side-scroll">
      <div className="side-section-label">总纲 / 简介</div>
      <textarea
        className="field"
        rows={4}
        value={book.synopsis}
        placeholder="写下这本书的核心设定、主线与卖点…"
        onChange={(e) => actions.updateBook(book.id, { synopsis: e.target.value })}
      />

      <div className="side-section-label" style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>三级大纲</span>
        <button className="icon-btn" title="一致性巡检" onClick={() => setAiModal({ kind: 'check' })}>
          <ShieldCheck size={13} />
        </button>
      </div>
      {volumes.map((v) => {
        const chs = chaptersOf(state, v.id)
        const open = openVols.has(v.id)
        return (
          <div className="ol-vol" key={v.id}>
            <div className="ol-vol-head" onClick={() => toggleVol(v.id)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="ol-vol-title">{v.title}</span>
              <span className="ol-vol-count">{chs.length} 章</span>
              <button
                className="icon-btn"
                title="AI 拆章纲（依据总纲与卷纲）"
                onClick={(e) => {
                  e.stopPropagation()
                  setAiModal({ kind: 'split', volId: v.id })
                }}
              >
                <Wand2 size={13} />
              </button>
              <button
                className="icon-btn"
                title="在本卷新建计划章"
                onClick={(e) => {
                  e.stopPropagation()
                  const c = actions.createChapter(book.id, v.id, '新章节')
                  setOpenCh(c.id)
                  if (!open) toggleVol(v.id)
                }}
              >
                <Plus size={13} />
              </button>
            </div>

            {open && (
              <div className="ol-vol-body">
                <OlText label="卷纲 · 概括" rows={2} value={v.synopsis}
                  placeholder="一句话概括本卷走向…"
                  onChange={(t) => actions.updateVolume(v.id, { synopsis: t })} />
                <OlText label="本卷目标" rows={1} value={v.goal}
                  placeholder="主角在本卷要达成什么…"
                  onChange={(t) => actions.updateVolume(v.id, { goal: t })} />
                <OlText label="核心冲突" rows={1} value={v.conflict}
                  placeholder="本卷的主要矛盾…"
                  onChange={(t) => actions.updateVolume(v.id, { conflict: t })} />

                {chs.map((c) => {
                  const expanded = openCh === c.id
                  const meta = OS_META[c.outlineStatus]
                  return (
                    <div className={`ol-ch ${expanded ? 'open' : ''} ${chapter?.id === c.id ? 'cur' : ''}`} key={c.id}>
                      <div
                        className="ol-ch-head"
                        onClick={() => {
                          actions.selectChapter(c.id)
                          setOpenCh(expanded ? null : c.id)
                        }}
                      >
                        <span className={`os-dot ${meta.cls}`} title={meta.label} />
                        <span className="ol-ch-title">{c.title}</span>
                        <span className="ol-ch-words">{formatNumber(countWords(c.content))}</span>
                      </div>

                      {expanded && (
                        <div className="ol-ch-body">
                          <div className="ol-seg">
                            {(Object.keys(OS_META) as OutlineStatus[]).map((k) => (
                              <button
                                key={k}
                                className={`ol-seg-btn ${c.outlineStatus === k ? 'sel' : ''}`}
                                onClick={() => actions.updateChapter(c.id, { outlineStatus: k })}
                              >
                                {OS_META[k].label}
                              </button>
                            ))}
                          </div>
                          <div className="ol-ai-row">
                            <button className="btn btn-ghost" onClick={() => setAiModal({ kind: 'branch', chId: c.id })}>
                              <GitBranch size={13} /> AI 分支
                            </button>
                            <WritebackBtn book={book} chapter={c} />
                          </div>
                          <OlText label="一句话概括" rows={2} value={c.synopsis}
                            placeholder="本章讲什么…"
                            onChange={(t) => actions.updateChapter(c.id, { synopsis: t })} />
                          <OlText label="本章目标" rows={1} value={c.goal}
                            placeholder="本章要推进什么…"
                            onChange={(t) => actions.updateChapter(c.id, { goal: t })} />
                          <OlText label="主要冲突" rows={1} value={c.conflict}
                            placeholder="谁与谁的矛盾…"
                            onChange={(t) => actions.updateChapter(c.id, { conflict: t })} />
                          <OlText label="转折点" rows={1} value={c.turning}
                            placeholder="剧情在本章何处转向…"
                            onChange={(t) => actions.updateChapter(c.id, { turning: t })} />
                          <OlText label="结尾钩子" rows={1} value={c.hook}
                            placeholder="留什么悬念到下一章…"
                            onChange={(t) => actions.updateChapter(c.id, { hook: t })} />
                          <OlText label="视角人物" rows={1} value={c.pov}
                            placeholder="以谁的视角叙述…"
                            onChange={(t) => actions.updateChapter(c.id, { pov: t })} />

                          {castPool.length > 0 && (
                            <div className="ol-chips-block">
                              <div className="lbl">出场角色</div>
                              <div className="ol-chips">
                                {castPool.map((p) => (
                                  <button
                                    key={p.id}
                                    className={`ol-chip ${c.cast.includes(p.id) ? 'sel' : ''}`}
                                    onClick={() => toggleRef(c, 'cast', p.id)}
                                  >
                                    {p.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {fsPool.length > 0 && (
                            <div className="ol-chips-block">
                              <div className="lbl">本章埋 / 收伏笔</div>
                              <div className="ol-chips">
                                {fsPool.map((p) => (
                                  <button
                                    key={p.id}
                                    className={`ol-chip ${c.foreshadowIds.includes(p.id) ? 'sel' : ''}`}
                                    onClick={() => toggleRef(c, 'foreshadowIds', p.id)}
                                  >
                                    {p.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {aiModal?.kind === 'split' && (
        <AiSplitModal
          book={book}
          vol={volumes.find((v) => v.id === (aiModal as { volId: ID }).volId)!}
          onClose={() => setAiModal(null)}
          onOpenSettings={() => { setAiModal(null); setShowAiSettings(true) }}
        />
      )}
      {aiModal?.kind === 'branch' && (
        <AiBranchModal
          book={book}
          chapter={state.chapters.find((c) => c.id === (aiModal as { chId: ID }).chId)!}
          onClose={() => setAiModal(null)}
          onOpenSettings={() => { setAiModal(null); setShowAiSettings(true) }}
        />
      )}
      {aiModal?.kind === 'check' && <AiCheckModal book={book} onClose={() => setAiModal(null)} />}
      {showAiSettings && <AiSettingsModal onClose={() => setShowAiSettings(false)} />}
    </div>
  )
}

function WritebackBtn({ book, chapter }: { book: Book; chapter: Chapter }) {
  const state = useStore()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await chatJSON<GenWriteback>(state.ai, SYS_PLANNER, writebackPrompt(book, chapter))
      const chars = state.characters.filter((c) => c.bookId === book.id)
      actions.updateChapter(chapter.id, {
        synopsis: r.synopsis || chapter.synopsis,
        turning: r.turning || chapter.turning,
        hook: r.hook || chapter.hook,
        outlineStatus: 'written',
        cast: snapshotCast(chapter.content, chars, chapter.cast),
      })
      setMsg('已回写')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn btn-ghost" onClick={run} disabled={busy || countWords(chapter.content) === 0}
      title={countWords(chapter.content) === 0 ? '正文为空，无法回写' : 'AI 归纳正文实际走向并回写章纲'}>
      {busy ? <Loader2 size={13} className="spin" /> : <RefreshCcw size={13} />} 回写章纲
      {msg && <span className={`ai-inline-${msg === '已回写' ? 'ok' : 'err'}`}>{msg}</span>}
    </button>
  )
}

export const OS_META: Record<OutlineStatus, { label: string; cls: string }> = {
  plan: { label: '计划中', cls: 'os-plan' },
  written: { label: '已成文', cls: 'os-written' },
  revised: { label: '已修纲', cls: 'os-revised' },
}

function OlText({
  label, rows, value, placeholder, onChange,
}: {
  label: string
  rows: number
  value: string
  placeholder: string
  onChange: (t: string) => void
}) {
  return (
    <div className="ol-field">
      <div className="lbl">{label}</div>
      {rows > 1 ? (
        <textarea className="field ol-f" rows={rows} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="field ol-f" value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

function CharactersTab({ bookId }: { bookId: string }) {
  const state = useStore()
  const list = state.characters.filter((c) => c.bookId === bookId)
  return (
    <div className="side-scroll">
      {list.length === 0 && <Empty text="还没有角色，点击下方新增" />}
      {list.map((c) => (
        <div className="card" key={c.id}>
          <button className="card-del" onClick={() => actions.deleteCharacter(c.id)}><Trash2 size={14} /></button>
          <div className="card-title">
            <User size={14} style={{ color: 'var(--accent)' }} />
            <input className="inline-edit" style={{ fontWeight: 600, fontSize: 13.5 }} value={c.name}
              onChange={(e) => actions.updateCharacter(c.id, { name: e.target.value })} />
          </div>
          <input className="inline-edit" style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 4 }} value={c.role}
            placeholder="定位（主角/反派…）"
            onChange={(e) => actions.updateCharacter(c.id, { role: e.target.value })} />
          <textarea className="field" style={{ marginTop: 8, fontSize: 12.5, background: 'transparent' }} rows={3}
            value={c.desc} placeholder="角色设定、性格、动机…"
            onChange={(e) => actions.updateCharacter(c.id, { desc: e.target.value })} />
        </div>
      ))}
    </div>
  )
}

function SettingsTab({ bookId }: { bookId: string }) {
  const state = useStore()
  const list = state.settings.filter((c) => c.bookId === bookId)
  const cats = Object.keys(CATEGORY_META) as SettingCategory[]
  return (
    <div className="side-scroll">
      {list.length === 0 && <Empty text="还没有设定，点击下方新增" />}
      {cats.map((cat) => {
        const items = list.filter((i) => i.category === cat)
        if (items.length === 0) return null
        const Icon = CATEGORY_META[cat].icon
        return (
          <div key={cat}>
            <div className="side-section-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
              <Icon size={12} /> {CATEGORY_META[cat].label}
            </div>
            {items.map((it) => (
              <div className="card" key={it.id}>
                <button className="card-del" onClick={() => actions.deleteSetting(it.id)}><Trash2 size={14} /></button>
                <div className="card-title">
                  <input className="inline-edit" style={{ fontWeight: 600, fontSize: 13.5 }} value={it.name}
                    onChange={(e) => actions.updateSetting(it.id, { name: e.target.value })} />
                </div>
                <textarea className="field" style={{ marginTop: 8, fontSize: 12.5, background: 'transparent' }} rows={2}
                  value={it.desc} placeholder="设定描述…"
                  onChange={(e) => actions.updateSetting(it.id, { desc: e.target.value })} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ForeshadowTab({ bookId }: { bookId: string }) {
  const state = useStore()
  const list = state.foreshadows.filter((c) => c.bookId === bookId)
  const chapters = state.chapters.filter((c) => c.bookId === bookId)
  return (
    <div className="side-scroll">
      {list.length === 0 && <Empty text="还没有伏笔，点击下方登记" />}
      {list.map((f) => {
        const meta = FS_META[f.status]
        const appearIn = chapters.filter((c) => c.foreshadowIds.includes(f.id))
        const broken = f.status === 'resolved' && appearIn.length === 0
        return (
          <div className="card" key={f.id}>
            <button className="card-del" onClick={() => actions.deleteForeshadow(f.id)}><Trash2 size={14} /></button>
            <div className="card-title">
              <ScrollText size={14} style={{ color: 'var(--accent)' }} />
              <input className="inline-edit" style={{ fontWeight: 600, fontSize: 13.5 }} value={f.title}
                onChange={(e) => actions.updateForeshadow(f.id, { title: e.target.value })} />
            </div>
            <div style={{ marginTop: 7 }}>
              <select className="field" style={{ width: 'auto', padding: '2px 8px', fontSize: 11.5 }}
                value={f.status}
                onChange={(e) => actions.updateForeshadow(f.id, { status: e.target.value as ForeshadowStatus })}>
                <option value="planted">已埋</option>
                <option value="progressing">推进中</option>
                <option value="resolved">已回收</option>
              </select>
              <span className={`fs-status ${meta.cls}`} style={{ marginLeft: 8 }}>{meta.label}</span>
            </div>
            <div className="fs-appear">
              {appearIn.length > 0 ? (
                appearIn.map((c) => (
                  <button key={c.id} className="ol-chip sel" onClick={() => actions.selectChapter(c.id)} title="跳转到该章">
                    {c.title}
                  </button>
                ))
              ) : (
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>尚未挂到任何章节</span>
              )}
            </div>
            {broken && (
              <div className="fs-warn">标记为已回收，但没有任何章节勾选它——检查是否漏写回收章。</div>
            )}
            <textarea className="field" style={{ marginTop: 8, fontSize: 12.5, background: 'transparent' }} rows={3}
              value={f.detail} placeholder="伏笔内容、埋设与回收计划…"
              onChange={(e) => actions.updateForeshadow(f.id, { detail: e.target.value })} />
          </div>
        )
      })}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}>{text}</div>
}
