# 字舟 · 网文小说编辑器

<img src="public/logo.png" alt="字舟 logo" width="96" align="right" />

面向网文连载作者的桌面写作工具。**编辑器优先**——把码字、章节管理、设定集与大纲做扎实，AI 作为叠加层辅助策划与一致性校验。

Electron 桌面应用 · React + Vite + TypeScript · 无后端，数据保存在本地。

---

## 特性

### 写作核心
- **书架**：多作品管理，封面色 / 连载状态 / 月更目标进度一目了然；启动恒落书架
- **三栏工作台**：卷-章树 · 沉浸编辑器 · 侧栏（大纲 / 角色 / 设定 / 伏笔）
- **码字统计**：实时字数与速度、日更目标、连续更新天数、全书纲覆盖率；达成日更目标提醒一次
- **写作体验**：跨章节全文搜索/替换（命中跳转定位）、章节快照与版本历史回滚、撤销/重做（Ctrl+Z/Y）、落盘同步状态指示、专注模式（隐藏目录侧栏+正文居中）、打字机滚动
- **明暗主题**、可调字号
- **统一搜索（Ctrl+K）**：章节标题 / 正文 / 角色 / 设定 / 伏笔一框检索；正文命中跳章并定位选区，元数据命中切对应侧栏 tab 并注入过滤词
- **新手引导与帮助**：首次启动五步引导；顶栏帮助页汇总快捷键、功能入口与常见问题

### 大纲体系
- **卷纲**：概括 / 目标 / 核心冲突
- **结构化章纲**：目标 / 冲突 / 转折 / 结尾钩子 / 视角人物 / 出场角色 / 伏笔埋收挂接 / 纲状态（计划中 · 已写 · 已修）
- **全书大纲表**：拖拽排序、跨卷移动、行内改纲状态、点击回正文
- **伏笔管理**：埋设/回收双挂接链路、按章序埋收时间线、重要度（主线/支线/细节）、关联角色、跨度与"回收早于埋设"等告警
- **导出**：全书大纲 / 设定集 / 伏笔表 Markdown

### 角色与设定体系
- **角色卡**：定位 / 状态（存活·死亡·失踪·退场+色点）/ 别名（参与正文命中）/ 外貌·性格·背景·动机·能力五维折叠字段 / 关系网（可跳对方卡）/ 出场章节与统计 / 相关伏笔
- **设定集**：五类（地点·物品·势力·规则·功法）/ 当前状态 / 按名称命中正文的出现章节反向索引
- **检索**：角色 / 设定 / 伏笔三个 tab 均支持搜索过滤

### 落盘与导入导出
- 作品可**绑定本地目录**，编辑即自动同步落盘：
  - `book.json`（项目元数据，version 2）
  - `chapters/NNNN_标题.md`（正文 + YAML frontmatter 携带章纲与伏笔埋收字段）
- **外部编辑器改 md 可回读**：重新导入时 frontmatter 优先合并
- 导入：字舟项目目录 / 单个 TXT·MD（自动拆卷章）；兼容旧版 v1 项目与旧存储键自动迁移
- 导出：项目包 / 纯 TXT / Markdown / 全书大纲 / 设定集 / 伏笔表 / **EPUB 电子书**（标准 EPUB3，含导航与卷章结构）

### AI 辅助
- **拆章纲**（卷级）：依据总纲 + 卷纲规划新章节，预览多选后建章
- **走向分支**（章级）：为单章推演多个剧情分支，一键采用
- **写后回写**（章级）：依据正文归纳实际 synopsis / 转折 / 钩子，并按名字+别名快照出场人物
- **选中文本操作**：编辑器选中正文即出现 续写 / 润色 / 审查（结果可编辑再采用）
- **一致性巡检**：有正文仍"计划中"、挂角未出场（含别名）、同章混用称呼、伏笔埋设超 10 章未收 / 登记未挂接 / 回收早于埋设 / 状态与挂接不符、已死亡角色仍挂接最新章、空卷

走 OpenAI 兼容协议（`POST {baseUrl}/chat/completions`），Base URL 预填 DeepSeek 官方、可改为兼容中转站；模型提供预设（deepseek-flash / chat / reasoner）并可自填。

