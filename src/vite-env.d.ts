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
  writeFile: (p: string, content: string) => Promise<boolean>
  writeBinaryFile: (p: string, base64: string) => Promise<boolean>
  mkdirp: (p: string) => Promise<string>
  readdir: (p: string) => Promise<FsDirEntry[]>
  exists: (p: string) => Promise<boolean>
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
