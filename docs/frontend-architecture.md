# 前端架构与开发指南

本文描述 `frontend/src` 的现行实现。早期前端设计草案中的概念图、建议色值和未落地提案不是当前事实；仍待确认的产品选择统一列在文末，并同步到技术路线图。

## 技术栈与边界

- TypeScript + React 19 + Vite 7，不引入第二套前端框架。
- Three.js 档案墙、模型、波浪/选择/入场授权轨迹保留原实现，不迁移 WebGPU。
- 普通交互使用 Motion，音量滑杆使用 Radix Slider；登录折射使用 Liquid Glass React，保留原背景和表单。
- API、Cookie、CSRF、Session、TOTP、恢复码、权限、来源分离和数据库协议不变。
- React JSX 拥有页面和按钮的 DOM，状态驱动更新；应用、测试与预览夹具直接挂载生产组件，已移除根目录 shim 和旧挂载/SSR 入口。
- 产品边界：受控成员、公网 HTTPS；只使用一个播放器；网易云音乐与本地音乐在存储、API 和来源标识层保持独立；不接入网易云评论、排行榜、推荐、FM、直播等功能。

## 目录与依赖方向

```text
main.ts → App（顶层路由、邮件凭证入口）
           └─ SessionApp → use-auth-machine（身份阶段与原阶段视图）
                ├─ EntryPage / LoginPage / AuthorizedSequence
                ├─ AdminApplicationsPage（管理员独立入口）
                └─ SessionWorkspace → use-playback-session（认证会话的音频所有者）
                     └─ Workspace（页面、导航、场景、动作装配）
                         ├─ LibraryView
                         ├─ UserPage / UploadPage / FootprintPage（懒加载，访问后保留实例）
                         ├─ GooeySearch → SongSearchPanel → QueuePanel（就地搜索）
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
│  ├─ App.tsx                 顶层路由和邮件凭证入口
│  ├─ SessionApp.tsx          原认证阶段视图和管理员独立入口
│  ├─ SessionWorkspace.tsx    播放会话与 Workspace 装配
│  ├─ Workspace.tsx           客户端、ref、状态与 playerCommands 装配
│  ├─ WorkspaceView.tsx       原工作区 JSX、懒加载页面与共享导航
│  ├─ types.ts                工作区属性、ref 与播放器命令契约
│  ├─ hooks/                  认证状态机、播放会话、工作区导航/visited、档案快捷键和场景生命周期
│  └─ routes.ts               URL 路由和登录返回路径白名单
├─ shared/
│  ├─ music.ts / state.ts     中立 Track/MusicActions 契约、统一回退封面、轻量实例状态
│  ├─ format.ts              秒/毫秒时长展示，各入口保留原边界策略
│  ├─ theme.ts / ui/icons.ts  主题窄接口、唯一图标几何
│  └─ react/
│     ├─ ui.tsx               Icon、IconButton、Brand、原生 Modal
│     ├─ image.ts             图片加载失败回退，避免占位图错误循环
│     ├─ controls.tsx         Radix 音量滑杆
│     ├─ hooks.ts             减少动态效果、延迟隐藏
│     ├─ page-transitions.ts  页面退场/重进状态
│     ├─ LoginGlassEffect.tsx 库折射、Motion 呼吸与输入保护
│     ├─ ErrorBoundary.tsx    装饰降级、页面错误恢复
│     └─ LineSidebar.tsx / CollapsibleSidebarLayout.tsx  成员侧栏
├─ features/
│  ├─ auth/*.tsx              登录、2FA、申请、激活、管理员审核
│  ├─ music-library/          专辑选择、详情、曲目转换与共享视图
│  ├─ player/                 唯一 Audio 控制器、底栏/展开播放器、默认曲目预览
│  ├─ queue/                  队列模型、持久化、拖拽/键盘排序、加号飞行动画
│  ├─ search/ upload/         搜索、上传与元数据解析
│  ├─ user/                   个人音乐库入口、侧栏、歌单详情及创建/删除弹窗
│  │  └─ hooks/              数据刷新与分页、歌单写操作、头像与昵称状态
│  ├─ settings/               设置与 2FA 面板
│  └─ footprint/              音乐足迹时间轴、卡片、分享与评论
├─ services/
│  ├─ auth/                   Session/2FA 请求、申请与激活接口
│  └─ music/                  网易云、本地搜索、专辑、个人资料、上传、足迹适配
├─ graphics/archive/scene-host.ts
├─ rhine/                     原图形、模型、材质、交互、资源算法
├─ styles/                    原分段 CSS + React 控件/申请/足迹适配
├─ player-lyrics.ts           歌词解析和按来源读取
└─ style.css                  分段样式入口
```

