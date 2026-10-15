# 前端架构与模块化重构记录

## 阶段 0：2026-10-13 基线审计

- 原分支：`main`；HEAD：`2d7542e1aae33be4905588f98e449ec7bad982bb`。
- 重构分支：`codex/frontend-modular-refactor`。不自动提交、合并或部署。
- 开始时已有暂存修改：`login-glass-motion.ts`、`login-glass-renderer.ts`、`login-glass.ts`、`style.css`、`tests/frontendLoginGlass.test.js`；已有未跟踪的 `docs/frontend-design/`。保留原内容，不覆盖。
- 工作期间观察到外部提交 `05949ea4806ea2ad2a1783282cf835c3da02b1d1`（登录动画），包含上述暂存内容；本次代理没有执行提交或改写历史。重构改动仍未暂存，用户的设计目录仍未修改。
- `pnpm install --frozen-lockfile`、`pnpm build:web` 成功；`pnpm test`：247 项通过、0 失败。
- 基线构建已有 Three.js 551.46 kB 分块警告；这不是本轮新增的问题。
- 阅读依据：根 AGENTS.md、Vite/TypeScript 配置、实际源文件、相关 node:test 测试、技术路线图 13、16、18、20、25 节。路线图部分“尚未实现”描述已落后于实际代码，兼容性以现有实现与测试为准。

### 原始依赖关系

```text
main（入口/身份调度）
├─ entry → authorized → 原参考动画时间轨
├─ login → auth-client / two-factor-panel / login-glass
└─ album-archive（认证后的整个工作区）
   ├─ 专辑目录 / 详情 / 选择
   ├─ Audio / 播放状态 / 歌词 / 队列 / 收藏弹窗
   ├─ search / upload / user / settings（回调通信）
   ├─ personal-library-client / music-search（数据与 URL 适配）
   └─ rhine/scene（延迟加载）
      ├─ 拖动 / 波浪 / 可见性 / 材质 / 后处理 / 画质 / 资源释放
      └─ rhine/data → album-data（需要解除的业务目录依赖）
```

### 实际职责清单

| 原模块 | 实际职责 / 状态与清理 |
|---|---|
| main | Session 恢复、登录、授权、退出调度；延迟跳转缺少统一取消 |
| album-archive | 1003 行，工作区所有权、音频、播放 URL 序号/AbortController、歌词、队列同步、收藏、页面/场景协调、销毁 |
| album-data | 24 张静态专辑；完整专辑曲目请求适配；封面不阻挡模型加载 |
| music-search | 搜索数据模型、本地/网易云适配与过滤、白名单封面、实时播放 URL；无页面 DOM |
| music-queue | 有序队列、key 去重、500 首上限、移动、前后曲目、恢复；仅类型依赖搜索模块 |
| queue-persistence | 紧凑来源引用，串行写入、合并快照、重试、恢复时竞争处理；清理重试定时器 |
| player-lyrics | LRC 解析与二分时间定位、网易云歌词请求、失败为空；无 DOM |
| player-queue-panel | 队列模板、外部关闭、指针拖拽/果冻动画、键盘排序；清理捕获、动画、监听和 RAF |
| queue-add-animation / ui-icons | 共享加号飞行动效、单一图标定义；不拦截点击，销毁粒子/监听 |
| search-page | 原生模板、筛选、异步序号、请求取消；播放与入队回调；无独立音频 |
| user-page | 头像、歌单、喜爱、分页、编辑确认弹窗、请求序号；播放回调；销毁页面监听/弹窗 |
| upload-page / upload-metadata | 本地标签预览、Object URL、表单与上传；取消请求、释放封面 URL；上传完成回调需销毁保护 |
| personal-library-client / upload-client / auth-client | 独立数据服务、Session、CSRF、安全错误；保留各 API 协议与来源边界 |
| settings-dialog / two-factor-panel | 设置预览、真实退出/2FA；弹窗和表单生命周期，不改变播放器偏好 |
| login / entry / authorized / login-motion / rhine-motion | 认证视图、2FA 弹窗、入场参考帧；已发现 entry/authorized 延迟回调需取消 |
| login-glass / renderer / motion | 输入保护、30 FPS、像素预算、透明玻璃及呼吸；独立销毁；本轮保留用户已暂存效果 |
| rhine/scene | 模型、相机、封面贴图、实例、指针、更新/渲染；本身不创建 RAF，外层驱动 |
| archive-loop / archive-drag / motion / archive-play-motion | 循环格位、双轴投影/惯性、波包/弹簧、原频谱算法；无 HTTP/音频实例 |
| appearance / decryption / glass-reveal / internal-optics / theme-* | 原光学材质与解密时序、主题插值；保留公式与参数 |
| archive-lighting / shared-depth / quality-renderer / render-quality | 环境灯光、共享深度、画质尺寸/后处理；PMREM 目标所有权需明确 |
| archive-visibility / instance-updates / render-state | 可见性裁剪、Float32 变更提交、静态渲染复用；不替换为 WebGPU |
| three-resources / asset-url / brand / viewport-layout | 去重 GPU 释放、资源地址、模型标记和布局纯逻辑 |
| style.css | 1254 行；样式覆盖、混合响应式规则、统一图标反馈，拆分必须保持原顺序 |

