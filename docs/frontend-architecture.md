# 前端架构与开发指南

本文描述 `frontend/src` 的现行实现。早期前端设计草案中的概念图、建议色值和未落地提案不是当前事实；仍待确认的产品选择统一列在文末，并同步到技术路线图。

## 技术栈与边界

- TypeScript + React 19 + Vite 7，不引入第二套前端框架。
- Three.js 档案墙、模型、波浪/选择/入场授权轨迹保留原实现，不迁移 WebGPU。
- 普通交互使用 Motion，音量滑杆使用 Radix Slider；登录折射使用 Liquid Glass React，保留原背景和表单。
- API、Cookie、CSRF、Session、TOTP、恢复码、权限、来源分离和数据库协议不变。
- React JSX 拥有页面和按钮的 DOM，状态驱动更新；旧入口只挂载或 SSR 同一生产组件，不维护第二份业务模板。
- 产品边界：受控成员、公网 HTTPS；只使用一个播放器；网易云音乐与本地音乐在存储、API 和来源标识层保持独立；不接入网易云评论、排行榜、推荐、FM、直播等功能。

## 目录与依赖方向

```text
main.ts → App
           ├─ EntryPage / LoginPage / AuthorizedSequence
           └─ SessionWorkspace（认证会话的音频所有者）
                └─ Workspace（页面、导航、场景、动作装配）
                    ├─ LibraryView
                    ├─ SearchPage / UserPage / UploadPage / FootprintPage（懒加载，访问后保留实例）
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
│  ├─ App.tsx                 身份驱动阶段；退出、统一清理、足迹上报装配
│  ├─ Workspace.tsx           页面切换、懒加载/visited、公开动作注入、全局快捷键
│  └─ *.ts                    旧预览/挂载兼容边界
├─ shared/
│  ├─ music.ts / state.ts     中立 Track/MusicActions 契约、轻量实例状态
│  ├─ theme.ts / ui/icons.ts  主题窄接口、唯一图标几何
│  └─ react/
│     ├─ ui.tsx               Icon、IconButton、Brand、原生 Modal
│     ├─ controls.tsx         Radix 音量滑杆
│     ├─ hooks.ts             减少动态效果、延迟隐藏
│     ├─ page-transitions.ts  页面退场/重进状态
│     ├─ LoginGlassEffect.tsx 库折射、Motion 呼吸与输入保护
│     ├─ ErrorBoundary.tsx    装饰降级、页面错误恢复
│     ├─ LineSidebar.tsx / CollapsibleSidebarLayout.tsx  成员侧栏
│     └─ mount.ts             唯一旧入口 React 挂载/SSR 适配
├─ features/
│  ├─ auth/*.tsx              登录、2FA、申请、激活、管理员审核
│  ├─ music-library/          专辑选择、详情、曲目转换与共享视图
│  ├─ player/                 唯一 Audio 控制器、底栏/展开播放器、歌词、预览快照
│  ├─ queue/                  队列模型、持久化、拖拽/键盘排序、加号飞行动画
│  ├─ search/ user/ upload/   搜索、个人音乐库、上传与元数据解析
│  ├─ settings/               设置与 2FA 面板
│  └─ footprint/              音乐足迹时间轴、卡片、分享与评论
├─ services/
│  ├─ auth/                   Session/2FA 请求、申请与激活接口
│  └─ music/                  网易云、本地搜索、专辑、个人资料、上传、足迹适配
├─ graphics/archive/scene-host.ts
├─ rhine/                     原图形、模型、材质、交互、资源算法
├─ styles/                    原分段 CSS + React 控件/申请/足迹适配
└─ 根目录薄兼容导出
```

不规定单文件行数。简单组件和页面内部状态不机械拆层；图形、请求和音频不放进 JSX 业务闭包。

## 生命周期与稳定接口

| 所有者 | 创建/持有 | 清理边界 |
| --- | --- | --- |
| React root | App、登录和认证会话 | HMR/unmount |
| App | 身份代次、延迟授权计时、在途足迹上报 | 退出、阶段切换、卸载；迟到响应不能提升身份 |
| SessionWorkspace | MusicQueue、唯一 PlayerController/Audio、足迹客户端 | 整个认证会话结束；不随普通切页销毁 |
| Workspace | 当前页面、已访问页面、场景宿主、公开动作 | 工作区卸载；不销毁外部注入的 Audio |
| 各页面 | 表单、筛选、分页、请求序号、AbortController、Object URL | 组件卸载；隐藏与销毁不是同一件事 |
| PlayerView | 音频状态订阅、歌词请求、队列持久化同步、浮层 | 视图卸载取消订阅/请求/监听，不停止应用音频 |
| 场景宿主 | 唯一档案 RAF、resize/visibility、主题订阅 | 隐藏暂停；退出释放含迟到加载的场景 |

