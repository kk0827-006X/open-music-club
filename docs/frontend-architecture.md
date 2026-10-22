# 前端架构与协作指南

## 当前版本与边界

本节描述 React 迁移后的代码，而不是旧的原生 DOM 页面工厂。

- 分支：`codex/react-migration`；基线：`7c38c6ef40728054199651e68d9b5ca2682e72b0`。
- TypeScript + React 19 + Vite 7；不引入第二前端框架。
- Three.js 档案墙、模型、原波浪/选择/入场授权轨迹保持原实现；图形不迁移 WebGPU。
- 普通交互使用 Motion、Radix Slider；登录折射使用 Liquid Glass React，保留原背景及表单。
- API、Cookie、CSRF、Session、TOTP、恢复码、权限、来源分离及数据库协议不变。
- 执行记录、验收结果和准确暂存清单见 [React 迁移记录](react-migration.md)。
- 原 `AGENTS.md` 与 `docs/frontend-design/` 属于用户开工前改动，不混入迁移。

## 审计结论与本轮处理

2026-10-13 的上一轮模块化已经抽出了服务、唯一音频核心、中立 Track、Three 宿主与顺序保真的 CSS。本轮不重复重写这些模块。实际剩余问题是：

| 基线问题 | 迁移后的边界 |
| --- | --- |
| 页面仍由字符串模板及查询/事件监听驱动，视图难复用 | React JSX 拥有页面与按钮的 DOM，状态驱动更新 |
| 工作区统一调度和各页命令混在闭包里 | App / Workspace 装配，页面通过公开 props 与 ref 接口请求动作 |
| 底栏、展开层、队列为原生 DOM 更新 | PlayerView 订阅既有 PlayerController；QueuePanel 为 Motion Reorder |
| 旧模板与新组件可能并存 | 旧入口只挂载或 SSR 同一生产组件，不维护另一份业务模板 |
| 旧测试匹配源码实现，不能证明 React 真受测 | JSDOM 挂载真实组件，加真实浏览器认证、媒体及指针回归 |
| 取消后的拖动结束回调可能串入下一会话 | Motion cancel 不派发迟到结束；提交检查已收到对应松手 |
| 自写与库内建边缘滚动同时执行 | 只保留 Motion 的自动滚动所有权 |
| 高频播放进度更新可能重绘长队列 | 稳定队列快照、动作回调与 memo 隔离；不宣称未经实测的性能收益 |

AST 检查覆盖 TS/TSX、动态 import、纯类型引用与唯一 Audio 创建点。没有发现新增运行时循环；Shared、Services、Graphics 的依赖规则由测试约束。

## 当前目录与依赖方向

```text
main.ts → App
           ├─ EntryPage / LoginPage / AuthorizedSequence
           └─ SessionWorkspace（认证会话的音频所有者）
                └─ Workspace（页面、导航、场景、动作装配）
                    ├─ LibraryView
                    ├─ SearchPage / UserPage / UploadPage（懒加载，访问后保留实例）
                    ├─ PlayerView → QueuePanel / QueueAddFlights
                    └─ SettingsDialog → TwoFactorPanel

features → services / shared
app → features / graphics / services / shared
graphics → rhine / shared
services → shared
shared 不依赖 features / app / graphics
```

```text
frontend/src/
├─ main.ts
├─ app/
│  ├─ App.tsx                 身份驱动阶段；退出与统一清理
│  ├─ Workspace.tsx           页面切换、公开动作注入、全局快捷键
│  └─ *.ts                    旧预览/挂载兼容边界
├─ shared/
│  ├─ music.ts / state.ts     中立数据契约、轻量实例状态
│  ├─ theme.ts / ui/icons.ts   主题接口、唯一图标几何
│  └─ react/
│     ├─ ui.tsx               Icon、IconButton、Brand、原生 Modal
│     ├─ controls.tsx         Radix 音量滑杆
│     ├─ hooks.ts             减少动态效果、延迟隐藏
│     ├─ LoginGlassEffect.tsx  库折射与 Motion 呼吸、输入保护
│     ├─ ErrorBoundary.tsx    装饰降级、页面错误恢复
│     └─ mount.ts             唯一旧入口 React 挂载/SSR 适配
├─ features/
│  ├─ auth/*.tsx              登录、2FA、入口、授权视图
│  ├─ music-library/
│  │  ├─ LibraryView.tsx       专辑选择、详情、视觉状态与共享纯视图
│  │  ├─ tracks.ts            专辑资料转中立曲目
│  │  └─ album-data.ts        原静态目录，API 适配另在 services
│  ├─ player/
│  │  ├─ player-core.ts       唯一 Audio 控制器，框架独立
│  │  ├─ PlayerView.tsx       底栏、展开歌词、收藏及歌单浮层
│  │  └─ preview-state.ts     无音频、无请求的 SSR 快照
│  ├─ queue/
│  │  ├─ model / persistence  原队列算法和紧凑串行持久化
│  │  ├─ QueuePanel.tsx       图标、拖拽草稿、松手提交、键盘排序
│  │  └─ QueueAddFlights.tsx  全站共用一次点击起点与 Motion 飞行
│  ├─ search/SearchPage.tsx
│  ├─ user/UserPage.tsx
│  ├─ upload/UploadPage.tsx   标签解析仍是独立 metadata.ts
│  └─ settings/SettingsDialog.tsx
├─ services/
│  ├─ auth/session.ts        原身份确认与 2FA 请求
│  └─ music/                 网易云、本地、个人资料、上传等独立适配
├─ graphics/archive/scene-host.ts
├─ rhine/                    原图形、模型、材质、交互、资源算法
├─ styles/                   原 12 段 CSS + React 控件适配
└─ 根目录薄兼容导出
```