### 证据与风险

- TypeScript AST 检查未发现静态运行时循环依赖。玻璃 renderer 的反向引用是类型引用，不是运行时循环。
- 有重复 HTML 转义（档案、搜索、用户、队列）；底层队列类型归属不合理。
- 只有 album-archive 创建音乐 Audio；登录/授权无音乐实例。不能把它的销毁绑到单个搜索/用户页。
- 场景没有自主 RAF；档案外层一个场景更新 RAF，队列只在拖动时 RAF，登录玻璃和入场是独立效果。未证实同时存在多个档案渲染循环。
- 场景隐藏/设置/展开播放器时外层停止更新；封面更新会唤醒。没有基准 CPU/GPU 数据，不宣称优化收益。
- Three 材质主题缓存使用 WeakMap，不是无限增长的全局 Store。图标、静态目录是模块常量；用户队列与播放状态目前由工作区闭包持有。
- 场景 load 尚未完成时退出，现有外层条件释放存在窗口；GLTF 原始资源与 PMREM 目标需要明确释放责任。通过测试建立幂等销毁与延迟加载保护后才调整。
- 部分旧测试直接匹配原文件字符串；迁移时改为读取真实新实现或行为验证，不能删掉原行为断言来使测试通过。

## 执行边界

依次建立中立类型/共享工具、播放器核心与 UI、工作区和页面协调、Graphics 输入与生命周期、顺序保真的 CSS。简单页面不机械拆成四层；保留现有原生 DOM、CSS、WebGL 和后端路径。旧入口兼容文件只转出稳定接口，不新增业务逻辑。

## 重构后的架构

