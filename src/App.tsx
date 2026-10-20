import { useEffect, useState, useCallback } from 'react'
import { useStore } from './store'
import { resolveWorkspaceView } from './route'
import Bookshelf from './components/Bookshelf'
import WorkspaceShell from './components/WorkspaceShell'
import Workspace from './components/Workspace'
import PlanningPage, { type PlanTab } from './components/PlanningPage'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const state = useStore()
  const { lastBookId, theme } = state.ui

  // 规划台的当前标签与筛选词：外壳的统一搜索要能跳到规划台的对应标签
  const [planTab, setPlanTab] = useState<PlanTab>('outline')
  const [planFilter, setPlanFilter] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const book = state.books.find((b) => b.id === lastBookId)

  const pickPlanTab = useCallback((t: PlanTab) => {
    setPlanTab(t)
    setPlanFilter('')
  }, [])

  const jumpPlan = useCallback((t: PlanTab, name: string) => {
    setPlanTab(t)
    setPlanFilter(name)
  }, [])

  // 三态：书架 → 规划台 / 正文台。规划是独立视图，与正文共用外壳。
  const page = !book ? <Bookshelf /> : (
    <WorkspaceShell book={book} onPlanJump={jumpPlan}>
      {resolveWorkspaceView(state) === 'plan' ? (
        <PlanningPage
          book={book}
          tab={planTab}
          onTabChange={pickPlanTab}
          filter={planFilter}
          onFilterChange={setPlanFilter}
        />
      ) : (
        <Workspace book={book} />
      )}
    </WorkspaceShell>
  )

  return <ErrorBoundary>{page}</ErrorBoundary>
}
