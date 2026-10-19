/**
 * 平台文件适配层。
 * Electron：走 IPC + 原生对话框，可读写真实目录（项目落盘）。
 * 浏览器：仅支持单文件的下载导出 / 选择导入（无目录能力）。
 */

// 单测等无 DOM 环境（node）下 native 为 undefined，模块加载不应因此崩掉
const native: FsAPI | undefined = typeof window !== 'undefined' ? window.fsAPI : undefined

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
  readText: (p: string) => requireNative().readText(p),
  writeFile: (p: string, content: string) => requireNative().writeFile(p, content),
  mkdirp: (p: string) => requireNative().mkdirp(p),
  readdir: (p: string) => requireNative().readdir(p),
  exists: (p: string) => requireNative().exists(p),
  unlink: (p: string) => requireNative().unlink(p),
}

/**
 * 存在性探测的安全版：无桌面能力（浏览器 / 单测）或 IPC 出错时返回 false。
 * 用它替代裸 exists 来守卫读取，避免「文件本来就不存在」被当成异常。
 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    return await fsLow.exists(p)
  } catch {
    return false
  }
}

/**
 * 读外部文本并探测编码（严格 utf-8 优先，回退 gb18030）。
 * 导入国内网文 txt 必需 —— 大量文件是 GBK 编码，按 utf-8 读会整篇乱码。
 */
export async function readTextFile(p: string): Promise<{ text: string; encoding: string }> {
  const r = await requireNative().readText(p)
  return { text: r.text, encoding: r.encoding }
}

/**
 * 应用数据根目录。桌面端每本书在这里落一个子目录，正文进 chapters/*.md，
 * localStorage 只留元数据 —— 这是把 5MB 配额问题彻底解决的落点。
 * 浏览器无此能力，仍走 localStorage 存全量。
 */
export async function getUserDataDir(): Promise<string> {
  return requireNative().userDataDir()
}

/** 是否具备「正文落盘」的完整能力（桌面端） */
export const supportsFileStorage = isElectron

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

export async function saveBinaryFile(
  suggestedName: string,
  data: Uint8Array,
  filters?: { name: string; extensions: string[] }[],
): Promise<SaveResult | null> {
  if (native) {
    const p = await native.saveFile({ defaultPath: suggestedName, filters })
    if (!p) return null
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < data.length; i += chunk) {
      bin += String.fromCharCode(...data.subarray(i, i + chunk))
    }
    await native.writeBinaryFile(p, btoa(bin))
    return { path: p, downloaded: false }
  }
  const blob = new Blob([data as BlobPart], { type: 'application/epub+zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { path: suggestedName, downloaded: true }
}

export async function openTextFile(
  accept: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<{ path: string; text: string; encoding: string } | null> {
  if (native) {
    const p = await native.openFile(filters)
    if (!p) return null
    // 走 readText 而非 readFile：readFile 固定 utf8，GBK 小说会整篇乱码
    return native.readText(p)
  }
  const file = await pickBrowserFile(accept)
  if (!file) return null
  // File.text() 固定按 utf-8 解码，对 GBK 小说会乱码；这里自己探测
  const buf = await file.arrayBuffer()
  const text = decodeBuffer(buf)
  return { path: file.name, text: text.text, encoding: text.encoding }
}

/** 与主进程 decodeText 保持一致：严格 utf-8 优先，回退 gb18030 */
export function decodeBuffer(buf: ArrayBuffer): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }
  } catch {
    /* 非合法 utf-8 */
  }
  try {
    return { text: new TextDecoder('gb18030').decode(buf), encoding: 'gb18030' }
  } catch {
    return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8-lossy' }
  }
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
