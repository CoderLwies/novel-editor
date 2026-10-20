import { useEffect } from 'react'
import { useStore } from './store'
import { resolveWorkspaceView } from './route'
import Bookshelf from './components/Bookshelf'
import WorkspaceShell from './components/WorkspaceShell'
import Workspace from './components/Workspace'
import OutlinePage from './components/OutlinePage'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const state = useStore()
  const { lastBookId, theme } = state.ui

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const book = state.books.find((b) => b.id === lastBookId)

  // 三态：书架 → 写作台 / 大纲页。大纲是独立视图，与写作台共用外壳。
  const page = !book ? <Bookshelf /> : (
    <WorkspaceShell book={book}>
      {resolveWorkspaceView(state) === 'outline' ? <OutlinePage book={book} /> : <Workspace book={book} />}
    </WorkspaceShell>
  )

  return <ErrorBoundary>{page}</ErrorBoundary>
}
