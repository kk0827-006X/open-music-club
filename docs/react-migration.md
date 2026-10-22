# React 迁移执行记录

## 范围和验收契约

- 用户批准：仅将现有 TypeScript/Vite 前端迁为 React 可复用组件；保留视觉、数据、认证、2FA、队列与播放器行为。
- 特殊效果：Three.js 档案墙、波浪交互、入场授权采样轨迹保留原实现；普通组件/交互使用 React、Motion 与成熟无样式控件。登录玻璃允许采用现成 React 库，但不搬入演示背景。
- 不做：后端协议改动、数据库迁移、产品功能增加、React 之外的第二框架、WebGPU、自动提交/推送/合并/部署。
- 基线：`main` / `7c38c6ef40728054199651e68d9b5ca2682e72b0`；集成分支：`codex/react-migration`。
- 开工前用户修改：`AGENTS.md`、未跟踪 `docs/frontend-design/`。本任务不覆盖或混入提交。

## 分工与隔离

| 执行者 | 工作范围 | 分支与工作树 | 状态 |
| --- | --- | --- | --- |
| 主 Agent | 共享组件、应用入口、生命周期、依赖/锁文件、集成审查和集中验收 | `codex/react-migration`，原目录 | 代码已整合，终验见下 |
| Codex 认证执行者 | 登录、TOTP、设置、入口/授权 JSX | `codex/react-auth`，隔离临时工作树 | 已整合 |
| dsh 页面执行者 | 搜索、用户、上传 React 组件 | `codex/react-pages`，隔离临时工作树 | 已整合 |
| dsh 播放器执行者 | 底栏/展开播放器、队列、专辑视图及对应 React 测试 | `codex/react-player`，隔离临时工作树 | 已整合 |
| Codex 测试执行者 | React 测试环境、应用/工作区生命周期 | `codex/react-tests`，隔离临时工作树 | 已整合 |
| Codex 只读审计 | 旧测试和 API/DOM 契约审查 | 不写文件 | 已完成 |

dsh 通过已安装的 `0.2.1-rc.2` headless 入口调用，沿用现有模型路由；不使用 agy。用户单独批准必要脱敏私有前端源码发送给 dsh 现有模型服务及现有账号调用费用。禁止发送 `.env`、真实凭据、数据库、Session、2FA 密钥/恢复码、上传文件。执行配置关闭终端、网络工具、插件管理和子 Agent，仅开放工作树源码文件工具。注意其文件策略约束写入，不宣称这是全面的宿主读取隔离；执行任务同时明确禁止工作树以外读取。

## 时间线（2026-10-22）

1. **dsh 连通性**：空目录纯文本任务返回 `DSH_READY`，退出码 0。
2. **dsh 读写边界**：读取合成 `value=21`，输出 `{"value":42}`；对工作区外合成 guard 的一次修改遭 `workspace-write` 拒绝。主 Agent 读取真实产物确认正确且 guard 未变。所有合成文件和空测试目录均已删除，包括原目录内 guard。
3. **分支与原改动**：创建集成及三个执行分支/工作树，均基于上述同一 HEAD，无提交。
4. **基线环境**：Node `v26.0.0`、pnpm `12.3.4`。沙箱下首次构建/测试触发 pnpm 依赖目录清理失败；以正常本机权限运行 frozen install 恢复后再次验证，不改锁文件绕过错误。
5. **基线结果**：`pnpm install --frozen-lockfile` 成功；`pnpm build:web` 成功；`pnpm test` **296 通过、0 失败、0 跳过**。Three.js 551.46 kB 分块警告在基线已存在。
6. **权限变化**：首次私有源码 dsh 任务被安全审核拦截，未绕过；用户异步明确批准必要脱敏前端源码外发后，启动两个独立 dsh 任务。认证任务留在当前 Codex 环境，避免重复工作。
7. **组件路线**：不在 React useEffect 内调用旧页面 mount 作为终态；JSX 拥有视图，原 services/播放器核心/队列模型/图形算法保持框架独立。稳定 class、data selector、主题 tokens 及原响应式规则作为兼容契约。
8. **首轮静态审查**：发现并安排修复页面立即 hidden 吞掉淡出、队列拖动中提前清状态、长队列缺边缘滚动；修复共享弹窗重复180ms关窗及重开竞态，给装饰玻璃和懒加载页面加入错误边界。尚未以静态审查冒充浏览器通过。
9. **依赖策略**：查询官方元数据后采用 React/ReactDOM `19.3.1`、兼容 Vite 7 的 React 插件 `5.2.0`、Radix Slider `1.6.1`、Liquid Glass React `1.1.1`、tsx `4.23.15`。Motion 改用已发布超过一周的 `14.2.0`，撤销 pnpm 自动添加的当日版本冷却例外；旧锁验证拒绝当日版本后，从本轮原锁基线重新解析，未放松安全门槛。

