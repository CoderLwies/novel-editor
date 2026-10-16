import { useEffect, useState } from 'react'
import { useStore, useContentHydrated } from './store'
import Bookshelf from './components/Bookshelf'
import Workspace from './components/Workspace'
import ReferenceLibrary from './components/ReferenceLibrary'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const state = useStore()
  const hydrated = useContentHydrated()
  const { lastBookId, theme } = state.ui
  const [view, setView] = useState<'shelf' | 'library'>('shelf')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const book = state.books.find((b) => b.id === lastBookId)

  // 正文已落盘，启动需从磁盘回填。回填期间不渲染工作台：
  // 否则编辑器会拿空正文盖掉 hydrate 结果，或吃掉用户刚输入的字
  if (!hydrated) {
    return (
      <div className="boot-splash">
        <div className="boot-mark">字</div>
        <div className="boot-text">正在载入本地作品…</div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      {view === 'library' ? (
        <ReferenceLibrary onBack={() => setView('shelf')} />
      ) : book ? (
        <Workspace book={book} />
      ) : (
        <Bookshelf onOpenLibrary={() => setView('library')} />
      )}
    </ErrorBoundary>
  )
}