`features/**` 与 `app/**` 的组件超过 400 行会产生 ESLint 警告；两处目录下全部 TS/TSX 文件还受递减白名单约束。简单组件和页面内部状态不机械拆层；图形、请求和音频不放进 JSX 业务闭包。

## 工程门禁与格式化

- ESLint 使用根目录 `eslint.config.mjs`，首轮只启用行数警告、分层导入限制和 DOM class 查询限制，不启用 recommended、类型检查或 Hooks 规则。`app` 负责装配各 feature；feature 不反向依赖 app，feature 之间的既有精确引用列在 `tests/fixtures/frontend-import-exceptions.json`，白名单只能缩小。Shared、Services、Graphics 的既有依赖方向也由规则与生产解析图检查。
- `features/**` 与 `app/**` 的 `querySelector`、`querySelectorAll`、`closest`、`matches` 直接字符串或模板查询禁止使用 class 选择器，改用 ref、语义属性或专用 `data-*` 标记。CSS class 仍可用于视觉样式与状态切换。
- `tests/frontendFileSize.test.js` 检查两处目录的全部 `.ts/.tsx`，计入注释与空行，仅排除末尾换行产生的空项。超限白名单在全量格式化后生成；修改超限文件时，实际行数必须等于白名单上限，并同步降低缩小后的上限。文件降到 400 行以内或被删除就移出白名单；新超限文件不能加入，旧上限不能提高。
- 本地递减检查比较 HEAD；CI 在 `pnpm verify:baseline` 前运行 `pnpm lint`，按 PR 基线或推送前提交检查白名单变化，并完整检出历史。首次引入时旧提交没有白名单，之后不得重新生成更宽的白名单。
- 开发使用项目 `.node-version` 指定的 Node 与 pnpm。首次安装后执行 `pnpm hooks:install` 初始化 Husky 提交钩子，后续安装由 prepare 维护；pre-commit 调用 `lint-staged --hide-unstaged`，先格式化允许范围内的暂存文件，再检查前端 lint、文件行数及实际依赖图。未暂存的跟踪文件内容由 lint-staged 隔离，未跟踪文件不进入提交检查；若已暂存代码引用尚未暂存的新模块则失败。文件名经 Git 的 NUL 分隔输出读取，再以 argv 传给工具，不拼接进命令字符串。
- `pnpm format` / `pnpm format:check` 共用 `scripts/format.cjs` 的固定路径清单，只读取 Git 跟踪文件：`src/scripts/tests` 下 JS/CJS/MJS、测试 HTML、`frontend/src` 下 TS/TSX/CSS，以及脚本明确列出的根配置、前端入口/配置、主题文件和两份门禁 JSON。vendor、文档/许可证、资源、锁文件、生成物、环境及运行数据不进入格式化命令。
- 两个例外固定保留：`frontend/src/rhine/motion.ts` 由原 SHA-256 断言锁定，不格式化；格式敏感的源码断言只适配等价空白、引号与数值写法，并在纯格式化前独立提交，不删除断言或更新原算法哈希。格式化 `.pnpmfile.cjs` 时，锁文件中的 `pnpmfileChecksum` 会机械更新，须同时保存以保证冻结安装一致，不改变依赖版本。

## 生命周期与稳定接口

| 所有者 | 创建/持有 | 清理边界 |
| --- | --- | --- |
| React root | App、登录和认证会话 | HMR/unmount |
| SessionApp / use-auth-machine | 身份阶段、角色、身份代次、路由位置和延迟授权计时 | 退出、路由位置变化、卸载；迟到认证响应和旧计时器不能提升身份 |
| SessionWorkspace / use-playback-session | MusicQueue、唯一 PlayerController/Audio、足迹客户端、在途足迹上报 | 整个认证会话结束时中止上报并销毁音频；不随普通切页销毁 |
| Workspace 与其 hooks | 当前页面、已访问页面、场景宿主、公开动作 | 工作区卸载移除键盘监听并销毁场景宿主；不销毁外部注入的 Audio |
| 各页面 | 表单、筛选、分页、请求序号、AbortController、Object URL | 组件卸载；隐藏与销毁不是同一件事 |
| PlayerView 与其 hooks | 音频状态订阅、歌曲切换协调、歌词请求、队列持久化同步、浮层 | 各 hook 清理所属请求/监听/计时器；视图卸载不停止应用音频 |
| UserPage 与其 hooks | 分类/歌单/分页、资料、写操作、弹窗、原队列播放动作 | 卸载作废数据与播放反馈；刷新隔离迟到响应，头像版本与重命名会话分别管理 |
| 场景宿主 | 唯一档案 RAF、resize/visibility、主题订阅 | 隐藏暂停；退出释放含迟到加载的场景 |