临时基线日志：`/private/tmp/omc-react-baseline-{build,test}.log`。执行任务事件日志和临时工作树不作为提交文件；任务最终交付时按实际结果补充验证记录和准确 add 清单。

## 集中验收清单（恢复前检查点，最终结果见文末）

- [ ] React JSX 生产入口、所有业务页面、共享图标/控件实际接入，无双套 UI 或重复 Audio。
- [ ] 安装/TypeScript/构建、全量已有测试、React 生命周期与交互新增测试。
- [ ] 架构检查覆盖 `.ts` 和 `.tsx`；无新增运行时循环、Services/Graphics 反向依赖。
- [ ] 真实隔离浏览器流程：申请审批→登录→绑定和挑战 2FA→混合队列→真实合成音频→歌词→重新登录恢复。
- [ ] 专辑详情、搜索筛选、个人歌单/喜爱/头像、上传元数据、主题跟随系统和退出。
- [ ] 默认动效与减少动态效果、桌面/窄屏检查；记录视觉差异而不声称未测的逐像素一致。
- [ ] 连续切页/重复挂载，单一播放器、场景隐藏停止、资源/订阅释放。
- [ ] 新依赖安全审计；高危不得静默忽略。

性能只报告真实测量；现有低画质软件 WebGL E2E 不代表默认画质帧率或 GPU 长时验收。真实网易云/VIP、生产 HTTPS/SMTP、真实用户数据不会在本任务中冒充已验证。

## 历史暂停检查点（2026-10-22，用户因额度不足要求暂停）

**任务未完成，迁移后的构建、测试、浏览器验收均未执行，不能把当前分支视为可合并版本。** 不自动提交。所有执行 Agent 已完成当前回合；主 Agent 已核查本次 dsh 和 audit 无存活进程，不会继续后台模型调用。只有迁移前基线的 296 项测试通过。

### 已在集成目录保存

- React/Vite JSX、依赖与锁文件，入口 `main.ts`、`app/App.tsx`、`app/Workspace.tsx`。
- 认证/设置 JSX 和旧入口薄适配；搜索、用户、上传首批 JSX。
- 播放器、队列、档案 JSX；Radix 音量控件、Motion 共享加号飞行动画。
- 图标、Modal、主题/动效 hooks、装饰玻璃错误边界；页面退场延迟 hidden。
- 认证相关测试改写、TSX 架构扫描和新增 React 测试助手/行为测试。
- 主 Agent 最近抽出 `tracks.ts`、播放器预览类型和无音频 SSR 状态；库/播放器/工作区的旧入口正在收敛为 SSR/React 适配，**这部分刚写完还没有类型检查，恢复时先审阅，不假设正确。**

### 已交付、尚未集成的执行结果

1. 页面执行树最后一轮：`SearchPage.tsx` 的 fetcher 注入/纯详情、`UserPage.tsx` 的共享 `PlaylistHeader`/`UserTrackRow`，以及搜索/用户/上传旧 `.ts` 薄适配；`frontendUserPage`、`frontendUpload`、`frontendUploadLifecycle` 测试改写。
2. 测试执行树最后一轮：`tests/frontendLoginGlass.test.js`，用真实 React 装饰/输入保护测试替代已不再使用的自造 WebGL 内部算法测试。

为防临时目录被系统清理，上述未集成成果已经额外备份到仓库内被忽略的 **`artifacts/react-migration-checkpoint-2026-10-22/`**：`pages-tracked.patch`、完整页面 TSX、`login-glass-test.patch`、测试文件、执行报告及基线日志。备份不包含凭据或真实用户数据，不应 git add。恢复时先 diff/审查再应用，不要用副本覆盖主 Agent 之后的修改。

### 明日恢复顺序

