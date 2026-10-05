import { useEffect } from 'react'
import { useStore } from './store'
import Bookshelf from './components/Bookshelf'
import Workspace from './components/Workspace'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const state = useStore()
  const { lastBookId, theme } = state.ui

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const book = state.books.find((b) => b.id === lastBookId)

  return (
    <ErrorBoundary>
      {book ? <Workspace book={book} /> : <Bookshelf />}
    </ErrorBoundary>
  )
}
