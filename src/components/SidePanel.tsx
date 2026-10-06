import { useState } from 'react'
import { Plus, Trash2, User, Map as MapIcon, ScrollText, Swords, Package, Users, BookMarked, ChevronDown, ChevronRight, Wand2, GitBranch, RefreshCcw, ShieldCheck, Loader2 } from 'lucide-react'
import { useStore, actions, volumesOf, chaptersOf } from '../store'
import type { Book, Chapter, Character, CharacterState, SettingCategory, ForeshadowStatus, ForeshadowPriority, OutlineStatus, ID } from '../types'
import { countWords, formatNumber } from '../utils'
import { chatJSON, writebackPrompt, snapshotCast, SYS_PLANNER, aiReady, characterCardPrompt, type GenWriteback, type GenCharacterCard } from '../ai'
import { AiSettingsModal, AiSplitModal, AiBranchModal, AiCheckModal } from './AiModals'
import Modal from './Modal'

export type SideTab = 'outline' | 'characters' | 'settings' | 'foreshadow'

const CATEGORY_META: Record<SettingCategory, { label: string; icon: typeof MapIcon }> = {
  location: { label: '地点', icon: MapIcon },
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
  filter,
  onFilterChange,
}: {
  book: Book
  chapter?: Chapter
  tab: SideTab
  onTabChange: (t: SideTab) => void
  filter: string
  onFilterChange: (v: string) => void
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
      {tab === 'characters' && <CharactersTab bookId={book.id} filter={filter} onFilterChange={onFilterChange} />}
      {tab === 'settings' && <SettingsTab bookId={book.id} filter={filter} onFilterChange={onFilterChange} />}
      {tab === 'foreshadow' && <ForeshadowTab bookId={book.id} filter={filter} onFilterChange={onFilterChange} />}

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
            onClick={() => actions.createForeshadow(book.id, { title: '新伏笔' })}>
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

  const toggleRef = (ch: Chapter, key: 'cast' | 'foreshadowIds' | 'foreshadowPayoffs', id: ID) => {
    const list = ch[key]
    actions.updateChapter(ch.id, {
      [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    } as Partial<Chapter>)
    if (key !== 'cast') actions.syncForeshadowStatus(id)
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
                              <div className="lbl">本章伏笔（点击切换：未挂 → 埋 → 收）</div>
                              <div className="ol-chips">
                                {fsPool.map((p) => {
                                  const planted = c.foreshadowIds.includes(p.id)
                                  const paid = c.foreshadowPayoffs.includes(p.id)
                                  const st = paid ? 'payoff' : planted ? 'plant' : 'none'
                                  return (
                                    <button
                                      key={p.id}
                                      className={`ol-chip ${st !== 'none' ? 'sel' : ''} ${st === 'payoff' ? 'payoff' : ''}`}
                                      title="点击切换：未挂 → 埋 → 收 → 未挂"
                                      onClick={() => {
                                        if (st === 'none') {
                                          actions.updateChapter(c.id, { foreshadowIds: [...c.foreshadowIds, p.id] })
                                        } else if (st === 'plant') {
                                          actions.updateChapter(c.id, {
                                            foreshadowIds: c.foreshadowIds.filter((x) => x !== p.id),
                                            foreshadowPayoffs: [...c.foreshadowPayoffs, p.id],
                                          })
                                        } else {
                                          actions.updateChapter(c.id, {
                                            foreshadowPayoffs: c.foreshadowPayoffs.filter((x) => x !== p.id),
                                          })
                                        }
                                        actions.syncForeshadowStatus(p.id)
                                      }}
                                    >
                                      {st === 'plant' ? '埋 · ' : st === 'payoff' ? '收 · ' : ''}{p.title}
                                    </button>
                                  )
                                })}
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

const CHAR_STATE: Record<CharacterState, { label: string; color: string }> = {
  alive: { label: '存活', color: 'var(--success)' },
  dead: { label: '死亡', color: '#e5484d' },
  missing: { label: '失踪', color: 'var(--warning)' },
  retired: { label: '退场', color: 'var(--text-faint)' },
}

const CHAR_FIELDS: { key: 'appearance' | 'personality' | 'background' | 'motivation' | 'ability' | 'speech'; label: string }[] = [
  { key: 'appearance', label: '外貌特征' },
  { key: 'personality', label: '性格' },
  { key: 'background', label: '背景身世' },
  { key: 'motivation', label: '动机目标' },
  { key: 'ability', label: '能力 / 功法' },
  { key: 'speech', label: '口头禅 / 语言习惯' },
]

function CharacterCard({ c, appear }: { c: Character; appear: Chapter[] }) {
  const [open, setOpen] = useState(false)
  const state = useStore()
  const chars = state.characters.filter((x) => x.bookId === c.bookId)
  const relatedFs = state.foreshadows.filter((f) => f.bookId === c.bookId && (f.characterIds ?? []).includes(c.id))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiDraft, setAiDraft] = useState<GenCharacterCard | null>(null)
  const book = state.books.find((b) => b.id === c.bookId)

  async function runCardAi() {
    if (!book) return
    setAiBusy(true)
    setAiDraft(null)
    try {
      const srcChs = appear.length > 0
        ? appear
        : state.chapters.filter((ch) => ch.bookId === c.bookId && charNamesLocal.some((n) => ch.content.includes(n)))
      const excerpts = srcChs.slice(0, 3).map((ch) => ch.content.slice(0, 1500)).filter(Boolean)
      const r = await chatJSON<GenCharacterCard>(state.ai, SYS_PLANNER, characterCardPrompt(book, c, excerpts))
      setAiDraft(r)
    } catch (e) {
      setAiDraft({ appearance: `失败：${(e as Error).message}` })
    } finally {
      setAiBusy(false)
    }
  }

  function applyDraft(mode: 'fill' | 'overwrite') {
    if (!aiDraft) return
    const draft = aiDraft as Record<string, string | undefined>
    const patch: Partial<Character> = {}
    for (const f of CHAR_FIELDS) {
      const v = draft[f.key]
      if (!v || !v.trim()) continue
      if (mode === 'fill' && (c[f.key] ?? '').trim()) continue
      patch[f.key] = v
    }
    actions.updateCharacter(c.id, patch)
    setAiDraft(null)
  }
  const charNamesLocal = [c.name, ...(c.aliases ?? [])].filter((n) => n && n.trim())
  const filled = CHAR_FIELDS.filter((f) => (c[f.key] ?? '').trim()).length
  const st = CHAR_STATE[c.status ?? 'alive']
  return (
    <div className="card" id={`char-${c.id}`}>
      <button className="card-del" onClick={() => actions.deleteCharacter(c.id)}><Trash2 size={14} /></button>
      <div className="card-title">
        <User size={14} style={{ color: 'var(--accent)' }} />
        <input className="inline-edit" style={{ fontWeight: 600, fontSize: 13.5 }} value={c.name}
          onChange={(e) => actions.updateCharacter(c.id, { name: e.target.value })} />
        <span className="char-state-dot" style={{ background: st.color }} title={st.label} />
        <button className="icon-btn" title="AI 补全角色卡" disabled={aiBusy || !aiReady(state.ai)} onClick={() => void runCardAi()}>
          {aiBusy ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <input className="inline-edit" style={{ fontSize: 11.5, color: 'var(--accent)', flex: 1 }} value={c.role}
          placeholder="定位（主角/反派…）"
          onChange={(e) => actions.updateCharacter(c.id, { role: e.target.value })} />
        <select className="field" style={{ width: 'auto', padding: '2px 6px', fontSize: 11 }}
          value={c.status ?? 'alive'}
          onChange={(e) => actions.updateCharacter(c.id, { status: e.target.value as CharacterState })}>
          {(Object.keys(CHAR_STATE) as CharacterState[]).map((k) => (
            <option key={k} value={k}>{CHAR_STATE[k].label}</option>
          ))}
        </select>
      </div>
      <input className="inline-edit" style={{ fontSize: 11.5, marginTop: 4, color: 'var(--text-faint)' }}
        value={(c.aliases ?? []).join(', ')}
        placeholder="别名/曾用名（逗号分隔，参与正文命中）"
        onChange={(e) => actions.updateCharacter(c.id, {
          aliases: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        })} />
      {appear.length > 0 && (
        <div className="fs-appear" style={{ marginTop: 6 }}>
          <span className="fs-link-label">出场</span>
          {appear.map((ch) => (
            <button key={ch.id} className="ol-chip sel" onClick={() => actions.selectChapter(ch.id)} title="跳转到该章">
              {ch.title}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
        出场 {appear.length} 章{appear.length > 0 && ` · 最近《${appear[appear.length - 1].title}》`}
      </div>
      {(c.relations ?? []).length > 0 && (
        <div className="fs-appear" style={{ marginTop: 6 }}>
          <span className="fs-link-label">关系</span>
          {(c.relations ?? []).map((r, i) => {
            const t = chars.find((x) => x.id === r.targetId)
            return (
              <button
                key={i}
                className="ol-chip sel"
                title="跳转到该角色卡"
                onClick={() =>
                  document.getElementById(`char-${r.targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                {r.relation || '关系'}·{t?.name ?? '未知'}
              </button>
            )
          })}
        </div>
      )}
      {relatedFs.length > 0 && (
        <div className="fs-appear" style={{ marginTop: 6 }}>
          <span className="fs-link-label">伏笔</span>
          {relatedFs.map((f) => (
            <span key={f.id} className="ol-chip" title={f.title}>{f.title}</span>
          ))}
        </div>
      )}
      <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 11, padding: '3px 8px' }}
        onClick={() => setOpen((v) => !v)}>
        {open ? '收起详细设定' : `详细设定${filled > 0 ? `（已填 ${filled}）` : ''}`}
      </button>
      {open && CHAR_FIELDS.map((f) => (
        <div className="ol-field" key={f.key}>
          <div className="lbl">{f.label}</div>
          <textarea className="field ol-f" rows={2} value={c[f.key] ?? ''} placeholder={`${f.label}…`}
            onChange={(e) => actions.updateCharacter(c.id, { [f.key]: e.target.value } as Partial<Character>)} />
        </div>
      ))}
      {open && (
        <div className="ol-field">
          <div className="lbl">关系</div>
          {(c.relations ?? []).map((r, i) => (
            <div className="rel-row" key={i}>
              <select
                className="field"
                value={r.targetId}
                onChange={(e) => actions.updateCharacter(c.id, {
                  relations: (c.relations ?? []).map((x, j) => (j === i ? { ...x, targetId: e.target.value } : x)),
                })}
              >
                {chars.filter((x) => x.id !== c.id).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
              <input
                className="field"
                value={r.relation}
                placeholder="师徒/仇敌…"
                onChange={(e) => actions.updateCharacter(c.id, {
                  relations: (c.relations ?? []).map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)),
                })}
              />
              <button className="icon-btn" title="删除关系"
                onClick={() => actions.updateCharacter(c.id, { relations: (c.relations ?? []).filter((_, j) => j !== i) })}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => actions.updateCharacter(c.id, {
              relations: [...(c.relations ?? []), { targetId: chars.find((x) => x.id !== c.id)?.id ?? '', relation: '' }],
            })}>
            + 添加关系
          </button>
        </div>
      )}
      <div className="ol-field" style={{ marginTop: 8 }}>
        <div className="lbl">综合备注</div>
        <textarea className="field ol-f" rows={2} value={c.desc} placeholder="其它备注…"
          onChange={(e) => actions.updateCharacter(c.id, { desc: e.target.value })} />
      </div>

      {aiDraft && (
        <Modal
          title={`AI 角色卡补全 · ${c.name}`}
          onClose={() => setAiDraft(null)}
          width={560}
          foot={
            <>
              <button className="btn btn-ghost" onClick={() => setAiDraft(null)}>取消</button>
              <button className="btn btn-ghost" onClick={() => applyDraft('overwrite')}>覆盖采用</button>
              <button className="btn btn-primary" onClick={() => applyDraft('fill')}>填入空缺</button>
            </>
          }
        >
          <div className="hint">填入空缺：只写角色卡尚空的字段；覆盖采用：以本页内容重写对应字段。可先编辑再采用。</div>
          {CHAR_FIELDS.map((f) => (
            <div className="ol-field" key={f.key}>
              <div className="lbl">{f.label}</div>
              <textarea
                className="field ol-f"
                rows={2}
                value={(aiDraft as Record<string, string | undefined>)[f.key] ?? ''}
                onChange={(e) => setAiDraft({ ...aiDraft, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </Modal>
      )}
    </div>
  )
}

function CharactersTab({ bookId, filter, onFilterChange }: { bookId: string; filter: string; onFilterChange: (v: string) => void }) {
  const state = useStore()
  const all = state.characters.filter((c) => c.bookId === bookId)
  const kw = filter.trim()
  const list = kw ? all.filter((c) => `${c.name}${c.role}${c.desc}${(c.aliases ?? []).join('')}`.includes(kw)) : all
  const chapters = state.chapters.filter((c) => c.bookId === bookId)
  return (
    <div className="side-scroll">
      <FilterBox value={filter} onChange={onFilterChange} placeholder="搜索角色名 / 别名 / 定位…" />
      {list.length === 0 && <Empty text={kw ? '没有匹配的角色' : '还没有角色，点击下方新增'} />}
      {list.map((c) => (
        <CharacterCard key={c.id} c={c} appear={chapters.filter((ch) => ch.cast.includes(c.id))} />
      ))}
    </div>
  )
}

function SettingsTab({ bookId, filter, onFilterChange }: { bookId: string; filter: string; onFilterChange: (v: string) => void }) {
  const state = useStore()
  const all = state.settings.filter((c) => c.bookId === bookId)
  const kw = filter.trim()
  const list = kw ? all.filter((i) => `${i.name}${i.desc}${i.status ?? ''}`.includes(kw)) : all
  const chapters = state.chapters.filter((c) => c.bookId === bookId)
  const cats = Object.keys(CATEGORY_META) as SettingCategory[]
  return (
    <div className="side-scroll">
      <FilterBox value={filter} onChange={onFilterChange} placeholder="搜索设定名 / 描述 / 状态…" />
      {list.length === 0 && <Empty text={kw ? '没有匹配的设定' : '还没有设定，点击下方新增'} />}
      {cats.map((cat) => {
        const items = list.filter((i) => i.category === cat)
        if (items.length === 0) return null
        const Icon = CATEGORY_META[cat].icon
        return (
          <div key={cat}>
            <div className="side-section-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
              <Icon size={12} /> {CATEGORY_META[cat].label}
            </div>
            {items.map((it) => {
              const appear = it.name ? chapters.filter((ch) => ch.content.includes(it.name)) : []
              return (
                <div className="card" key={it.id}>
                  <button className="card-del" onClick={() => actions.deleteSetting(it.id)}><Trash2 size={14} /></button>
                  <div className="card-title">
                    <input className="inline-edit" style={{ fontWeight: 600, fontSize: 13.5 }} value={it.name}
                      onChange={(e) => actions.updateSetting(it.id, { name: e.target.value })} />
                  </div>
                  <input className="inline-edit" style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 4 }}
                    value={it.status ?? ''}
                    placeholder="当前状态（活跃/覆灭/已毁…）"
                    onChange={(e) => actions.updateSetting(it.id, { status: e.target.value })} />
                  {appear.length > 0 && (
                    <div className="fs-appear" style={{ marginTop: 6 }}>
                      <span className="fs-link-label">出现</span>
                      {appear.slice(0, 6).map((ch) => (
                        <button key={ch.id} className="ol-chip sel" onClick={() => actions.selectChapter(ch.id)} title="跳转到该章">
                          {ch.title}
                        </button>
                      ))}
                      {appear.length > 6 && (
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>+{appear.length - 6}</span>
                      )}
                    </div>
                  )}
                  <textarea className="field" style={{ marginTop: 8, fontSize: 12.5, background: 'transparent' }} rows={2}
                    value={it.desc} placeholder="设定描述…"
                    onChange={(e) => actions.updateSetting(it.id, { desc: e.target.value })} />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function ForeshadowTab({ bookId, filter, onFilterChange }: { bookId: string; filter: string; onFilterChange: (v: string) => void }) {
  const state = useStore()
  const all = state.foreshadows.filter((c) => c.bookId === bookId)
  const kw = filter.trim()
  const list = kw ? all.filter((f) => `${f.title}${f.detail}`.includes(kw)) : all
  const volumes = volumesOf(state, bookId)
  const volOrder = new Map(volumes.map((v, i) => [v.id, i] as [ID, number]))
  const chapters = state.chapters
    .filter((c) => c.bookId === bookId)
    .sort((a, b) => (volOrder.get(a.volumeId) ?? 0) - (volOrder.get(b.volumeId) ?? 0) || a.order - b.order)
  const idx = new Map(chapters.map((c, i) => [c.id, i] as [ID, number]))
  const chars = state.characters.filter((c) => c.bookId === bookId)

  const timeline = chapters
    .map((c) => ({
      c,
      plant: list.filter((f) => c.foreshadowIds.includes(f.id)),
      pay: list.filter((f) => c.foreshadowPayoffs.includes(f.id)),
    }))
    .filter((r) => r.plant.length > 0 || r.pay.length > 0)

  return (
    <div className="side-scroll">
      <FilterBox value={filter} onChange={onFilterChange} placeholder="搜索伏笔标题 / 内容…" />
      <div className="side-section-label">埋 / 收时间线</div>
      {timeline.length === 0 && <Empty text="还没有伏笔挂接，去大纲 tab 给章节挂埋/收" />}
      {timeline.map((r) => (
        <div className="fs-tl-row" key={r.c.id}>
          <span className="fs-tl-ch">{r.c.title}</span>
          <span className="fs-tl-evts">
            {r.plant.map((f) => (
              <span className="fs-evt plant" key={f.id}>埋 {f.title}</span>
            ))}
            {r.pay.map((f) => (
              <span className="fs-evt pay" key={f.id}>收 {f.title}</span>
            ))}
          </span>
        </div>
      ))}

      <div className="side-section-label" style={{ marginTop: 14 }}>伏笔清单</div>
      {list.length === 0 && <Empty text={kw ? '没有匹配的伏笔' : '还没有伏笔，点击下方登记'} />}
      {list.map((f) => {
        const meta = FS_META[f.status]
        const plantIn = chapters.filter((c) => c.foreshadowIds.includes(f.id))
        const payIn = chapters.filter((c) => c.foreshadowPayoffs.includes(f.id))
        const plantIdx = plantIn.length ? idx.get(plantIn[0].id) : undefined
        const payIdx = payIn.length ? idx.get(payIn[0].id) : undefined
        const span = plantIdx !== undefined && payIdx !== undefined ? payIdx - plantIdx : null
        const broken = f.status === 'resolved' && payIn.length === 0
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
              <select className="field" style={{ width: 'auto', padding: '2px 6px', fontSize: 11, marginLeft: 6 }}
                value={f.priority ?? 'sub'}
                onChange={(e) => actions.updateForeshadow(f.id, { priority: e.target.value as ForeshadowPriority })}>
                <option value="main">主线</option>
                <option value="sub">支线</option>
                <option value="detail">细节</option>
              </select>
              <span className={`fs-status ${meta.cls}`} style={{ marginLeft: 8 }}>{meta.label}</span>
              {span !== null &&
                (span >= 0 ? (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-faint)' }}>跨 {span} 章</span>
                ) : (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--warning)' }}>回收早于埋设</span>
                ))}
            </div>
            <div className="fs-appear">
              <span className="fs-link-label">埋</span>
              {plantIn.length > 0 ? (
                plantIn.map((c) => (
                  <button key={c.id} className="ol-chip sel" onClick={() => actions.selectChapter(c.id)} title="跳转到埋设章">
                    {c.title}
                  </button>
                ))
              ) : (
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>未挂</span>
              )}
            </div>
            <div className="fs-appear">
              <span className="fs-link-label pay">收</span>
              {payIn.length > 0 ? (
                payIn.map((c) => (
                  <button key={c.id} className="ol-chip sel payoff" onClick={() => actions.selectChapter(c.id)} title="跳转到回收章">
                    {c.title}
                  </button>
                ))
              ) : (
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>未收</span>
              )}
            </div>
            <div className="fs-appear" style={{ marginTop: 6 }}>
              <span className="fs-link-label">角色</span>
              {chars.map((ch) => (
                <button
                  key={ch.id}
                  className={`ol-chip ${(f.characterIds ?? []).includes(ch.id) ? 'sel' : ''}`}
                  onClick={() => actions.updateForeshadow(f.id, {
                    characterIds: (f.characterIds ?? []).includes(ch.id)
                      ? (f.characterIds ?? []).filter((x) => x !== ch.id)
                      : [...(f.characterIds ?? []), ch.id],
                  })}
                >
                  {ch.name}
                </button>
              ))}
            </div>
            {broken && (
              <div className="fs-warn">标记为已回收，但没有任何回收章挂接——检查是否漏写回收章。</div>
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

function FilterBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      className="field"
      style={{ marginBottom: 8, fontSize: 12 }}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}>{text}</div>
}