1. 读取本文件、AGENTS 和真实 Git 状态，确认仍在 `codex/react-migration`。HEAD 仍为 `7c38c6e`，未自动产生任何提交；用户原来的 `AGENTS.md` 和 `docs/frontend-design/` 仍保留。
2. 集成上述已备份的页面/玻璃测试成果。不要重新派发已经完成的整组任务。
3. 完成剩余去重：旧 `features/queue/panel.ts`、`add-animation.ts`、旧登录玻璃文件和对应源码匹配测试仍需审查；不要删除必要的纯逻辑/安全断言。`features/player/player-markup.ts` 的 SSR 兼容和 `app/app-controller.ts` 新接口也需核对旧调用者。
4. 完成源码测试映射与老测试迁移（特别是旧 App DI、Workspace、队列拖拽/持久化/飞行动画和 CSS 2930 条原声明基线）；当前不能只改映射就声称真实 React 已受测。
5. 集中执行类型检查/构建、新旧单测、原隔离 E2E；批量修复后复测。不连接真实数据库/账号，不改后端协议。
6. 安全审计重试需显式使用 npm 官方 registry：本轮 `pnpm audit --prod --json` 因当前 `registry.npmmirror.com` 不实现 audit endpoint 而失败，**没有得到审计通过结论**。不要改全局 registry 或放宽安全策略。
7. 最后进行默认动效/拖拽/暗色/页面切换及资源验收，补结果与准确 add 清单，再提醒用户 Commit；不自动提交或合并 main。

### 已知待核查风险

- Three.js 与授权轨迹保留原实现，但新 React 装配尚未做浏览器回归。
- 队列 Motion 自带滚动与原边缘滚动可能叠加，需真实长队列检查；拖动取消、快速松手和 click 抑制也需验收。
- 主 Agent 已将队列列表 memo、稳定快照及低频回调隔离，并将自动滚动帧订阅改为只在拖动时挂载；尚无性能实测，不宣称性能提升。
- 主 Agent 已改 Modal 避免双重关窗计时、补 lazy 失败降级和输入/后台/2FA 暂停玻璃，但均待集中测试。
- 当前工作区是进行中的迁移代码，可能存在 TS/测试问题；不要在未验收时部署。

## 恢复后的最终交付（2026-10-22）

### 任务状态

| 本轮任务 | 状态与证据 |
| --- | --- |
| React 生产入口、可复用 JSX 页面与共享控件 | 已完成；main → App → Workspace，旧入口只挂载/SSR 同一组件 |
| 认证、2FA、设置与退出 | 已完成；继续原服务协议，浏览器真实隔离账号流程通过 |
| 搜索、用户、上传、专辑与播放器/队列 | 已完成；数据/引擎与 React 分离，单一 Audio |
| 原档案墙/模型/授权轨迹与样式契约 | 已保留；原图形算法测试和 2930 条 CSS 声明哈希通过 |
| 集成与修复 | 主 Agent 完成；未在 main 修改，未自动提交/推送/合并 |
| 构建、单元/集成、覆盖率与浏览器 | 已完成，结果如下 |
| 私有真实账号、VIP/真实网易云、SMTP、公网部署、全浏览器与长期性能 | 未执行，不属于本轮已验证结论 |
| 用户目视确认整体效果 | 待用户验收 |

用户明确恢复后接回暂停成果；dsh 继续在 player 独立工作树补四组 React 测试，Codex 测试执行者在 tests 工作树补 App/Workspace 生命周期；只读审查执行者完成两轮复核。主 Agent 审阅后实际将成果应用到集成目录，批量修复、集中终端测试和浏览器验收。执行树无自动提交，不能把它们称为已合并的 Git 提交。

### 验收报告

| 检查 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；未改变供应链冷却策略 |
| `pnpm build:web` | TypeScript 与 Vite 通过；保留大分块警告 |
| `pnpm test` | **315 通过，0 失败/跳过**（基线 296）；真实 React 挂载，不伪造原模板受测 |
| `pnpm test:coverage` | 通过；原后端目录口径 lines/statements 96.85%、functions 96.62%、branches 88.82%，不是前端覆盖率 |
| `pnpm test:e2e` | **5 通过，0 失败/跳过/重试**；最后完整运行约 2.4 分钟 |
| `git diff --check` | 通过 |
| AST 依赖与 Audio 所有权 | 通过；TS/TSX 无新增运行时循环，唯一 Audio 创建点仍在 player-core |
| 最终只读审查 | 未发现新的高置信阻断问题；审查报告不替代主 Agent 实测 |
| `pnpm audit --registry=https://registry.npmjs.org` | 审计执行成功但退出非零：0 high/critical，4 moderate、1 low，见下文 |