不规定单文件行数。简单组件、页面内部状态不机械拆成四层；图形、请求、音频不放进 JSX 业务闭包。

## 生命周期与稳定接口

| 所有者 | 创建/持有 | 清理边界 |
| --- | --- | --- |
| React root | App、登录和认证会话 | HMR/unmount |
| App | 身份代次、延迟授权计时 | 退出、阶段切换、卸载；迟到响应不能提升身份 |
| SessionWorkspace | MusicQueue、唯一 PlayerController/Audio | 整个认证会话结束；不随普通切页销毁 |
| Workspace | 当前页面、已访问页面、场景宿主、公开动作 | 工作区卸载；不销毁外部注入 Audio |
| 各页面 | 表单、筛选、分页、请求序号、AbortController/Object URL | 组件卸载；隐藏与销毁不是同一件事 |
| PlayerView | 音频状态订阅、歌词请求、队列持久化同步器、浮层 | 视图卸载取消订阅/请求/监听，不停止应用音频 |
| 场景宿主 | 唯一档案 RAF、resize/visibility、主题订阅 | 隐藏暂停；退出释放含迟到加载的场景 |

### 页面动作

- `MusicActions.play(track)` / `enqueue(track)` 是搜索、用户、专辑的统一入口。
- 页面不读取 HTMLAudioElement，也不访问其他 Features 的内部 DOM。
- ref 只公开必要能力：搜索 focus/refresh/ownsKeyboardTarget；用户 refresh/hasOpenDialog；库 select/navigate/openDetail；设置 show/close/open；播放器 play/enqueue/choosePlaylist/setExpanded。
- 退出动画使用 active 与 visible 两个状态：先 inert、开始淡出，再 hidden。重进清理旧隐藏计时。
- 原生 dialog 的 top layer 和焦点围栏保留；180ms 退场只由所属页面拥有，不在共享 Modal 再计时一次。

### 音频与队列

- 同一会话一个 Audio，唯一创建点 `features/player/player-core.ts`。
- `PlayerController.get/subscribe/play/toggle/next/previous/seek/setVolume/clear/destroy` 保持接口。
- URL 解析、歌词与异步曲目竞争保护继续由原服务/核心负责。
- 队列继续用原 key、500 首上限、去重/排序/来源、紧凑 source/sourceId 持久化。
- Motion 拖拽只改本地 draft，松手提交一次；cancel/Escape/卸载不提交。
- 原版 key 差异仍保留：搜索云端 `netease:song:<id>`，个人/专辑 `netease:<id>`。不能借迁移擅自统一，否则会改变原队列去重和保存行为。

### 图形与动效

- React 只装配 scene-host，不逐帧 setState；详情视觉量继续细粒度写自有 CSS 变量。
- Three.js 的相机、材质、波浪、选择和资源释放不由页面 UI 重写。
- Logo/入场 SVG 仍沿用原图形与采样轨迹。Liquid Glass 仅替代被允许替换的登录折射。
- 装饰懒加载故障降级为无特效，不销毁登录表单；编辑、2FA、后台或减少动态效果时暂停装饰。
- Liquid Glass 的折射在非 Chromium 浏览器有库自身兼容限制，不承诺 Safari/Firefox 完全一致。
- 当前原 `app/navigation.ts` 只为上一轮纯逻辑兼容测试保留，不在生产入口使用，也不允许承载新路由逻辑。

## 变更映射与验证

