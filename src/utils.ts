/** 中文字数：去除所有空白字符后的长度 */
export function countWords(text: string): number {
  if (!text) return 0
  return text.replace(/\s/g, '').length
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** 连续更新天数：从今天(或昨天)往前数，dailyLog 中字数>0 的连续天数 */
export function streakDays(dailyLog: Record<string, number>): number {
  let streak = 0
  const cur = new Date()
  // 今天还没写不算断，从昨天起也可
  if ((dailyLog[todayKey(cur)] ?? 0) <= 0) {
    cur.setDate(cur.getDate() - 1)
  }
  for (let i = 0; i < 3650; i++) {
    const key = todayKey(cur)
    if ((dailyLog[key] ?? 0) > 0) {
      streak++
      cur.setDate(cur.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}