五项浏览器流程：

1. 申请/审批 → 密码登录 → 2FA 绑定、挑战、错码、重放 → 本地真实上传和 Range → 两来源单一真实 Audio → 歌词 → 恢复码重新登录与数据库恢复队列。
2. 三轮多页切换、清空/外部点击不锁页面、Radix 真实音量、主题切换不重建 Audio。
3. Motion 实际指针跨行、松手才保存、取消不保存、键盘排序及长队列边缘滚动。
4. 三轮退出重进，旧 Audio 清除 src/暂停、旧场景释放、当前仅一个活动场景，隐藏页观察窗口不继续更新。
5. 默认动效下加号飞行完成并清理、播放器底部上推、页面淡出/淡入、800×900 窄屏、登录玻璃与密码眼睛。

修复过程中遇到的失败均已记录并复测：测试 TSX 未使用前端 JSX 配置；原生 dialog 关闭仍保留 DOM 与旧 null 断言冲突；JSDOM 缺少 NodeList/ResizeObserver；加号测试错误地等点击任务结束才入队；Motion 卸载留一个尾帧；新增 Mock 本地列表漏 success、主题按钮标签与原设计不同。没有降低后端安全门槛、删除失败用例或强制点击隐藏按钮来通过。一次原安全测试得到意外 401，后续全量测试与 coverage 均通过，没有修改这项后端测试；保留为一次未再现的观察。

### 性能、资源与体积

- 三轮同一测试阶段的 geometry/texture 均 **19/5**；每轮只一个 live scene；切到搜索后的 300ms 观察窗口新增 scene update 都是 **0**。旧场景 dispose 和旧音频释放被验证。
- 数字来自低画质、按需绘图的测试配置，封面尚未完整 GPU 预热；不代表全纹理常驻资源、GPU 显存、长期堆内存或默认画质 FPS。没有据此声称彻底无泄漏。
- 删除重复边缘滚动器；取消使用 Motion cancel 而非会派发迟到 onDragEnd 的 stop。队列快照/memo 避免跟随每次 timeupdate 重绘；这些是结构和行为核查，不是 CPU 提升百分比。
- React 与交互库有体积成本：入口 JS gzip **49.22 → 138.85 kB**；所有 JS 分块 gzip 总和 **346.22 → 514.77 kB**。不能宣称迁移让下载更小或性能提升。
- 旧 Three 为 scene 208.97 kB + shared three 551.46 kB，新构建合为 scene 758.85 kB；分块名称改变不等于图形算法被重写。超过 500 kB 的警告仍在，未抬高阈值掩盖。
- 原 CSS 不重排，新增 React 控件适配层；玻璃是用户批准的库替代，其他页面不主动重新设计。截图已目视检查，但没有全页面逐像素前后自动基准。

### 安全审计与未消除风险

`ip-address@10.7.0` 两个中风险（GHSA-j6r3-76f7-8jcv、GHSA-h3mg-xc3c-68pw），`music-metadata@11.15.0` 两个中风险（GHSA-f94x-6692-553q、GHSA-5gfj-9q3v-qfp3），`diff@7.0.0` 一个低风险（GHSA-73rr-hh4g-fpgx）。这些版本均已存在于本轮 HEAD 锁文件，不是新增 React 依赖引入。需要单独安排依赖修复和上传安全回归，本轮不擅自升级后端解析器或改协议。

没有新增环境变量；后端 src、权限、Cookie/CSRF/CORS、HTTPS/代理、速率限制、上传/Range 与 Session 安全协议无代码改动，其原有测试继续通过。迁移页面不保存密码、TOTP、恢复码到持久存储，不打印这些信息；输出使用 React 转义，封面仍通过原白名单校验。未部署到生产。

### 交付与重现

- 当前分支 `codex/react-migration`，HEAD 仍为 `7c38c6e`；所有迁移改动尚未暂存/提交。
- 架构、接口稳定性与后续 Agent 分工见 [前端架构](frontend-architecture.md)。
- 结果副本在忽略目录 `artifacts/react-migration-final/`（安装、构建、测试、覆盖率、审计、完整浏览器 JSON/执行报告）；浏览器截图/报告在 `artifacts/e2e/`。不提交这些产物。
- 临时执行树保留，已有暂停备份不删除；没有仍在后台调用模型的执行任务。
- 前端开发仍用 `pnpm dev:web`，完整开发用 `pnpm dev`；端口仍为 5173，后端为既有 3000，不新增生产暴露。

