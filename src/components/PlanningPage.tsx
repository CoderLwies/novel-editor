import { Plus, Table2, ListTree, User, Map as MapIcon, ScrollText } from 'lucide-react'
import { actions, useContentHydrated } from '../store'
import type { Book, ID } from '../types'
import OutlineView from './OutlineView'
import { OutlineTab, CharactersTab, SettingsTab, ForeshadowTab } from './SidePanel'

export type PlanTab = 'overview' | 'outline' | 'characters' | 'settings' | 'foreshadow'

const TABS: { key: PlanTab; label: string; icon: typeof Table2 }[] = [
  { key: 'overview', label: '总览', icon: Table2 },
  { key: 'outline', label: '大纲', icon: ListTree },
  { key: 'characters', label: '角色', icon: User },
  { key: 'settings', label: '设定', icon: MapIcon },
  { key: 'foreshadow', label: '伏笔', icon: ScrollText },
]

/**
 * 规划台：把写正文之前要准备的东西集中在一页里——
 * 总纲、卷纲、章纲、角色、设定、伏笔，以及全书卷章顺序的总览与拖拽排序。
 *
 * 与正文台彻底分开：这里不渲染正文编辑器，填字段的表单是宽版而不是 320px 侧栏。
 */
export default function PlanningPage({
  book, tab, onTabChange, filter, onFilterChange,
}: {
  book: Book
  tab: PlanTab
  onTabChange: (t: PlanTab) => void
  filter: string
  onFilterChange: (v: string) => void
}) {
  // 正文在 Electron 下从 chapters/*.md 异步回填；回填前字数全是 0，
  // 此刻显示「0 字」会被当成数据丢了，先给载入态。
  const hydrated = useContentHydrated()

  const openChapter = (id: ID) => {
    actions.openChapter(id)
  }

  if (!hydrated) {
    return <div className="plan-loading">正在载入正文…</div>
  }

  return (
    <div className="plan-main">
      <div className="plan-tabs">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              className={`plan-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => onTabChange(t.key)}
            >
              <Icon size={13} /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="plan-scroll">
        {tab === 'overview' && <OutlineView book={book} onOpenChapter={openChapter} />}
        {tab === 'outline' && <OutlineTab book={book} wide />}
        {tab === 'characters' && <CharactersTab bookId={book.id} filter={filter} onFilterChange={onFilterChange} wide />}
        {tab === 'settings' && <SettingsTab bookId={book.id} filter={filter} onFilterChange={onFilterChange} wide />}
        {tab === 'foreshadow' && <ForeshadowTab bookId={book.id} filter={filter} onFilterChange={onFilterChange} wide />}
      </div>

      <div className="plan-add">
        {tab === 'characters' && (
          <button className="btn btn-ghost" onClick={() => actions.createCharacter(book.id, { name: '新角色' })}>
            <Plus size={15} /> 新增角色
          </button>
        )}
        {tab === 'settings' && (
          <button className="btn btn-ghost" onClick={() => actions.createSetting(book.id, { name: '新设定', category: 'rule' })}>
            <Plus size={15} /> 新增设定
          </button>
        )}
        {tab === 'foreshadow' && (
          <button className="btn btn-ghost" onClick={() => actions.createForeshadow(book.id, { title: '新伏笔' })}>
            <Plus size={15} /> 登记伏笔
          </button>
        )}
      </div>
    </div>
  )
}
