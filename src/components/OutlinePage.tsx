import { actions } from '../store'
import type { Book, ID } from '../types'
import OutlineView from './OutlineView'

/**
 * 大纲页：独立视图，看全书大纲表、拖拽排序、改章纲状态。
 *
 * 与写作台共用 WorkspaceShell 外壳，因此顶栏的「写作 / 大纲」切换、
 * 导出、主题等对它一律可用；点章节名则选中该章并切回写作台。
 */
export default function OutlinePage({ book }: { book: Book }) {
  const openChapter = (id: ID) => {
    actions.selectChapter(id)
    actions.setView('write')
  }

  return <OutlineView book={book} onOpenChapter={openChapter} />
}