### 本次准确 git add 清单

共 77 个路径，包含 3 个旧玻璃文件的删除。只执行本清单，不包含用户原有 `AGENTS.md`、`docs/frontend-design/`、环境文件或测试产物。暂存前再核对是否有用户后来增加的改动。

```bash
git add -- \
  docs/frontend-architecture.md \
  docs/react-migration.md \
  frontend/package.json \
  frontend/src/app/App.tsx \
  frontend/src/app/Workspace.tsx \
  frontend/src/app/app-controller.ts \
  frontend/src/app/music-workspace.ts \
  frontend/src/app/workspace-view.ts \
  frontend/src/features/auth/AuthorizedSequence.tsx \
  frontend/src/features/auth/EntryPage.tsx \
  frontend/src/features/auth/LoginPage.tsx \
  frontend/src/features/auth/TwoFactorPanel.tsx \
  frontend/src/features/auth/authorized-sequence.ts \
  frontend/src/features/auth/entry-page.ts \
  frontend/src/features/auth/login-page.ts \
  frontend/src/features/auth/two-factor-panel.ts \
  frontend/src/features/music-library/LibraryView.tsx \
  frontend/src/features/music-library/library-controller.ts \
  frontend/src/features/music-library/library-view.ts \
  frontend/src/features/music-library/tracks.ts \
  frontend/src/features/player/PlayerView.tsx \
  frontend/src/features/player/player-markup.ts \
  frontend/src/features/player/player-view.ts \
  frontend/src/features/player/preview-state.ts \
  frontend/src/features/player/types.ts \
  frontend/src/features/queue/QueueAddFlights.tsx \
  frontend/src/features/queue/QueuePanel.tsx \
  frontend/src/features/queue/add-animation.ts \
  frontend/src/features/queue/panel.ts \
  frontend/src/features/search/SearchPage.tsx \
  frontend/src/features/search/search-page.ts \
  frontend/src/features/settings/SettingsDialog.tsx \
  frontend/src/features/settings/settings-dialog.ts \
  frontend/src/features/upload/UploadPage.tsx \
  frontend/src/features/upload/upload-page.ts \
  frontend/src/features/user/UserPage.tsx \
  frontend/src/features/user/user-page.ts \
  frontend/src/login-glass-motion.ts \
  frontend/src/login-glass-renderer.ts \
  frontend/src/login-glass.ts \
  frontend/src/main.ts \
  frontend/src/shared/react/ErrorBoundary.tsx \
  frontend/src/shared/react/LoginGlassEffect.tsx \
  frontend/src/shared/react/controls.tsx \
  frontend/src/shared/react/hooks.ts \
  frontend/src/shared/react/mount.ts \
  frontend/src/shared/react/ui.tsx \
  frontend/src/shared/ui/icons.ts \
  frontend/src/style.css \
  frontend/src/styles/react-components.css \
  frontend/tsconfig.json \
  frontend/vite.config.ts \
  package.json \
  pnpm-lock.yaml \
  tests/e2e/react-migration.spec.js \
  tests/frontendAlbumArchive.test.js \
  tests/frontendAppLifecycle.test.js \
  tests/frontendArchitecture.test.js \
  tests/frontendIcons.test.js \
  tests/frontendLogin.test.js \
  tests/frontendLoginDialog.test.js \
  tests/frontendLoginGlass.test.js \
  tests/frontendPlayer.test.js \
  tests/frontendPlayerQueue.test.js \
  tests/frontendQueueAnimation.test.js \
  tests/frontendQueuePersistence.test.js \
  tests/frontendReact.test.js \
  tests/frontendSettings.test.js \
  tests/frontendStyles.test.js \
  tests/frontendTheme.test.js \
  tests/frontendUpload.test.js \
  tests/frontendUploadLifecycle.test.js \
  tests/frontendUploadMetadata.test.js \
  tests/frontendUserPage.test.js \
  tests/frontendWorkspace.test.js \
  tests/helpers/frontendSource.js \
  tests/helpers/reactHarness.js
```

完成验收后建议用户进行一次 Git Commit；本任务未自动执行任何 add、commit、push 或合并 main。

