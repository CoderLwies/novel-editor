import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { actions } from '../store'

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[字舟] 渲染崩溃：', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const e = this.state.error
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg, #16161b)', color: 'var(--text, #eee)' }}>
        <div style={{ maxWidth: 560, width: '100%', background: 'var(--bg-elev, #1e1e24)', border: '1px solid var(--border, #333)', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 700, marginBottom: 10 }}>
            <AlertTriangle size={18} style={{ color: 'var(--warning, #f5a623)' }} /> 界面崩溃了
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-faint, #999)', margin: '0 0 14px' }}>
            你的作品数据保存在本地，通常不受影响。可先尝试重新加载；若反复崩溃，可重置示例数据（会清除本地修改）。
          </p>
          <details style={{ fontSize: 12, color: 'var(--text-faint, #999)', marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer' }}>错误详情</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 8 }}>{`${e.message}\n${e.stack ?? ''}`}</pre>
          </details>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>重新加载</button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (window.confirm('重置为初始示例数据？当前本地修改将被清除。')) {
                  actions.resetDemo()
                  window.location.reload()
                }
              }}
            >
              重置示例数据
            </button>
          </div>
        </div>
      </div>
    )
  }
}