- `features/player/PlayerView.tsx` 保留原对外 ref 接口与队列装配入口；按依赖调用 `usePlayerCollection`、`usePlayerVisibility`、`usePlayerQueue`、`usePlayerLikes`、`usePlayerLyrics`。队列及持久化工厂通过能力参数传入 hook，既有跨 feature 精确引用白名单不扩张。
- `CompactPlayer` 与 `ExpandedPlayer` 只呈现状态和转交动作，不持有音频、网络请求或焦点生命周期。可见性 hook 负责展开/收起的焦点归还与重试取消；歌词 hook 负责请求序号、中止和容器内滚动；队列 hook 保留删除/清空、版本快照及串行持久化的原行为。

- `features/user/UserPage.tsx` 保留 `refresh`、`hasOpenDialog` 与管理员审核装配入口；`use-personal-library-data` 负责 lists/tracks/section/pageIndex、过渡和最新请求，`use-playlist-mutations` 负责创建/重命名/删除与互斥状态，`use-profile` 负责昵称、头像校验和上传版本保护。读取与写入通过同一刷新入口协调，不复制数据状态或扩张跨 feature 白名单。
- `UserSidebar`、`PlaylistDetail`、`PlaylistHeader`、`UserTrackRow`、`CreatePlaylistDialog`、`DeletePlaylistDialog` 呈现原有 DOM 与动作；不另建播放器或发起请求。个人页入口及各模块目标为 350 行以内，由行数测试约束；原有最近播放占位行为保留，不新增昵称编辑功能。

- `Workspace` 入口不超过 100 行，统一创建稳定的播放器命令对象（play/enqueue/choosePlaylist/closeQueue/replaceAndPlay/syncLiked），调用时读取当前 PlayerView ref；`WorkspaceView` 沿用原页面 JSX、DOM 标记与懒加载保留策略。`use-workspace-navigation` 统一受控路由与本地导航、visited 和切页清除搜索；`use-archive-keyboard` 保留输入区、设置、入场、展开播放器、业务弹窗及档案详情的原按键优先级，并在卸载时移除监听。
- `use-workspace-scene` 保留原 layout effect 的场景创建/销毁、减少动态效果、播放动效偏好和可见性同步，不改动场景算法。`GooeySearch` 的可选 inputRef 与内部聚焦共用真实输入元素，关闭/卸载由 React 清空；工作区快捷键与搜索面板关闭后的焦点归还通过 ref 定位输入，搜索入口按钮仍使用专用 data 标记回退。

- `App` 顶层入口不超过 80 行，保留 BrowserRouter、重置密码及激活/验证邮件路由和 fragment 凭证即时清除；原认证阶段视图由 `SessionApp` 呈现。`use-auth-machine` 保留 stage/role、身份代次、卸载标记、1150ms 计时器，以及恢复、密码认证、验证完成和退出的原时序，路由位置变化同样作废迟到结果；退出请求失败时保留当前阶段。
- `SessionWorkspace` 只装配 `use-playback-session` 和工作区。播放 hook 在 effect 中创建唯一 Audio 会话、队列及足迹客户端，成功上报后推进足迹版本；卸载中止全部在途上报并销毁播放器，旧响应不能修改下一会话。来源、播放地址和 CSRF 协议保持原样。