### 分发
- Windows NSIS 安装包：简体中文界面、安装时自选目录、嵌入应用图标
- 自动更新：electron-updater（generic provider；部署时把 `build.publish` 的 url 替换为自有更新服务器）。文件菜单「检查更新」，启动后亦自动检查；下载完成提示重启安装
- 首包瘦身：jszip 等重依赖动态 import，仅导出 EPUB 时加载

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 31（contextIsolation + IPC 文件桥） |
| 前端 | React 18 + Vite 5 + TypeScript |
| 状态 | `useSyncExternalStore` 外部 store + localStorage 持久化 |
| 图标 | lucide-react |
| 打包 | electron-builder（NSIS） |

---

## 快速开始

```bash
# 安装依赖（.npmrc 已配置 npmmirror 镜像）
npm install

# 浏览器开发（热更新）
npm run dev

# Electron 桌面开发
npm run electron:dev

# 构建渲染层
npm run build

# 打包桌面安装包（输出到 release/）
npm run electron:build
```

类型检查：`npm run typecheck`。

---

## 目录结构

```
├── electron/
│   ├── main.cjs        # 主进程：窗口 + 文件系统 IPC 桥
│   ├── preload.cjs     # contextBridge 暴露 window.fsAPI
│   ├── verify.cjs      # 无头 E2E（stub 对话框 + 断言落盘 + 截图）
│   └── capture.cjs     # 界面截图到 .preview/
├── public/
│   └── logo.png        # 应用 logo / favicon / 窗口图标 / 打包图标源
├── src/
│   ├── ai.ts           # AI 提供层（chatJSON / 提示词 / 一致性巡检）
│   ├── frontmatter.ts  # YAML 子集编解码（章节 md 头部）
│   ├── project.ts      # 落盘格式序列化 + 导入导出 + 各表导出
│   ├── store.ts        # 全局 store 与 actions
│   ├── seed.ts         # 示例数据
│   ├── types.ts        # 领域模型
│   └── components/     # 书架 / 工作台 / 侧栏 / 大纲 / 搜索 / AI 弹窗 …
└── .preview/           # 验证截图（git 忽略，本地生成）
```

---

## 落盘格式

绑定目录后结构如下：

```
<作品目录>/
├── book.json                 # format: zizhou-project, version: 2
├── chapters/
│   ├── 0001_第一章 标题.md
│   └── 0002_第二章 标题.md
└── history/                  # 章节快照（index.json 元数据 + 每快照一个 md）
```

章节 md 以 frontmatter 携带章纲，正文在其后：

```markdown
---
title: 第一章 标题
outlineStatus: written
synopsis: 一句话概括
goal: 本章目标
turning: 转折点
hook: 结尾钩子
pov: 视角人物
cast: [char_1]
foreshadowIds: [fs_1]
foreshadowPayoffs: [fs_2]
---

正文内容……
```

`foreshadowIds` 为本章埋设的伏笔、`foreshadowPayoffs` 为本章回收的伏笔。外部工具直接编辑该 md（含 frontmatter）后，在字舟中重新导入即可回读。

---

## AI 配置

工作台顶栏 → 「AI 接口设置」：

- **Base URL**：默认 `https://api.deepseek.com`，可改为任意 OpenAI 兼容中转
- **API Key**：DeepSeek 密钥（本地免鉴权服务可留空）
- **模型**：预设 chips（deepseek-flash / deepseek-chat / deepseek-reasoner）或自填任意兼容模型名

配置仅存本机 localStorage；请求由桌面端直连所填地址，不经过任何第三方服务器。

---

## 验证

- `npm test`：单元测试（vitest），覆盖 frontmatter 编解码、AI JSON 解析/角色快照/巡检规则、store 迁移、EPUB 包结构。
- `npx electron electron/verify.cjs`：无头端到端。stub 目录/保存对话框、清空 localStorage、驱动 DOM、断言磁盘与状态、`capturePage` 截图；内置回环假 AI 服务跑通拆纲/分支/回写/选区续写/巡检全链路，并覆盖落盘往返、旧键迁移、搜索替换、快照回滚与落盘、撤销重做、专注模式、伏笔埋收、角色关系与导出。
- `npx electron electron/capture.cjs`：生成界面截图到 `.preview/`。

---

## 路线图

- [ ] 代码签名（消除 SmartScreen 警告）
- [ ] 大书状态分片或 IndexedDB；章节树/大纲表虚拟化
- [ ] 应用内帮助页
- [ ] 角色成长弧线、关系图可视化、AI 角色卡补全
- [ ] 伏笔↔设定互挂、跨章时间线矛盾校验
- [ ] macOS / Linux 打包

---

## 说明

本项目为可交互原型：数据存本地（localStorage + 可选目录落盘），无账号与云同步。删除作品不可撤销，请注意备份。
