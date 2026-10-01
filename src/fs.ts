/**
 * 平台文件适配层。
 * Electron：走 IPC + 原生对话框，可读写真实目录（项目落盘）。
 * 浏览器：仅支持单文件的下载导出 / 选择导入（无目录能力）。
 */

const native = window.fsAPI

export const isElectron = !!native?.isElectron
/** 是否支持"项目文件夹"落盘（仅桌面端） */
export const supportsProjectFolders = isElectron

export class NotSupportedError extends Error {
  constructor() {
    super('项目文件夹落盘需要在桌面端（Electron）中使用')
    this.name = 'NotSupportedError'
  }
}

function requireNative(): FsAPI {
  if (!native) throw new NotSupportedError()
  return native
}

/* ------------------------------ 低层读写 ------------------------------ */

export const fsLow = {
  readFile: (p: string) => requireNative().readFile(p),
  writeFile: (p: string, content: string) => requireNative().writeFile(p, content),
  mkdirp: (p: string) => requireNative().mkdirp(p),
  readdir: (p: string) => requireNative().readdir(p),
  exists: (p: string) => requireNative().exists(p),
}

/* ------------------------------ 高层操作 ------------------------------ */

export async function pickDirectory(): Promise<string | null> {
  return requireNative().openDirectory()
}

export interface SaveResult {
  /** Electron 为真实路径；浏览器为下载文件名 */
  path: string
  /** 浏览器走的是下载而非指定路径保存 */
  downloaded: boolean
}

export async function saveTextFile(
  suggestedName: string,
  text: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<SaveResult | null> {
  if (native) {
    const p = await native.saveFile({ defaultPath: suggestedName, filters })
    if (!p) return null
    await native.writeFile(p, text)
    return { path: p, downloaded: false }
  }
  downloadInBrowser(suggestedName, text)
  return { path: suggestedName, downloaded: true }
}

export async function openTextFile(
  accept: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<{ path: string; text: string } | null> {
  if (native) {
    const p = await native.openFile(filters)
    if (!p) return null
    const text = await native.readFile(p)
    return { path: p, text }
  }
  const file = await pickBrowserFile(accept)
  if (!file) return null
  const text = await file.text()
  return { path: file.name, text }
}

/* ---------------------------- 浏览器降级实现 ---------------------------- */

function downloadInBrowser(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
