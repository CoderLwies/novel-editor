/// <reference types="vite/client" />

interface FsDirEntry {
  name: string
  isDir: boolean
}

interface FsSaveOptions {
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

interface FsAPI {
  isElectron: boolean
  readFile: (p: string) => Promise<string>
  /** 读取外部文本并探测编码（utf-8 → gb18030 回退），导入小说用 */
  readText: (p: string) => Promise<{ path: string; text: string; encoding: string }>
  writeFile: (p: string, content: string) => Promise<boolean>
  writeBinaryFile: (p: string, base64: string) => Promise<boolean>
  mkdirp: (p: string) => Promise<string>
  readdir: (p: string) => Promise<FsDirEntry[]>
  exists: (p: string) => Promise<boolean>
  unlink: (p: string) => Promise<boolean>
  /** 应用数据根目录，正文落盘用 */
  userDataDir: () => Promise<string>
  openDirectory: () => Promise<string | null>
  openFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  saveFile: (opts?: FsSaveOptions) => Promise<string | null>
}

interface Window {
  electronAPI?: {
    isElectron: boolean
    platform: string
    versions: { electron: string; chrome: string; node: string }
  }
  fsAPI?: FsAPI
}