```text
main.ts                          初始化、HMR 清理
├─ app/
│  ├─ app-controller.ts           入口、会话恢复、登录/2FA 授权调度
│  ├─ music-workspace.ts          认证后服务与页面装配、键盘协调
│  ├─ navigation.ts               懒挂载、显示/隐藏、过渡与页面销毁
│  └─ workspace-view.ts           工作区壳模板与顶部导航
├─ shared/
│  ├─ music.ts                    中立音乐模型、动作接口、封面校验
│  ├─ html.ts                     HTML 转义
│  ├─ state.ts                    按实例查询/更新/订阅/取消订阅
│  └─ ui/icons.ts                 唯一图标定义（CSS 动效保持原样）
├─ services/
│  ├─ auth/session.ts             Session、CSRF、登录与 2FA API
│  └─ music/
│     ├─ search.ts                搜索、来源适配、播放 URL 解析
│     ├─ albums.ts                网易云专辑曲目适配
│     ├─ personal-library.ts      用户资料、收藏、歌单、队列 API
│     └─ upload.ts                CSRF 与音频上传
├─ features/
│  ├─ auth/                       登录、入口、授权动画、2FA 界面
│  ├─ music-library/
│  │  ├─ album-data.ts            静态专辑目录与预览资料
│  │  ├─ library-controller.ts    专辑选择/详情/视觉状态
│  │  └─ library-view.ts          专辑模板与纯格式化
│  ├─ player/
│  │  ├─ player-core.ts           唯一 Audio、播放动作、状态与销毁
│  │  ├─ player-view.ts           底栏、展开歌词、收藏与队列 UI 协调
│  │  └─ player-markup.ts         原播放器模板
│  ├─ queue/                      model、persistence、panel、add-animation
│  ├─ search/search-page.ts       搜索视图与交互
│  ├─ user/user-page.ts           用户视图与交互
│  ├─ upload/                    上传视图、浏览器标签预览
│  └─ settings/settings-dialog.ts 设置与安全弹窗
├─ graphics/archive/scene-host.ts 场景加载、可见性、唯一 RAF 与销毁
├─ rhine/                        复用原模型、光学、动画、指针、画质实现
├─ styles/                       顺序保真的 12 个 CSS 片段
└─ 旧根目录入口                   临时兼容导出，不承载新业务逻辑
```

### 依赖方向与公开边界

```text
App → Features、Services、Graphics、Shared
Features → Services、Shared，以及明确注入的动作/场景接口
Services → Shared（不读取页面 DOM）
Graphics / rhine → Three.js、图形算法（不引用音乐目录、认证、播放器）
Shared → 通用平台能力（不引用业务模块）
```

- `MusicActions`：`play(item): Promise<void>`、`enqueue(item): void`。搜索/用户/专辑只提交曲目，不访问 Audio。
- `PlayerController`：`get/subscribe/play/toggle/next/previous/setVolume/seek/clear/destroy`。音频错误与时间/音量状态由核心发布；UI 的显隐和动效仍属于视图。
- `PageController`：公开 `element/destroy`，按需提供 `focus/refresh/hasOpenDialog/ownsKeyboardTarget`。协调器不查询用户/搜索页面的私有表单或内部变量。
- `ArchiveSceneController`：`load/setReduced/setMode/select/resize/update/finishDecryption/dispose`，输出选择、导航、封面更新回调。封面 URL 由 App 注入，不请求音乐 API，不控制播放器。
- `MusicQueue` 保持原 key 去重、500 首上限、顺序、恢复、上一首/下一首规则。底层类型现在来自 `shared/music.ts`，不再引用搜索或个人页面模块。
- 播放核心状态通过轻量 `createState` 同步；队列继续保留原模型与持久化控制器，没有创建万能 Event Bus 或全局 Store。
- `SearchItem` 保留为中立 `MusicItem` 的兼容别名，`Track` 表示 `kind: 'song'`；时长继续沿用既有显示字符串，避免改变 API/模板契约。播放入口维持既有调用形态。
- 个人音乐 API、上传 API、网易云搜索/播放地址适配仍各自独立。没有强行合并底层协议，也没有新建只转发一次调用的统一 HTTP 框架。

### 所有权与生命周期

