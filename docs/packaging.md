# 发版流程

## 常规步骤

```bash
npm version 0.3.0 --no-git-tag-version   # 改 package.json + package-lock.json
npm run e2e                              # 先跑端到端（= build + electron verify.cjs）
npm run build                            # vite build
npx electron-builder                     # 打包 Windows 安装包
```

产物在 `release/`（已 gitignore）：

- `ZiZhou Setup <版本>.exe` —— 安装包
- `ZiZhou Setup <版本>.exe.blockmap` —— 增量更新用
- `latest.yml` —— 指向最新版本的元信息（`sha512` 是 **base64**，不是 hex）
- `win-unpacked/` —— 免安装目录

## 校验 sha512

`latest.yml` 里的是 base64 编码的裸哈希，PowerShell 的 `Get-FileHash` 给的是 hex，直接比会不匹配：

```powershell
$hex = (Get-FileHash $exe -Algorithm SHA512).Hash
$bytes = New-Object byte[] ($hex.Length/2)
for ($i=0; $i -lt $hex.Length; $i+=2) { $bytes[$i/2] = [Convert]::ToByte($hex.Substring($i,2),16) }
[Convert]::ToBase64String($bytes) -eq $declared
```

## 坑：MiniMax Code 会锁住 release 目录，导致打包失败

症状：

```
⨯ remove release\win-unpacked\resources\app.asar:
  The process cannot access the file because it is being used by another process.
```

electron-builder 打包前要清空 `release/win-unpacked`，但 `app.asar` 被**当前运行的 MiniMax Code**（PID 即本进程）锁着——它扫项目目录时把 78MB 的 asar 打开了。杀进程等于自杀，所以只能绕。

**解法：把输出目录放到项目外**，那里 MiniMax Code 不扫，不会被锁：

```powershell
$out = Join-Path $env:TEMP "zizhou-pack"
npx electron-builder --config.directories.output="$out"
Copy-Item "$out\ZiZhou Setup 0.3.0.exe" "D:\web\novel-editor\release\" -Force
Copy-Item "$out\latest.yml" "D:\web\novel-editor\release\" -Force
```

打包后 `release/win-unpacked` 里可能残留一个被锁的旧 `app.asar`（删不掉），**重启 MiniMax Code 后**再清理：

```bash
rm -r release/win-unpacked release/win-unpacked-0.2.8-locked
```

用 Restart Manager API 可以确认是谁占着：

```powershell
# RmStartSession / RmRegisterResources / RmGetList，见 .preview 下的历史脚本
```

## E2E

```bash
npm run e2e    # = npm run build && electron electron/verify.cjs
```

要点：

- 脚本用 `win.loadFile(dist/index.html)`，**必须先 build**
- 目录选择框与保存框是打桩的（`ipcMain.handle` 存根），所以能无头跑
- 内置了一个假的 OpenAI 服务，返回固定 JSON，AI 相关断言不联网
- 断言以 `console.log('E2E xxx -> ...')` 形式输出，最后一行 `CONSOLE ERRORS: none` 是关键
- 截图偶尔会因为 `capturePage()` 拿不到 display surface 而跳过（脚本自己 try/catch 兜住），**截图跳过 ≠ 断言失败**，看断言值即可
- `electron/capture.cjs` 是另一套独立截图脚本，会清空 localStorage 跑一遍全流程截图

## 手动发版

`package.json` 的 `build.publish` 指向 `https://update.zizhou.example.com/releases/`（示例域名）。`electron-builder` **不会自动上传**——需要把 `release/` 里的 exe、blockmap、latest.yml 手动传到该地址。