| 原入口/职责 | 当前实现 | 接口变化 | 对应验证 |
| --- | --- | --- | --- |
| main / app-controller | main + App.tsx | 生产 createRoot；旧入口只注入真实服务，不替换页面 UI 工厂 | AppLifecycle、AuthFlow |
| music-workspace / workspace-view | Workspace.tsx | 显式 player/queue/client/scene 输入；旧挂载/SSR 兼容 | Workspace、React、Architecture |
| 登录 / 两步 / 设置模板 | auth/*.tsx、SettingsDialog.tsx | 旧返回形状薄适配；原认证服务不变 | Login、LoginDialog、Settings、Theme、真实 E2E |
| 搜索 / 用户 / 上传模板 | 各领域 Page.tsx | props 动作、ref 能力；旧预览来自实际 JSX | React、UserPage、Upload、UploadLifecycle |
| library-controller / view | LibraryView、AlbumInformation/Detail | 场景/音乐动作注入；旧 SSR 接口保留 | AlbumArchive、原图形纯算法 |
| player-view / markup | PlayerView、预览快照 | 不创建音频；SSR 与生产共享视图 | Player、PlayerCore、Workspace |
| panel / add-animation | QueuePanel / QueueAddFlights | 移除旧自造 DOM 拖动/动画入口；纯曲线仍复用 | PlayerQueue、QueueAnimation、浏览器真实指针 |
| login-glass 三文件 | LoginGlassEffect + 现成库 | 移除旧自造渲染器；原背景保留 | LoginGlass、默认动效浏览器检查 |
| style.css | 原 CSS + react-components.css | 不改原选择器/断点/优先级；普通滑杆允许库替代 | 原 2930 条声明及哈希、Theme、截图 |
| package / lock / tsconfig / vite | React、Motion、Radix、tsx 等 | Vite7/端口/代理不变；测试显式用同一 JSX 配置 | frozen install、build、audit、全量测试 |

## 验证现状

- 冻结安装、TypeScript/Vite 构建成功；315 项单元/集成测试通过、0 跳过。
- 原 2930 条浅色 CSS 声明与 SHA256 保持一致，主题 token 两套对应测试通过。
- 现有 coverage 检查通过：lines/statements 96.85%、functions 96.62%、branches 88.82%。**这是原后端目录 `src/**` 的覆盖口径，不是宣称整个 React UI 有 96% 覆盖率。**
- 已验证真实隔离申请/审批、登录、2FA 绑定/挑战/重放/恢复码、混合真实 Audio/Range/歌词/重新登录恢复；上游用合成 WAV 和 Mock。
- React 多页切换、主题不重建 Audio、Radix 音量、队列清空/外部点击、Motion 指针跨行与取消/边缘滚动已通过。
- 最终资源、默认动效和截图结果以迁移记录的最后验收为准；不把上一轮测试结果当成本轮证据。
- 没有生产部署、真实用户数据、VIP/网易云真实上游、SMTP、真实公网 HTTPS 验收。
- 安全审计：0 high/critical；既有 ip-address/music-metadata 中风险与第三方开发依赖 diff 低风险仍在，详见迁移记录，未在本轮擅自升级无关后端依赖。
- 没有默认画质 FPS、长期堆内存或 GPU 显存基准，不声称性能已提升或彻底无泄漏。

## 后续开发方法

### 新增页面

1. 在 `features/<领域>/` 编写 JSX 组件，props 注入服务和 MusicActions。
2. 明确 active/隐藏/卸载行为，异步操作带取消或代次校验；URL、timer、订阅归属组件。
3. 在 Workspace 登记懒加载页面、导航、visited 和必要 ref，不从页面反向导入 Workspace。
4. 样式继续使用原 tokens；新图标复用 Icon。补真实组件测试与跨页浏览器流程。

### 新增音乐来源

先单独确认产品/安全范围；在 Shared 扩展中立来源契约、Services 写独立适配、App 注入 URL resolver。不要合并网易云和本地底层协议。同步验证 key、去重、来源权限、失败/取消、持久化兼容。

### 扩展播放器

核心动作/状态加到 player-core，UI 用 useSyncExternalStore 订阅。绝不在搜索、用户或展开层创建 Audio。修改队列用统一动作，进度更新不要使整个长列表重绘。

### 新增设置项

组件放 settings，数据访问放 Services；跨页面效果由 App 注入窄动作。当前未接入项继续禁用，不借组件迁移启用新功能。主题通过唯一 theme 服务，不直接改播放器或 scene 内部字段。

### 新增图形场景

实现 ArchiveSceneController 类似的显式接口，由宿主负责加载、可见性、resize、RAF、dispose。场景只接受视觉输入，不接登录或播放器实例。覆盖加载迟到、共享贴图、重复销毁、隐藏停止及重复挂载观察。

### 多 Agent 分工

- 一个执行者一个 worktree/branch，负责自己的 feature + 对应 tests；不共享写同一目录。
- App、Shared、依赖/lock、全局 CSS 安排单一负责人；接口先约定，再同步。
- 稳定契约：Track/MusicActions、PlayerController/State、服务请求协议、场景控制接口、主题 tokens、同名 Icon 几何。
- 主 Agent 集成后集中构建/测试/审查/浏览器验收，不用执行者报告替代结果。
- 不自动提交/合并/部署。准确 git add 清单仅见 [本次迁移记录](react-migration.md)，不要执行历史重构的暂存命令。