- `rhine/scene.ts` 保留场景生命周期、入场预热、公开控制、导航/命中和交互适配，通过组合创建唯一 `ArchiveSceneRuntime` 和 `ArchiveSceneUpdate`，不再继承更新器。控制入口和每帧更新读取同一份分组状态，公开 renderer、相机、回调与 update 接口保持兼容；入口继续受 ≤800 行门禁约束。
- `rhine/scene-state.ts` 通过工厂创建每个实例独立的生命周期、呈现、音频、relay、渲染缓存、导航、选中、交互、计时、入场和回调状态；不依赖 DOM，不创建模型、相机、renderer 或后处理资源，不消耗随机种子。
- `rhine/scene-runtime.ts` 连接状态与资源所有者，持有场景/相机、模型资源、渲染配置、可见性计算、拾取临时对象与监听信号；资源上下文延迟读取当前状态及业务回调；公开回调与自定义 selectionPulse 经入口委托调用，保留普通函数的场景接收者，封面通知读取最新回调。Three.js 场景、相机、裁剪相机、模型、临时 Object3D 和后处理的分配次序保持原样，最终销毁仍由场景入口编排。
- `scene-update.ts` 的 `update()` 按原顺序调度私有方法：环境/呈现、运动、音频波形、relay 抬升、波形闭包、选中抬升、解密、选中/返回卡片、相机、实例矩阵、检查/景深与最终合成。更新器只调度帧计算，通过显式 runtime 读取状态和资源，并通过窄 controls 接口调用导航与悬停等控制；帧上下文只传递原局部值；波形首次采样仍早于本帧相机更新，实例裁剪与矩阵写入仍晚于相机投影及世界矩阵更新，渲染缓存命中仍在最终合成阶段提前返回。公式、常量和运算次序保持原样。
- 场景更新拆分采用固定随机种子/时间/视口的真实模型、材质与后处理画面对照，并比较相机、实例/封面/返回卡片矩阵和关键状态；基线留在隔离测试产物中，不写入业务资源或通过更新基线接受差异。普通业务低画质夹具用于交互回归，不能单独作为材质和画面等价证明。 `tests/e2e/scene-update.spec.js` 使用可选的测试参数 `OMC_SCENE_BASELINE_DIR` 指向原版快照；仅在修改前采集时设置 `OMC_SCENE_CAPTURE_BASELINE=1`，后续对照不更新基线。未指定基线的常规 CI 仍检查真实画面、矩阵有效性和场景状态。

- `rhine/interaction-bindings.ts` 通过显式 `ArchiveInteractionContext` 绑定原指针和滚轮事件，返回取消动作供场景模式切换和销毁使用；监听仍共用场景的 AbortSignal。场景以实时 getter/setter 连接可变状态，业务回调通过闭包读取最新处理器，不传入整个 ArchiveScene 或对私有成员做类型断言。命中测试、投影、轨道换算、渲染更新和最终销毁编排仍在 scene.ts；绑定模块只持有单次绑定的指针、累计滚轮等事件局部状态。
- `rhine/scene-assets.ts` 持有模型、实例、封面和标签资源，并负责模型组装、封面异步更新与实例缓冲扩容；通过显式 context 延迟读取生命周期、renderer、外观配置和选中位置。ArchiveScene 的公开 load 与内部资源访问连接同一 owner，最终销毁顺序保持原样；迟到的 GLTF/源纹理被释放，源树清理保留场景已经引用的共享贴图。
- `rhine/renderer-setup.ts` 负责 renderer、灯光/地面、composer 创建，以及画质切换和尺寸同步；SMAA 实例在 runtime 字段初始化阶段创建，早于 renderer 初始化，保持资源分配顺序。景深通过闭包读取当前 AO，画质切换替换 AO 后仍正确共享深度。ArchiveScene 保留继承的公开 renderer/相机及 update 入口，帧更新委托给独立更新器，生命周期和交互控制仍在场景入口。

### URL 路由

- 使用 React Router 的 BrowserRouter；主页面路径集中在 `app/routes.ts`，目前为 `/library`、`/upload`、`/user`、`/footprint`，后续按功能扩展。用户页内部分类、歌单详情、搜索窗口和设置弹窗暂不独立路由。
- `/` 保留入口，`/login` 提供登录；直接打开主页面时以实时 Session 恢复身份，成功直达目标，失败转登录。登录的 next 参数仅接受登记的业务路径，拒绝外站跳转；登录成功继续原授权动画后返回目标。
- 普通切页与浏览器前进/后退只更新 Workspace 当前页面，不重建 SessionWorkspace、队列或 Audio。Dock 由 Workspace 共享渲染；档案墙入场锁定仅作用于音乐库，非音乐库页面的导航、播放器与键盘返回不等待隐藏场景，返回音乐库再继续其原入场。浏览器整页刷新会重新创建音频，不自动恢复播放进度或绕过浏览器自动播放限制。
- `/reset-password` 是独立邮件重置页面，fragment 凭证仅留组件内存并立即清除，成功不自动登录。登录页的找回弹窗与设置页的改密面板独立，复用 PasswordForm 输入校验和请求生命周期；设置改密成功整页返回 `/login`，销毁原音频会话。
- `/activate`、`/verify-email` 和 `/admin/applications` 保留原用途；激活 token 仅留组件内存并立即清除地址栏 fragment。未知地址显示不存在页面，API 权限仍由后端检查。
- 生产静态入口必须配置页面回退，同时保持 `/api`、缺失静态资源的真实错误响应；具体规则见部署测试方案。