| 所有者 | 创建/保持 | 结束时释放 |
|---|---|---|
| Application 认证会话 | 一个 PlayerController/Audio、一个 MusicQueue | 先销毁工作区，再暂停/清空/卸载音频和订阅 |
| 工作区 | 页面协调器、播放器视图、档案视图、设置、场景宿主 | 清理各视图、页面、键盘、定时器、场景；不销毁注入的 Audio |
| 页面协调器 | 首次进入时懒挂载；普通切换保留页面实例及搜索/上传状态 | 工作区结束时统一 destroy；显示过渡 timer/RAF 可取消 |
| 播放器核心 | 一个 Audio，播放地址序号与 AbortController，音频事件 | clear 取消过期播放；destroy 移除音频事件、状态订阅、src |
| 播放器视图 | 底栏/展开歌词、收藏弹窗、队列 UI/持久化/飞行动效 | 取消订阅、歌词请求、拖动动画、监听、延迟隐藏/提示计时器 |
| 图形宿主 | 一条档案 RAF，resize/visibility 监听，异步场景 | 页面隐藏停止调度；销毁后迟到的场景/GLTF 不能重新创建资源 |
| ArchiveScene | Renderer/Composer、模型、共享贴图、PMREM 环境 | 原 dispose 继续执行；补齐源 GLTF、跳过网格和环境目标释放 |

重挂载工作区时，新播放器视图直接读取已有核心状态，不重新播放、不创建 Audio。普通搜索/上传/用户切换不销毁工作区，更不会销毁应用音频。退出登录则销毁整个认证会话；新的登录会话重新创建自己的核心。

## 分阶段变更记录

每个阶段都执行了对应单元测试与构建，日志位于本次环境的 `/tmp/omc-refactor-*.log`。没有自动提交，阶段不代表已经产生 Git Commit。最终提交前请人工检查 diff；用户原先的登录动画提交不算本次重构检查点。

