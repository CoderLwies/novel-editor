import { Plus, Trash2, User, Map, ScrollText, Swords, Package, Users, BookMarked } from 'lucide-react'
import { useStore, actions, volumesOf, chaptersOf } from '../store'
import type { Book, Chapter, SettingCategory, ForeshadowStatus } from '../types'
import { countWords, formatNumber } from '../utils'

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
  return (
    <div className="side-scroll">
      <div className="side-section-label">总纲 / 简介</div>
      <textarea
        className="field"
        rows={5}
        value={book.synopsis}
        placeholder="写下这本书的核心设定、主线与卖点…"
        onChange={(e) => actions.updateBook(book.id, { synopsis: e.target.value })}
      />

      <div className="side-section-label" style={{ marginTop: 18 }}>本章概要</div>
      {chapter ? (
        <textarea
          className="field"
          rows={4}
          value={chapter.synopsis}
          placeholder="用一两句话概括本章剧情（可作为写作提纲）…"
          onChange={(e) => actions.updateChapter(chapter.id, { synopsis: e.target.value })}
        />
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>未选中章节</div>
      )}

      <div className="side-section-label" style={{ marginTop: 18 }}>分卷概览</div>
      {volumes.map((v) => {
        const chs = chaptersOf(state, v.id)
        const words = chs.reduce((s, c) => s + countWords(c.content), 0)
        return (
          <div key={v.id} className="card" style={{ padding: '10px 12px' }}>
            <div className="card-title" style={{ fontSize: 13 }}>{v.title}</div>
            <div className="card-desc" style={{ marginTop: 4 }}>
              {chs.length} 章 · {formatNumber(words)} 字
            </div>
          </div>
        )
      })}
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
  return (
    <div className="side-scroll">
      {list.length === 0 && <Empty text="还没有伏笔，点击下方登记" />}
      {list.map((f) => {
        const meta = FS_META[f.status]
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