### 页面动作

- `MusicActions.play(track)` / `enqueue(track)` 是搜索、用户、专辑、足迹等页面的统一入口。
- 页面不读取 `HTMLAudioElement`，也不访问其他 Features 的内部 DOM。
- ref 只公开必要能力：搜索 focus/refresh/ownsKeyboardTarget；用户 refresh/hasOpenDialog；足迹 hasOpenDialog；库 selectRecord/navigate/openDetail/closeDetail/resetDetail；设置 show/close/open；播放器 play/enqueue/choosePlaylist/setExpanded。
- 退出动画使用 active 与 visible 两个状态：先 inert、开始淡出，再 hidden；重进时清理旧隐藏计时。
- 原生 dialog 的 top layer 和焦点围栏保留；180ms 退场只由所属页面拥有，不在共享 Modal 重复计时。

### 音频与队列

- 同一认证会话只有一个 Audio，唯一创建点 `features/player/player-core.ts`。
- 音乐足迹通过可选 `onPlayed` 接收当前请求的成功开播通知；App 装配上报服务，核心不依赖足迹 API。暂停恢复、失败或迟到请求不重复通知；退出会话取消在途上报。
- `PlayerController.get/subscribe/play/toggle/next/previous/seek/setVolume/clear/destroy` 保持接口。
- URL 解析、歌词与异步曲目竞争保护由原服务和核心负责；不允许在搜索、用户或展开层新建 Audio。
- 队列继续使用原 key、500 首上限、去重/排序/来源规则和紧凑 source/sourceId 持久化。现有 key 格式包括搜索歌曲 `netease:song:<id>`、专辑/歌手 `netease:album:<id>` / `netease:artist:<id>`、个人库 `source:sourceId`、专辑曲目 `netease:<id>` 和本地 `local:<id>`；不能借重构擅自统一。
- Motion 拖拽只改本地 draft，松手提交一次；cancel/Escape/卸载不提交。
- 页面异步操作使用 `AbortController`/`signal`；离页、切视图、卸载时取消请求并隔离迟到响应；Object URL 在下载或卸载后撤销。

### 主题

- 全站颜色唯一配置表为 `frontend/public/theme.css`，包含同名浅色/深色 Design Tokens；`frontend/src/styles/` 不直接写十六进制或 RGB 颜色。
- `frontend/index.html` 在 head 中依次加载 `/theme.css`、同源阻塞且非 async/defer 的 `/theme-init.js`、应用模块；不添加内联脚本，不放宽 CSP。
- 页面只调用 `frontend/src/shared/theme.ts` 的 `getThemeState`、`setThemePreference`、`subscribeTheme`，不直接改播放器或场景内部字段。
- 文档根节点 `data-theme` 表示实际 `light/dark`，`data-theme-preference` 表示 `light/dark/system`。缺省或损坏值使用浅色；用户选择持久化在 `localStorage['omc.theme']`，只存三个短字符串之一。
- 系统主题变化只在偏好为 system 时生效；手动选择不被系统覆盖。`storage` 事件同步同源标签页；清空偏好恢复浅色；禁用存储时当前页面仍可切换，但提示无法保存。
- `theme-init.js` 是文档生命周期唯一控制器，重复加载有守卫；设置视图和图形宿主各自取消订阅。HMR/页面切换不重复创建主题控制器或音频。
- 3D 复用原 `ArchiveScene.setTheme`，只在主题改变时读取 CSS 环境色，不每帧读取样式；设置弹窗暂停场景时只补画一帧。

### 图形与动效

- React 只装配 scene-host，不逐帧 setState；详情视觉量细粒度写自有 CSS 变量。
- Three.js 的相机、材质、波浪、选择和资源释放不由页面 UI 重写。
- Logo/入场 SVG 沿用原图形与采样轨迹；Liquid Glass 只替代被允许替换的登录折射。
- 装饰懒加载失败降级为无特效，不销毁登录表单；编辑、2FA、后台或减少动态效果时暂停装饰。
- Liquid Glass 在非 Chromium 浏览器有库自身兼容限制，不承诺 Safari/Firefox 完全一致。

## 产品、视觉与交互约束