| 阶段 | 原文件 | 实际新位置/拆分职责 | 公开接口变化 | 对应验证 |
|---|---|---|---|---|
| 1 | music-search 的类型、重复 escapeHtml、ui-icons | shared/music、html、state、ui/icons | 保留旧导出，新增中立 Track/动作与状态接口 | frontendArchitecture、frontendIcons、原搜索/队列测试 |
| 1 | auth-client、music-search、personal-library-client、upload-client | services/auth/session、services/music/* | 旧导出兼容，路径/参数/Cookie/错误协议不变 | 原客户端、认证、安全、上传测试 |
| 2 | album-archive 音频与播放器闭包 | features/player/{player-core,player-view,player-markup} | 新增核心动作/订阅；视图不读 Audio | frontendPlayerCore、frontendPlayer、frontendWorkspace、歌词测试 |
| 2 | music-queue、queue-persistence、player-queue-panel、queue-add-animation | features/queue/* | 旧入口兼容，模型/拖拽/持久化动作不变 | 原队列、持久化、拖拽、动画测试 |
| 3 | main、album-archive 的页面调度与模板 | app/{app-controller,music-workspace,navigation,workspace-view} | 入口为初始化；旧 mountAlbumArchive 兼容自有会话调用 | frontendAppLifecycle、frontendNavigation、frontendWorkspace |
| 3 | album-data、档案选择与详情模板 | features/music-library/*；services/music/albums | 场景/音乐动作注入；原专辑资料与详情协议不变 | frontendAlbumArchive、原专辑曲目测试、浏览器专辑选择/详情 |
| 3 | search/user/upload/login/settings/two-factor/entry/authorized | features 下各领域；上传 metadata 独立 | 页面新增公开 element，用户弹窗/搜索焦点通过接口暴露 | 原页面/2FA 测试、frontendUploadLifecycle、浏览器切换 |
| 4 | album-archive 场景外层协调、rhine/data/scene/resources | graphics/archive/scene-host + 原 rhine 增量修改 | ArchiveScene 新增可选 covers 入参；模型与目录解耦 | frontendSceneHost、frontendGraphicsResources、原图形纯算法测试 |
| 5 | style.css | styles 12 片段 + 原入口顺序导入 | 无类名、优先级、断点和动效参数变化 | frontendStyles 字节哈希、原 UI 断言、浏览器画面检查 |

### 为什么保留部分旧文件

- 根目录薄兼容入口用于既有测试、预览入口及外部导入；内部实现直接引用 canonical 新位置。兼容入口禁止新增业务，待调用者迁完可逐项删除，不能双向互相转出。
- `player-lyrics.ts` 仍保留原纯解析/时间定位与服务函数；没有 DOM 或 Audio 所有权。本轮不为目录整齐机械拆分，后续扩展歌词服务时可独立迁移。
- `login-glass*.ts`、参考动画轨迹保持原位置与效果，保护用户已有动效提交。
- `rhine/scene.ts` 仍集中部分纯图形模拟。已有 drag、visibility、quality、motion、resources 等模块全部复用。本轮先解除业务依赖并修生命周期，没有将高风险光学和模型算法重写成新的体系。
- `player-view.ts` 仍协调收藏弹窗与两个队列视图，但只请求个人音乐服务与核心动作，其他页面无需修改它的内部状态。不是每个模板都强制拆成 View/Controller/Service/Types 四个文件。

## 资源问题与修复依据

| 问题 | 可核查证据 | 本轮处理 |
|---|---|---|
| 入口/授权跳转计时器在销毁后可能回调 | 前端生命周期 RED→GREEN 测试 | 保存 timer、取消回调与 generation 校验 |
| 尚未播放时清空队列遗漏视图更新 | 工作区集成测试 RED→GREEN | 清空队列明确同步 UI，不依赖曲目是否改变 |
| 上传被取消或迟到响应更新已移除 DOM | frontendUploadLifecycle 两种情况 RED→GREEN | 生命周期 signal 检查，避免 finally 操作销毁视图 |
| 退出后收藏读取继续发写请求 | 工作区集成测试 RED→GREEN | disposed 检查，退出后不开始后续收藏提交 |
| 重挂载视图没有立即读取已有歌曲 | 工作区集成测试 RED→GREEN | 初始化读取核心快照，不重新播放 |
| 返回档案时误释放共享专辑封面 | 真实 Three Material/Texture 对象测试 RED→GREEN | appearance 跳过共享 artwork 材质 |
| PMREM RenderTarget、GLTF 原树、跳过网格资源所有权不完整 | 资源释放单测、实际源码路径审查 | 保存并释放环境目标；原 GLTF 与克隆共享贴图分开；释放未使用克隆 |
| 加载期间退出的场景释放窗口 | 异步假场景测试、load/dispose 守卫 | 幂等 dispose、迟到 GLTF 释放、宿主停止 RAF/监听 |

未发现原 scene 自主创建第二条档案 RAF；本轮没有依据宣称消除了“原来存在的多个档案循环”。隐藏页停止档案宿主 RAF，拖动循环仍只在拖动期间存在。没有更换 WebGL/WebGPU、画质、阴影、光学公式或动画参数。

## CSS 保真规则

2026-10-15 补充：新增浅色／深色／跟随系统后，颜色定义统一移入 `frontend/public/theme.css`，初始化脚本位于 `frontend/public/theme-init.js`，公开接口在 `shared/theme.ts`。详见 [主题开发说明](frontend-themes.md)。下述逐字节哈希是模块化重构当时的历史基线；当前测试还原浅色 Token 后对比原 2930 条声明，不再要求新增主题后的原文件字节完全一致。新增页面不得再分散硬编码颜色。

`style.css` 依次导入：tokens-global、login、entry-authorized、archive-shell、player、music-library、search、upload、user、responsive、interaction、settings。跨页面响应式覆盖留在原顺序，不能按目录喜好挪到前面。

展开导入后的 CSS 与任务基线逐字节相同（包含用户的 logo 呼吸效果）：

```text
SHA-256 6548c2afbd00115b8e66940e05d34187fb65d0d4fd790d730624a03eb69fef9e
```

`frontendStyles.test.js` 检查这次纯组织重构的基线。以后有明确授权的 UI 修改时，应审查视觉差异后有意更新基线，而不是绕过测试。

## 测试与验收方式

### 终端命令

```bash
pnpm install --frozen-lockfile
pnpm build:web
pnpm test
pnpm test:coverage
```

新增重点前端纯逻辑覆盖（不代表全前端覆盖）：

```bash
pnpm exec c8 --include='frontend/src/shared/state.ts' \
  --include='frontend/src/features/player/player-core.ts' \
  --include='frontend/src/app/navigation.ts' \
  --include='frontend/src/graphics/archive/scene-host.ts' \
  --temp-directory=/tmp/omc-refactor-core-v8 \
  --reports-dir=/tmp/omc-refactor-core-coverage \
  node --experimental-strip-types --test \
  tests/frontendArchitecture.test.js tests/frontendPlayerCore.test.js \
  tests/frontendNavigation.test.js tests/frontendSceneHost.test.js tests/frontendWorkspace.test.js
```

根 `test:coverage` 的原配置只覆盖后端 `src/**`，不能将其报告当作前端覆盖率。运行测试需要本地临时监听权限；受限环境里的 EPERM 和 pnpm 依赖目录清理失败，应先恢复环境再运行，不记录为功能通过。

### 隔离浏览器夹具

启动 `pnpm dev:web`，访问：

```text
http://127.0.0.1:5173/@fs/Users/kk/open-music-club/tests/fixtures/frontend-refactor.html
```

夹具不被生产入口引用，不创建账号，不写数据库，也不绕过生产认证。使用真实 Three.js 模型与浏览器 Audio，音乐数据/个人音乐 API 为内存 Mock，播放地址为三秒静音 WAV。点击“读取资源计数”记录 Audio 数及当前 renderer.info 的 geometry/texture 数；“重挂载工作区”验证所有权。绝对路径只用于本机开发测试，不属于生产 URL。

### 最终验收记录（2026-10-13）

| 项目 | 结果与范围 |
|---|---|
| frozen-lockfile 安装 | 成功；未改变 manifest 或锁文件、未新增依赖/环境变量 |
| TypeScript + Vite 构建 | 成功；原 Three.js 551.46 kB 分块警告仍存在 |
| pnpm test | 266 项、23 组，266 通过、0 失败（基线 247 项） |
| pnpm test:coverage | 完整复跑 266 通过；后端语句/行 96.54%、分支 88.24%、函数 96.49% |
| 新重点前端核心覆盖 | state、player-core、navigation、scene-host：语句/行 97.02%、分支 91.34%、函数 82.05%；不是全前端覆盖 |
| AST 导入与所有权 | 无新增静态运行时循环；Shared/Services/Graphics 无页面反向依赖；生产音乐 Audio 构造仅在 player-core |
| 样式 | 导入展开后与基线字节哈希相同；不改覆盖顺序、动画或断点 |
| git diff --check | 通过；后端 src、vendor、manifest、锁文件与 Vite/TS 配置无改动 |

终端复跑曾遇到两类环境异常，已保留日志并重试：受限 pnpm 清理依赖目录失败，恢复锁文件依赖后构建/测试通过；一次覆盖率执行中原有队列接口测试出现 `socket hang up / ECONNRESET`，隔离队列覆盖测试通过，再次全量覆盖也通过。没有删改这项后端测试。证据日志为 `/tmp/omc-refactor-final-*.log`、`/tmp/omc-refactor-queue-coverage-retry.log` 和 `/tmp/omc-refactor-core-coverage.log`；临时日志不属于提交文件。

浏览器回归使用本机 IAB 隔离夹具，具体观察如下：

- 24 个模型、原波浪选择与点击第 3 张专辑、详情打开/收回可用；Mock 专辑全部 3 首出现在详情，真实专辑封面材质显示。
- 搜索本地曲目、输入关键词后同时显示 local 与 netease Mock 结果；点击播放，原底栏与展开页均使用一个浏览器 Audio。
- 三秒 WAV 在队列内跨来源切换；音量控件从 62% 改为 61%，样式进度同时更新；三行 Mock LRC 显示，当前歌词定位到第三行。Audio 音量赋值由核心单测验证，不以静音 WAV 证明听感。
- 队列两首歌曲通过真实指针拖动从第一位移动到第二位，状态提示和顺序更新；点击用户页关闭队列且仍切页可用。原果冻动画代码与参数保留，未做逐帧视觉量化。
- 用户、上传、设置页与搜索、音乐库之间可切换；展开/收起播放器可用。隐藏播放器应先通过底部指针或键盘焦点唤出，不能将 locator 对隐藏控件的点击当成真实命中。
- 初始挂载与连续三次重挂载完成后，Audio 构造数都是 **1**，当前场景 geometry/texture 都是 **20 / 39**，已销毁场景计数依次 **0 / 1 / 2 / 3**。加载未完成的瞬时计数不作为稳定结果。
- 切到搜索后，在两次独立 UI 操作之间，当前场景 renderedFrames 保持 **1724**，确认该次隐藏窗口未继续提交档案渲染。没有对整个浏览器进程做长期内存剖析。
- 检查了 1440×900 与 390×844 视口；小视口原布局存在紧凑/缩小显示，本轮未重新设计移动端，也不声称移动端完整体验验收通过。临时视口已重置，测试标签已关闭以释放场景。

### 必须明确的未验证项

- 本轮浏览器没有输入真实账号、TOTP、恢复码，没有直接操作用户数据库；登录、退出、Session/2FA/重放/暴力限制/管理员策略由既有后端测试及新应用调度测试覆盖，不冒充真实账号端到端通过。
- 网易云真实上游、VIP 音源、真实网络播放，以及真实用户上传/下载未做浏览器端实测；上游与数据库流程用 Mock/原后端集成测试，HTTP Range 由既有接口测试覆盖。
- HTTPS、生产代理、防火墙、Cookie 的实际线上部署没有重新验收；本轮未修改配置/协议，原 CSRF/CORS/速率限制/安全响应测试继续运行。夹具不验证公网安全部署。
- CSS 字节保真与截图目视不能代替全浏览器、所有设备的逐像素回归；没有原版/新版自动截图对比基准。
- renderer.info 是当前存活资源计数，不是进程内存、GPU 显存或 CPU 占用。没有性能基准，不声称帧率提升、显存下降或彻底无泄漏。

## 后续开发指导

### 新增页面

1. 在 `features/<领域>/` 实现页面；简单页面可以一个模块，不机械拆四层。
2. 返回公开 `PageController`（根节点和 destroy）；所有监听、AbortController、timer/Object URL 明确归属该页面。
3. 在 App 导航的 `WorkspacePage` 与 pages 工厂中登记，由 App 注入 `MusicActions` 和数据服务。页面不导入工作区控制器，不读取其他页私有 DOM。
4. 在对应 feature 样式中增加规则，核对 responsive/interaction 的覆盖顺序；先写回归测试。

### 新增音乐来源

1. 经产品授权再扩展 `MusicSource` 与相关后端允许的引用协议；本轮没有新增来源。
2. 在 Services 添加独立来源适配器，转换为中立曲目，保留 source/sourceId、封面和来源权限边界。
3. 在 App 注入的 resolveUrl 分派来源；页面与核心不实现各自独立播放器。
4. 为地址失败、切歌取消、紧凑队列恢复、同来源去重增加测试。不要未经迁移决策改 key。

### 扩展播放器

真实音频动作与状态增加到 player-core；UI 通过 subscribe 和动作调用更新。不得在页面、底栏或展开页 new Audio。歌词解析复用现有 player-lyrics；新的请求必须有序号/取消保护。销毁视图取消 UI 订阅，不销毁认证会话的核心。

### 新增设置项

UI 在 `features/settings`；服务访问在 Services，实例装配/跨页面效果由 App 注入明确回调。不要让设置模块直接查询播放器内部 DOM 或控制 scene 内部字段。现有预览项仍是预览，不能借重构擅自启用产品功能。

### 增加 Three.js 场景

实现明确的图形控制接口，由图形宿主拥有渲染调度与异步加载生命周期；只输入几何/封面/视觉状态，不输入登录 Session 或播放器实例。加载完成前被销毁也要释放迟到资源；共享贴图不能随一个视图退出被释放。建立 dispose 幂等测试、隐藏暂停测试与重复挂载资源观察后再接入 App。

### 多 Agent 修改范围与稳定契约

| 工作领域 | 优先修改目录 | 需要协调的边界 |
|---|---|---|
| 搜索/用户/上传/设置 | 各自 features 与对应 styles、tests | PageController、MusicActions、Services 方法；不要改播放器内部 |
| 音频播放 | features/player/player-core、对应测试 | PlayerState、动作签名与单 Audio 所有权 |
| 队列/持久化 | features/queue、services/music/personal-library | key、500 上限、紧凑 source/sourceId、串行保存与恢复 |
| 图形/动效 | graphics、rhine、图形测试 | ArchiveSceneController、封面注入、原动作参数与 dispose |
| API 适配 | services | 后端路径、Cookie/CSRF、来源区分、错误脱敏 |
| 应用装配 | app、main | 认证先于授权；App/工作区/页面/音频所有权 |
| 共用图标/类型 | shared 与对应测试 | 图标同名同实现、Track 模型；不得引入业务反向依赖 |

多人同时开发时先约定文件所有权，不覆盖他人未提交改动；涉及中立模型或公开接口要同步更新调用者与兼容入口。AST 架构测试用于阻止新增运行时循环及 Shared/Services/Graphics 对页面的反向依赖。

### 已知兼容风险与后续独立任务

- 原搜索网易云 key 使用 `netease:song:<id>`，个人/专辑使用 `netease:<id>`。本轮刻意保留，避免改变现有去重和持久化行为。统一 key 需要独立数据/队列迁移与产品验收。
- 已有 UI 源码匹配测试保留并改读新实现；它们不能替代完整行为测试。本轮新增状态、播放竞争、生命周期、工作区和 GPU 释放测试，但尚未覆盖所有前端 UI 分支。
- Three.js 大分块警告在基线已存在。进一步代码分块/纹理预算/帧率调整属于独立性能任务，不能用架构重构为由未经实测改变效果。
- 不自动 Git Add、Commit、合并或部署。建议先审查新增文件（普通 git diff --stat 不显示未跟踪文件），再按职责形成可回滚提交。不要将原本未跟踪的 `docs/frontend-design/` 混入本次提交。

## 需要 Add 的范围

本次全部前端重构文件在 `frontend/src/`；文档只加本文，不加整个 docs 目录。测试文件如下（包含迁移后的原测试与新增测试）：

```bash
git add frontend/src docs/frontend-architecture.md \
  tests/frontendAlbumArchive.test.js tests/frontendIcons.test.js \
  tests/frontendPlayer.test.js tests/frontendPlayerQueue.test.js \
  tests/frontendQueueAnimation.test.js tests/frontendQueuePersistence.test.js \
  tests/frontendSettings.test.js tests/frontendUpload.test.js \
  tests/frontendUploadMetadata.test.js tests/frontendUserPage.test.js \
  tests/frontendAppLifecycle.test.js tests/frontendArchitecture.test.js \
  tests/frontendGraphicsResources.test.js tests/frontendNavigation.test.js \
  tests/frontendPlayerCore.test.js tests/frontendSceneHost.test.js \
  tests/frontendStyles.test.js tests/frontendUploadLifecycle.test.js \
  tests/frontendWorkspace.test.js tests/helpers/frontendSource.js \
  tests/fixtures/frontend-refactor.html
```

先执行 `git status --short` 和 `git diff`，确认期间没有新的用户修改，再按需要分组暂存。上面的命令仅供人工执行，本次代理没有执行。验收后请进行 Git Commit，保持在 `codex/frontend-modular-refactor` 上，不自动合并 main。