### 页面动作

- `MusicActions.play(track)` / `enqueue(track)` 是搜索、用户、专辑、足迹等页面的统一入口。
- 页面不读取 `HTMLAudioElement`，也不访问其他 Features 的内部 DOM。
- ref 只公开必要能力：用户 refresh/hasOpenDialog；足迹 hasOpenDialog；库 selectRecord/navigate/openDetail/closeDetail/resetDetail；设置 show/close/open；播放器 play/enqueue/choosePlaylist/setExpanded。
- 退出动画使用 active 与 visible 两个状态：先 inert、开始淡出，再 hidden；重进时清理旧隐藏计时。
- 原生 dialog 的 top layer 和焦点围栏保留；180ms 退场只由所属页面拥有，不在共享 Modal 重复计时。

### 音频与队列

- 同一认证会话只有一个 Audio，唯一创建点 `features/player/player-core.ts`。
- 音乐足迹通过可选 `onPlayed` 接收当前请求的成功开播通知；App 装配上报服务，核心不依赖足迹 API。暂停恢复、失败或迟到请求不重复通知；退出会话取消在途上报。
- `PlayerController.get/subscribe/play/toggle/next/previous/seek/setVolume/clear/destroy` 保持接口。
- URL 解析、歌词与异步曲目竞争保护由原服务和核心负责；不允许在搜索、用户或展开层新建 Audio。
- 展开播放器采用封面/控制与歌词双栏，手机端纵向排列；背景仍由独立 `shared/react/ambient/AmbientAlbumBackground.tsx` 以 32×32 离屏 Canvas 提取 3～5 色，使用 CSS 径向渐变、模糊和缓慢 transform 动画。最多两层背景以 1400ms 交叉淡入，快速切歌只保留最新待显示配色，迟到取色结果不会覆盖当前封面。
- 取色按封面 URL 缓存最多 64 项并复用在途计算；失败缓存 60 秒。无封面、加载失败或 CORS 不允许 Canvas 读取时使用预设渐变，不增加后端图片代理；收起、后台标签和减少动态效果时暂停流动，移动端减少色层和模糊范围。浅深主题均使用专用遮罩和高对比文字令牌。
- 展开页爱心复用底栏收藏处理和状态，仍调用原收藏接口；更多按钮暂为禁用的静态展示，不新增请求。
- 完整视图隐藏并 inert 底部迷你播放器；`ExpandedPlayerControls` 只展示同一控制器的状态，提供可键盘/触屏操作的进度、当前/剩余时间、上一首/播放暂停/下一首和音量。收起完整视图后恢复底栏与入口焦点，窄屏可从歌曲信息按钮重新展开；焦点在可见性过渡内有限重试，重开或卸载时取消，不覆盖用户另选的焦点。保持现有顺序播放，不实现循环或随机模式。展开视图音量使用 React Bits `WakeSlider`，复用已有 Motion 并将 0～100 映射到原 0～1 音量回调，主题配色与减少动态效果由站点适配；隐藏时禁用、停止弹簧并释放拖动。迷你播放器继续使用原 Radix `VolumeSlider`，两者共用音量状态。
- 歌词按距当前行的距离渐淡、模糊并过渡，继续复用原时间同步；自动定位按歌词容器坐标计算居中位置并限制首尾范围，只调用该容器的 `scrollTo`，不使用会连带滚动祖先的 `scrollIntoView`。手动滚动通过容器 `overscroll-behavior` 隔离；可点击歌词定位，普通模式平滑跟随，减少动态效果时即时定位。队列仅从按钮打开，复用同一个 `QueuePanel` 作为覆盖式抽屉，保留当前曲目选中、滚动定位、切歌、排序、移除及收藏；Escape 或关闭按钮回到所属视图的队列入口。
- 队列继续使用原 key、500 首上限、去重/排序/来源规则和紧凑 source/sourceId 持久化。现有 key 格式包括搜索歌曲 `netease:song:<id>`、专辑/歌手 `netease:album:<id>` / `netease:artist:<id>`、个人库 `source:sourceId`、专辑曲目 `netease:<id>` 和本地 `local:<id>`；不能借重构擅自统一。
- Motion 拖拽只改本地 draft，松手提交一次；cancel/Escape/卸载不提交。
- 页面异步操作使用 `AbortController`/`signal`；离页、切视图、卸载时取消请求并隔离迟到响应；Object URL 在下载或卸载后撤销。

