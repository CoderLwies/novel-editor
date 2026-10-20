import { actions, useContentHydrated } from '../store'
import type { Book } from '../types'
import OutlineView from './OutlineView'

/**
 * 大纲页：独立视图，看全书大纲表、拖拽排序、改章纲状态。
 *
 * 与写作台共用 WorkspaceShell 外壳，因此顶栏的「写作 / 大纲」切换、
 * 导出、主题等对它一律可用；点章节名则选中该章并切回写作台。
 */
export default function OutlinePage({ book }: { book: Book }) {
  // 正文在 Electron 下从 chapters/*.md 异步回填；回填前字数全是 0，
  // 此刻显示「0 字」会被当成数据丢了，先给载入态。
  const hydrated = useContentHydrated()

  if (!hydrated) {
    return <div className="outline-loading">正在载入正文…</div>
  }

  return <OutlineView book={book} onOpenChapter={(id) => actions.openChapter(id)} />
}