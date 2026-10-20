import { useStore } from '../store'
import type { Book } from '../types'
import { useCurrentChapter } from '../hooks/useCurrentChapter'
import Editor from './Editor'

/**
 * 写作台：正文编辑视图。
 * 顶栏、目录树、侧栏、各弹窗由 WorkspaceShell 提供，这里只负责正文区。
 */
export default function Workspace({ book }: { book: Book }) {
  const state = useStore()
  const currentChapter = useCurrentChapter(book)
  const focusMode = state.ui.focusMode ?? false

  return (
    <Editor
      chapter={currentChapter}
      fontSize={state.ui.fontSize}
      focus={focusMode}
      typewriter={focusMode}
    />
  )
}