### 管理员网易云扫码面板

- Workspace 将实时网站角色传给 SettingsDialog；仅管理员显示「账号与安全 → 管理网易云账号」。面板开启后才请求状态，不让普通成员设置页发管理请求；最终权限仍在后端校验。
- NeteaseAccountPanel 持有仅组件内存的二维码图片和短期ticket，成功/过期/错误后停止轮询；使用三秒串行定时器、AbortController和代次隔离。关闭设置或切换分类卸载面板，清理计时器和在途请求，并尽力取消扫码，后端HTTP中断及三分钟TTL兜底，不自行后台轮询。
- services/music/netease-session.ts 只访问固定同源管理接口，主动写入每次获取CSRF，卸载取消仅使用面板已有的CSRF令牌，避免创建新会话干扰退出或重新登录；所有响应不缓存。JSON解析或上游错误统一安全提示；只接收PNG data URI与明确状态，不在URL、localStorage或Session Storage保存ticket/Cookie。
- 扫码身份供全站网易云业务使用；连接、切换和退出不会重建网站会话或唯一Audio。服务器加密持久化和演示用内存模式由后端配置，客户端仅展示；不提供浏览器导出Cookie、修改存储方式或普通成员绑定账号功能。

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
- 外观设置的“播放动效”使用 React Bits Squish Switch（官方 TS/CSS 源码，复用现有 Motion），默认开启；Workspace 保存浏览器 omc:playback-motion 偏好，并通过 scene-host.setAudioEnabled 控制频谱读取。关闭仅停止音乐起伏和采样，保留正常播放、入场及浏览交互；开启仍服从系统减少动态效果。
- 首页音乐响应由 player-core 持有独立 audio-analysis：首次播放手势创建单一 AudioContext/媒体源/分析器，媒体源直接出声，分析分支不连接扬声器；crossOrigin 在 src 前设为 anonymous。切歌复用节点，退出会话关闭；频段数据不进入 React 状态。scene-host 仅在可见、入场完成且未开启减少动态效果时读取，2048 点 FFT、约 30Hz 读取，沿用唯一 RAF，通过 setAudioBands 窄接口传入场景；隐藏/减少动态效果由宿主显式重置包络，恢复后从零渐入，不以采样间隔猜测可见性。
- 音乐位移复用 archive-play-motion 与 motion.approach：32 个对数频段绑定全局槽位，每档读取独立频谱位置，列间错开六段、镜像往返避免边界接缝；80% 自身与 20% 邻域连续插值，最大附加高度 1.9，软压缩峰值，不用预设正弦制造音乐位移；拖动/惯性压低至 20%，详情抽取和归位时渐退，回到浏览再恢复。保留原高度、悬停、拾取和原有波形；同帧缓存高度场，避免重复计算。当前不增加节拍识别、设置项、后端代理或新依赖。远程音源需支持匿名 CORS，否则沿用播放器失败提示，不伪造频谱或绕过鉴权。
- 每次 Workspace 会话挂载时，模型加载及材质/后处理首帧预热完成后，由同一个 scene-host RAF 播放档案阵列入场：阵列波动沿用原 21.9～24.9 秒时间段；镜头改为 32° 斜俯视中远景，沿两秒连续缓动落到交互视角，取消近景急抬头和阵列快速滑入；随后以 1.6 秒统一进度衔接轨道和波形，镜头不再二次切换，不运行原 SVG/授权文字时间轴，也不播放特定档案聚焦、抽取或详情段。页面切换不重播，隐藏标签暂停计时，仅 SVG 页 ENTER SYSTEM 可跳过 SVG，阵列无独立跳过按钮；支持减少动态效果及加载失败降级；入场阶段隔离档案、导航和播放器交互。
- 专辑默认、悬停、选中与详情抽出均维持最初场景的高度，不增加整体或单独的高度偏移；索引、选择及专辑数据流程不变。右侧专辑资料默认隐藏，首次点击三维专辑后展示；初始播放器预览同步和键盘浏览不触发资料自动展示。
- 专辑详情曲目数量旁提供“播放全部”：完整曲目就绪后按专辑顺序替换当前播放队列、停止旧播放并从第一首开播，复用单一音频实例，不创建收藏歌单或显示清空确认。显式替换不合入延迟恢复的旧队列，沿用既有串行保存及 500 首上限。
- Three.js 的相机、材质、波浪、选择和资源释放不由页面 UI 重写。
- Logo/入场 SVG 沿用原图形与采样轨迹；Liquid Glass 只替代被允许替换的登录折射。
- 装饰懒加载失败降级为无特效，不销毁登录表单；编辑、2FA、后台或减少动态效果时暂停装饰。
- Liquid Glass 在非 Chromium 浏览器有库自身兼容限制，不承诺 Safari/Firefox 完全一致。