- 视觉语言为工业档案终端：暖白背景、深色文字、细线分隔、克制的暖棕强调、编辑式排版和大面积留白；英文系统标签使用大写和较宽字距，中文功能名保持可读字号；避免常见 SaaS 大圆角卡片、彩色渐变和悬浮阴影堆叠。封面、头像和 GLB/Shader 的固有光学参数不反色、不滤镜处理。
- 登录、2FA 和启动画面不显示播放器；登录后所有业务页面只使用一套播放器，固定在视口底部。显隐遵循现有播放器交互，正文为播放器预留空间；队列入口保留在底部播放器。
- 顶部导航包含音乐库、搜索、上传音乐、音乐足迹、用户和设置入口；窄屏应保留可操作的导航、迷你播放器及歌词/队列入口，并避让系统手势区域，实际布局以现有 CSS 断点为准。桌面保留非对称分栏和固定底栏；平板缩小档案墙层数，详情允许上下分区；手机端 WebGL 不可用或性能不足时评估封面栈/列表降级，降级效果需单独验收。
- 首页以专辑档案墙为核心，不以 CSS 卡片墙替代 Three.js 场景；专辑详情保留左右分栏和曲目/资料页签；搜索使用档案索引布局并显示 `LOCAL` / `NETEASE` 来源；上传页区分文件校验与元数据预览；用户页左侧为歌单、喜爱、最近播放、我的上传，右侧为内容区。
- 本地与网易云分别请求各自 API，只在展示层合并为统一 Track。队列项始终记录具体音源；同一录音的多个来源可归组展示，但无法可靠确认时保持为不同歌曲。
- 播放器切歌不改变播放器位置；动效只用于说明状态变化，支持 `prefers-reduced-motion`，减少动态效果时直接显示最终状态。
- 无障碍：按钮提供文本或 `aria-label`；键盘可完成搜索、切歌、播放/暂停和关闭弹窗；焦点状态不只依赖颜色；封面提供替代文本；空列表、失效音源、上游不可用和会话失效都有清晰状态。
- 前端不保存密码、TOTP 密钥或恢复码，不展示后端堆栈、路径、Session 或上游错误；管理员权限最终由后端校验，不能只靠隐藏按钮。

早期草案中的画质、流量、常驻播放器、播放偏好、改密码、设备管理、缓存等设置仍是占位或禁用项，不是已实现事实。最近播放目前只有页面入口和空状态。以下产品选择仍未确认，不在实现时默认已定：歌单是否支持公开分享/协作/自定义封面；喜爱是否扩展到专辑；最近播放的保留时长和跨设备同步；启动画面每次登录播放还是每 Session 一次；展开播放器是否长期保留歌词区；首页一次展示多少张专辑及排序；无专辑单曲的归类方式。

## 开发方法

### 新增页面

1. 在 `features/<领域>/` 编写 JSX 组件，通过 props 注入服务和 MusicActions。
2. 明确 active/隐藏/卸载行为；异步操作带 AbortController 或代次校验；URL、timer、订阅归属组件。
3. 在 Workspace 登记懒加载、导航、visited 和必要 ref，不从页面反向导入 Workspace。
4. 样式继续使用原 tokens；新图标复用 Icon。补真实组件测试与跨页浏览器流程。

### 新增音乐来源

先单独确认产品与安全范围；在 Shared 扩展中立来源契约，在 Services 写独立适配，由 App 注入 URL resolver。不要合并网易云和本地底层协议。同步验证 key、去重、来源权限、失败/取消和持久化兼容。

### 扩展播放器与设置

核心动作和状态加到 player-core，UI 用 `useSyncExternalStore` 订阅；绝不新建第二个 Audio。队列修改走统一动作，播放进度更新不要导致整个长列表重绘。设置组件放 settings，数据访问放 Services，跨页面效果由 App 注入窄动作；未接入项继续禁用，不借组件迁移启用新功能。

### 新增图形场景

实现与 ArchiveSceneController 类似的显式接口，由宿主负责加载、可见性、resize、RAF 和 dispose。场景只接受视觉输入，不接登录或播放器实例。覆盖加载迟到、共享贴图、重复销毁、隐藏停止和重复挂载。

## 验证边界

- `pnpm test` 覆盖 React 挂载、组件行为和既有业务；`pnpm test:e2e` 在隔离服务上验证真实认证、媒体、指针和队列流程；架构测试检查 TS/TSX 依赖方向与唯一 Audio 创建点。
- 浏览器验收使用低设备像素比、减少动态效果和测试专用低画质配置，不代表默认画质性能、持续动画、拖拽转场或逐像素视觉基准。
- 真实网易云/VIP、真实邮件、真实 HTTPS/反向代理/Redis、Safari/Firefox 音频策略和公网部署仍需单独验收；后端覆盖率不能当作前端覆盖率。

设计参考图保留在 [原设计资源目录](frontend-design/assets/)，用于视觉参考，不代表所有草案都已实现。第三方侧栏来源与授权见 [React Bits 来源说明](../frontend/src/shared/react/react-bits/README.md)。
