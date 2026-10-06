export interface UpdaterStatus {
  kind: 'checking' | 'available' | 'progress' | 'downloaded' | 'error' | 'uptodate' | 'disabled'
  version?: string
  percent?: number
  message?: string
}

interface UpdaterAPI {
  check: () => Promise<boolean>
  install: () => Promise<boolean>
  onStatus: (cb: (s: UpdaterStatus) => void) => () => void
}

const api: UpdaterAPI | undefined = (window as unknown as { updaterAPI?: UpdaterAPI }).updaterAPI

export const updaterSupported = !!api

export function checkUpdate(): Promise<boolean> | undefined {
  return api?.check()
}

export function installUpdate(): Promise<boolean> | undefined {
  return api?.install()
}

export function onUpdaterStatus(cb: (s: UpdaterStatus) => void): () => void {
  return api ? api.onStatus(cb) : () => {}
}

export function updaterText(s: UpdaterStatus): string {
  switch (s.kind) {
    case 'checking':
      return '正在检查更新…'
    case 'available':
      return `发现新版本 ${s.version ?? ''}，开始下载…`
    case 'progress':
      return `更新下载中 ${s.percent ?? 0}%`
    case 'downloaded':
      return '更新已下载，可重启安装'
    case 'uptodate':
      return '当前已是最新版本'
    case 'disabled':
      return '开发模式不检查更新'
    default:
      return `检查更新失败：${s.message ?? '未知错误'}`
  }
}