登录挑战使用 React Bits Code Slots，验证码满 6 位后自动提交既有 TOTP 验证接口；提交期间禁用输入和恢复码切换，成功后保持锁定直到弹窗退出。失败后清空并恢复焦点，支持粘贴与一次性验证码自动填充；恢复码模式保留独立文本输入和手动确认。只调整登录挑战 UI，首次绑定和设置中的 2FA 管理保持原样，不新增运行时依赖。

## 产品、视觉与交互约束

- 视觉语言为工业档案终端：暖白背景、深色文字、细线分隔、克制的暖棕强调、编辑式排版和大面积留白；英文系统标签使用大写和较宽字距，中文功能名保持可读字号；避免常见 SaaS 大圆角卡片、彩色渐变和悬浮阴影堆叠。封面、头像和 GLB/Shader 的固有光学参数不反色、不滤镜处理。
- 登录、2FA 和启动画面不显示播放器；登录后所有业务页面只使用一套播放器，固定在视口底部。显隐遵循现有播放器交互，正文为播放器预留空间；队列入口保留在底部播放器。
- 顶部导航包含音乐库、搜索、上传音乐、音乐足迹、用户和设置入口；窄屏应保留可操作的导航、迷你播放器及歌词/队列入口，并避让系统手势区域，实际布局以现有 CSS 断点为准。桌面保留非对称分栏和固定底栏；平板缩小档案墙层数，详情允许上下分区；手机端 WebGL 不可用或性能不足时评估封面栈/列表降级，降级效果需单独验收。
- 上传页的 01 文件选择和 02 已选文件区域常驻；03 资料与确认上传面板仅在选中/拖入有效音频后显示，复用 `usePageMotion` 的 300ms 淡入/淡出与位移动效。移除文件时立即禁止面板交互，淡出后隐藏；减少动态效果时直接切换。校验与上传反馈位于 02 区域，避免未选文件时提示不可见；上传接口和元数据流程不变。
- 用户页和音乐足迹的右侧内容区直接展示正文，不保留顶部分隔线或标题占位，不显示重复的页面标题、英文介绍、说明或栏目宣传小标题；数量、具体歌单/回忆卡片名称、返回与操作入口保留。页面标题使用读屏专用样式，不占用视觉空间；设置弹窗保持原样。
- 首页以专辑档案墙为核心，不以 CSS 卡片墙替代 Three.js 场景；专辑详情保留左右分栏和曲目/资料页签；搜索使用档案索引布局并显示 `LOCAL` / `NETEASE` 来源；上传页区分文件校验与元数据预览；用户页左侧为歌单、喜爱、最近播放、我的上传，右侧为内容区。
- 歌单总览取消分页，所有歌单在同一区域显示，使用 Aceternity UI 官方 `draggable-card-demo-2` 的散放重叠卡片。源码适配在 `shared/react/aceternity/DraggableCard.tsx`，样式使用现有主题变量与 Motion，不引入 Tailwind。鼠标/触摸拖动限制在歌单区域，拖动后的 click 不打开详情；普通点击及 Enter/空格仍可打开。前三张保留原摆放，后续卡片在区域内随机重叠，刷新/置顶不重新随机；窗口尺寸变化时按相同随机比例重新放置，位置不持久化，新建入口保持独立可见。歌单内歌曲与喜爱的分页保持原样。进入歌单详情和返回列表复用分类切换的 `useSectionTransition`：旧内容先淡出，最新数据就绪后淡入；等待期间内容不可交互，减少动态效果时跳过淡出计时。
- `GET /api/me/playlists` 为当前用户当前页的歌单返回 `coverUrl`，按曲目 `position, id` 取首曲并批量解析，复用本地/网易云各自的数据来源与封面校验。列表不请求整张歌单详情；首曲无封面、已删除、不可用或网易云故障时使用默认图，不寻找后续曲目替代。删除、重排后重新读取列表即更新封面，不存额外封面缓存，不迁移数据库。
- `components.json` 注册 `@aceternity`（`https://ui.aceternity.com/registry/{name}.json`），复用现有 shadcn MCP。官方源码来源为 <https://ui.aceternity.com/registry/draggable-card-demo-2.json>；项目根目录没有独立 tsconfig，CLI 源码安装在隔离目录完成后适配到现有前端。
- Dock 的 Gooey Input 按 Enter 提交统一歌曲搜索，在当前页面复用 QueuePanel 的只读搜索模式展示结果，提供播放、加入歌单和加载更多；旧独立搜索页及其兼容入口、专属样式已删除；浏览与翻页不覆盖真实队列，播放沿用原有自动入队行为。键盘 `/` 同样打开新入口；输入和结果面板内的键盘不驱动三维档案。
- `createSongSearch` 每次查询拥有独立 AbortSignal 和分页游标：歌曲检索、最匹配歌手的歌曲、最匹配专辑的歌曲及本地匹配歌曲按 `source:sourceId` 去重；各云端分页每批 30，专辑/本地曲目缓冲分批展示。来源失败显示提示并保留其他结果，旧查询不能覆盖新查询。
- 后端 `/api/netease/search` 内部使用 vendor cloudsearch，外部参数及登录/限流规则不变；新增 `GET /api/netease/artist/songs?id=&limit=&offset=`，限制正整数 ID、1～100 条分页，固定热门顺序，丢弃 Cookie、proxy 等非白名单参数，复用统一网易云权限及错误脱敏。
- 本地与网易云分别请求各自 API，只在展示层合并为统一 Track。队列项始终记录具体音源；同一录音的多个来源可归组展示，但无法可靠确认时保持为不同歌曲。
- 播放器切歌不改变播放器位置；动效只用于说明状态变化，支持 `prefers-reduced-motion`，减少动态效果时直接显示最终状态。
- 无障碍：按钮提供文本或 `aria-label`；键盘可完成搜索、切歌、播放/暂停和关闭弹窗；焦点状态不只依赖颜色；封面提供替代文本；空列表、失效音源、上游不可用和会话失效都有清晰状态。
- 前端不保存密码、TOTP 密钥或恢复码，不展示后端堆栈、路径、Session 或上游错误；管理员权限最终由后端校验，不能只靠隐藏按钮。

