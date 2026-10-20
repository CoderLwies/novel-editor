import { useMemo } from 'react'
import { useStore, volumesOf } from '../store'
import type { Book, Chapter } from '../types'

/**
 * 当前编辑的章节：优先用已选中的，否则回退到全书第一章。
 *
 * 写作台和大纲页都要用它（大纲页的 StatsBar 也依赖），故抽成 hook 复用，
 * 避免两处各算一遍而出现选中态不一致。
 */
export function useCurrentChapter(book: Book): Chapter | undefined {
  const state = useStore()

  const volumes = useMemo(() => volumesOf(state, book.id), [state, book.id])

  const bookChapters = useMemo(
    () => state.chapters.filter((c) => c.bookId === book.id),
    [state.chapters, book.id],
  )

  return useMemo(() => {
    const sel = state.ui.lastChapterId
    if (sel && bookChapters.some((c) => c.id === sel)) {
      return bookChapters.find((c) => c.id === sel)
    }
    const volOrder = new Map(volumes.map((v, i) => [v.id, i]))
    const sorted = [...bookChapters].sort((a, b) => {
      const va = volOrder.get(a.volumeId) ?? 0
      const vb = volOrder.get(b.volumeId) ?? 0
      return va - vb || a.order - b.order
    })
    return sorted[0]
  }, [state.ui.lastChapterId, bookChapters, volumes])
}