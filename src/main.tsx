import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { bootstrapStorage } from './store'
import './styles/global.css'

// 正文落盘 + 从磁盘回填；失败时内部会兜底，不会把 UI 卡在载入态
void bootstrapStorage()

function Root() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // 渲染层兜底：避免白屏无提示
      if (e.message) console.error('[字舟]', e.message)
    }
    window.addEventListener('error', onError)
    return () => window.removeEventListener('error', onError)
  }, [])
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