早期草案中的画质、流量、常驻播放器、播放偏好、设备管理、缓存等设置仍是占位或禁用项，不是已实现事实。最近播放目前只有页面入口和空状态。以下产品选择仍未确认，不在实现时默认已定：歌单是否支持公开分享/协作/自定义封面；喜爱是否扩展到专辑；最近播放的保留时长和跨设备同步；启动画面每次登录播放还是每 Session 一次；展开播放器是否长期保留歌词区；首页一次展示多少张专辑及排序；无专辑单曲的归类方式。

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

- `pnpm test` 覆盖真实 React 组件挂载、组件行为和既有业务；`pnpm test:e2e` 在隔离服务上验证真实认证、媒体、指针和队列流程；架构测试检查 TS/TSX 依赖方向、唯一 Audio 创建点，以及包含类型引用和懒加载的生产入口可达性。
- 前端 DOM 测试使用 frontend 的直接开发依赖 `jsdom@24.1.3`，与 React 一样通过 `frontend/package.json` 的解析上下文加载。测试所需依赖由 frontend 明确声明，不再借用 vendor 的安装结构；jsdom 不参与生产前端打包。
- 样式测试保留 CSS 文件及入口导入的解析、关键交互规则检查；构建使用 `pnpm build:web`，不再按 SHA-256 或声明数锁定样式内容。
- 浏览器验收使用低设备像素比、减少动态效果和测试专用低画质配置，不代表默认画质性能、持续动画、拖拽转场或逐像素视觉基准。
- 真实网易云/VIP、真实邮件、真实 HTTPS/反向代理/Redis、Safari/Firefox 音频策略和公网部署仍需单独验收；后端覆盖率不能当作前端覆盖率。

设计参考图保留在 [原设计资源目录](frontend-design/assets/)，用于视觉参考，不代表所有草案都已实现。第三方侧栏来源与授权见 [React Bits 来源说明](../frontend/src/shared/react/react-bits/README.md)。
