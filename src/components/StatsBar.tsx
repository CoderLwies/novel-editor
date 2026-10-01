import { useEffect, useRef, useState } from 'react'
import { Flame, Gauge, FileText, Library } from 'lucide-react'
import { useStore, bookWordCount } from '../store'
import type { Book, Chapter } from '../types'
import { countWords, formatNumber, todayKey, streakDays } from '../utils'

export default function StatsBar({ book, chapter }: { book: Book; chapter?: Chapter }) {
  const state = useStore()
  const totalWords = bookWordCount(state, book.id)
  const chapterWords = chapter ? countWords(chapter.content) : 0
  const todayWords = state.dailyLog[todayKey()] ?? 0
  const goal = book.dailyGoal || 1
  const pct = Math.min(100, Math.round((todayWords / goal) * 100))
  const streak = streakDays(state.dailyLog)

  // 本次会话码字速度（字/分）
  const baseRef = useRef({ words: totalWords, time: Date.now() })
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsedMin = (Date.now() - baseRef.current.time) / 60000
  const delta = totalWords - baseRef.current.words
  const speed = elapsedMin > 0.08 && delta > 0 ? Math.round(delta / elapsedMin) : 0

  return (
    <div className="statsbar">
      <span className="stat">
        <FileText size={13} /> 本章 <b>{formatNumber(chapterWords)}</b> <span className="unit">字</span>
      </span>
      <span className="stat">
        <Library size={13} /> 全书 <b>{formatNumber(totalWords)}</b> <span className="unit">字</span>
      </span>
      <span className="stat">
        <Gauge size={13} /> 速度 <b>{speed}</b> <span className="unit">字/分</span>
      </span>

      <div className="goal-wrap">
        {streak > 0 && (
          <span className="stat" style={{ color: 'var(--warning)' }}>
            <Flame size={14} /> 连续 <b style={{ color: 'var(--warning)' }}>{streak}</b> <span className="unit">天</span>
          </span>
        )}
        <span className="stat">
          今日 <b>{formatNumber(todayWords)}</b>
          <span className="unit">/ {formatNumber(goal)} 字</span>
        </span>
        <div className="goal-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className={pct >= 100 ? 'goal-done' : ''} style={{ fontWeight: 600, minWidth: 38, textAlign: 'right' }}>
          {pct >= 100 ? '已达标 ✓' : `${pct}%`}
        </span>
      </div>
    </div>
  )
}
