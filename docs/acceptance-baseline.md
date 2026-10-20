# 可复现验收基线与阶段 4 通知

## 2026-10-20：GitHub 检查失败修复

提交 `75cd7b3` 已成功上传。其 Actions 验收失败是因为 checkout 没有初始化
`vendor/api-enhanced` 子模块，导致 9 个后端测试文件无法加载网易云白名单模块。
两个作业现在均递归检出锁定的子模块，并在安装前检查 `module/search.js` 是否存在；
本地首次安装同样需要先执行 `git submodule update --init --recursive`。

工作区通过有版本范围的 overrides 更新已发布补丁的传递依赖，不修改 vendor 源码。
本轮 npm 官方审计结果为 **0 严重、2 高危、5 中危、1 低危**，此前为
2 严重、11 高危、9 中危、1 低危。剩余两项高危截至本轮核查没有官方修复版本：

- `node-forge@1.4.0`：签名校验结构验证不足，见 [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)。当前 vendor 的 `util/crypto.js` 使用其 RSA 加密功能，但包级安全门禁仍会报告此风险。
- `braces@3.0.3`：深度嵌套模式导致栈耗尽，见 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，经 vendor 开发工具链引入。

安全作业继续以 high 为失败门槛；没有增加忽略列表、跳过作业或放宽审计范围。
因此验收作业可以修复通过，依赖安全作业仍会如实失败。后续需要经过单独验证的
依赖替换、上游补丁或正式修复版本，不能把检查全绿或公网可上线作为本轮结果。

本轮在 Node 26.0.0 / pnpm 12.3.4 下执行 `pnpm verify:baseline` 全部通过：
冻结锁文件安装、TypeScript/生产构建、293 项后端测试（0 跳过）、覆盖率和 1 项完整浏览器流程。
后端覆盖率为语句/行 96.85%、分支 88.82%、函数 96.62%；浏览器流程使用隔离测试数据和模拟网易云上游。
这些结果不能替代真实生产网络、邮件和部署环境验收。下面的历史数据保留其原始时间和范围。

## 运行方式

在项目根目录使用 `.node-version` 指定的 Node 26.0.0、`package.json` 指定的 pnpm 12.3.4：

```bash
pnpm verify:baseline
```

顺序执行锁文件安装、前端 TypeScript/生产构建、现有测试、覆盖率、固定版本 Chromium Headless Shell 安装和浏览器验收。任意步骤失败立即返回非零退出码，不用重试掩盖失败。首次安装浏览器需要下载约 100 MB；Linux 新机器先运行 `pnpm install --frozen-lockfile`、`pnpm exec playwright install --with-deps --only-shell chromium` 安装系统库。

单独执行：

```bash
pnpm install --frozen-lockfile
pnpm build:web
pnpm test
pnpm test:coverage
pnpm exec playwright install --only-shell chromium
pnpm test:e2e
pnpm exec playwright show-report artifacts/e2e/report
```

不要在依赖安装重建 `node_modules` 时并行运行构建或测试。本机首次沙箱安装失败曾导致缺失依赖的衍生报错；完整恢复安装后基线通过，这类报错不能算产品回归。

## 保存的证据

- `artifacts/baseline/summary.json`：执行时间、Node/pnpm、平台、Git HEAD/分支、工作区是否有改动、工程代码指纹、锁文件哈希、每步命令、真实退出码和耗时。代码指纹包含未提交的新增工程文件，但不读取 `.env`、数据库、`storage` 或设计草图。
- `artifacts/baseline/*.log`：安装、构建、现有测试、覆盖率、浏览器安装和浏览器运行日志。
- `artifacts/e2e/results.json` 和 `report/index.html`：浏览器结果及步骤；`results/` 保存成功关键截图、失败截图和失败 trace。
- 覆盖率范围是后端 `src/**`，不把它写成整个前端或浏览器代码覆盖率。
- 本轮改动前参考 HEAD：`5d33db3`，273 项现有测试通过。改动后的实测结果与风险见文末记录；提交后应再运行一次，以取得精确的最终提交哈希。

这些运行产物已加入 `.gitignore`。CI 对成功和失败均上传独立测试环境的报告，保留 14 天。不要把数据库、Session、`.env`、真实上传文件或生产浏览器 trace 上传为 CI 产物。测试账号、TOTP 和恢复码全部是临时合成数据；即便如此，trace 仍应只保存在受控验收环境。

## 浏览器流程和证明边界

入口是生产构建的 `frontend/dist`，不是另写的静态演示页。独立测试服务绑定 `127.0.0.1:4317`，端口占用就失败，禁止复用当前开发服务器。SQLite 和音乐存储在系统临时目录，每次启动重新建库，退出时清理；不读取 `.env`，不连接真实 Redis、SMTP、网易云或用户数据库。

`tests/e2e/member-journey.spec.js` 覆盖：

1. 通过真实申请 API 创建记录，验证 CSRF、审批前不能登录、匿名不能审批。
2. 管理员通过真实 API 登录、启用 TOTP 后审批；申请/管理前端目前不存在，所以这部分是 Playwright API 请求，不声称是 UI 点击。
3. 浏览器登录、在设置中绑定 TOTP、拒绝错误密码；保存临时恢复码后退出。
4. 浏览器重新密码登录弹出 2FA，待验证会话无法读取音乐；错误码、重放被拒绝。等待下一真实时间窗再验证正确 TOTP，不关闭重放保护，不修改认证状态。
5. 通过真实上传 API 保存合成 WAV，验证真实 Range 206；通过搜索 UI 将本地、网易云两首歌加入同一队列。
6. 同一个真实 `Audio` 先后播放本地流与模拟 CDN WAV，断言实际播放时间递增、实际 URL 和歌词同步，而不是只检查播放图标。
7. 退出后用一次性恢复码重新登录，浏览器从数据库恢复混合队列；再次使用该恢复码被拒绝。

只有网易云上游被替换：后端通过现有依赖注入提供固定白名单响应，浏览器截取 `e2e.music.126.net` 的封面及音频并提供合成资源。既不改来源标识，也不把本地/网易云 API 合并。其他 API 使用真实后端及权限检查。测试进程不新增生产接口或测试后门。

3D 仍使用生产页面和真实场景，没有用空场景替换。无头浏览器使用软件渲染，CSS 视口保持 1440×1000、设备像素比 0.5；测试驱动只对动态场景模块做包装，调用原场景的 `setQuality`、`setSuperPerformance` 公开接口，采用 50% 渲染比例、关闭阴影/AO/景深、低透射和各向异性。原始类、模型加载、导航/选择和销毁都保留，测试还断言真实 canvas 和画质配置确实生效；应用默认画质和动效没有修改。这个测试专用 profile 不进入生产构建。

原画质及仅降低设备像素比的失败 trace 均出现软件 GPU stall，点击受阻。这里是明确限定的功能验收配置，不是宣称修复原画质性能，也不能当成长时 GPU、像素级视觉或全部模型交互验收。真实 VIP、网易云跨域/网络、Safari/Firefox、真实 HTTPS/反代/Redis、全量上传与个人中心 UI、真实邮件送达仍待验收。

## 阶段 4 邮件通知

新增生产依赖 `nodemailer@10.1.2`，开发依赖 `@playwright/test@1.64.1`，均锁定版本；未修改第三方 vendor 源码。pnpm 对新发布包的等待期例外仅限定审查过的 `nodemailer@10.1.2`，不是全局关闭供应链检查。

默认关闭，不配置邮件也不影响现有操作。需要管理员通过环境变量配置（见 `.env.example`）：

| 变量 | 用途 |
| --- | --- |
| `MAIL_ENABLED` | 仅 `true` 启用，否则默认关闭 |
| `SMTP_HOST` / `SMTP_PORT` | SMTP 主机和端口，默认 465 |
| `SMTP_USER` / `SMTP_PASSWORD` | 同时配置的 SMTP 账号与授权码；不能提交真实值 |
| `MAIL_FROM` | 单个发件邮箱 |
| `MAIL_ADMIN_TO` | 单个管理员通知邮箱，缺省回退 `ADMIN_EMAIL` |

465 使用隐式 TLS，其他端口强制 STARTTLS，保留证书验证。配置有误在启动时明确失败，不默默退回明文 SMTP。连接、问候、空闲、DNS 均限 5 秒，通知总等待限 8 秒；现有 HTTP 请求超时应留出该窗口。参数依据 [Nodemailer 官方 SMTP 文档](https://nodemailer.com/smtp)；浏览器报告组织参考 [Playwright 官方报告文档](https://playwright.dev/docs/test-reporters)。

申请记录先提交，再通知管理员；审批通过时先在事务内创建用户和修改申请状态，事务返回后才通知申请人；拒绝同理。通知抛错、拒收或超时，API 仍返回原来的业务成功响应，后台始终能看到记录。数据库失败、重复申请、重复审批均不发额外邮件。

邮件是纯文本，只含申请编号与操作提示，不发送密码、申请理由、TOTP、恢复码、内部路径。失败日志只含 `mail_delivery_failed`、申请 ID、通知类型与请求 ID，不直接记录 SMTP 错误文本、收件地址或凭据。

当前是有界等待的附加通知，不是持久任务队列：进程退出可能丢通知、没有自动重试、超时不证明收件方完全未收到，SMTP 接受也不等于最终送达。不因通知失败要求用户重新申请。管理员以数据库申请列表为准；持久 outbox/重试另立任务，不在本轮增加复杂基础设施。

测试使用注入传输与 Nodemailer 的 jsonTransport，不发真实邮件。`tests/applications.test.js` 用另一个数据库连接证明通知发生在提交之后，检查通知失败仍可审批/登录、回滚无通知；`tests/mail.test.js` 验证关闭、配置/TLS、模板、拒收、异常、超时和日志脱敏。

## CI 与安全门禁

`.github/workflows/acceptance.yml` 在 push、PR、手动触发时执行；只读仓库权限，不使用生产秘密，不部署。验收作业和依赖安全作业分开，避免把安全风险隐藏在功能通过的结果里。

安全审计必须使用 npm 官方源（本机镜像不提供审计接口）：

```bash
pnpm audit --registry=https://registry.npmjs.org --audit-level=high --json
```

本轮审计发现 **2 个严重、11 个高危、9 个中危、1 个低危，共 23 个漏洞条目**。包括现有 Express 链路的 `proxy-addr`、开发工具链的 `shell-quote`，以及 vendor/工具链的其他依赖；没有把“业务未直接调用”当作豁免依据。新增 Nodemailer/Playwright 未出现在该次漏洞列表。完整审计产物保存在本机与 CI；统计是本次时间点的结果，未来应重新审计。

CI 安全作业会因高危/严重风险返回失败；不使用 `continue-on-error`，不配置漏洞忽略列表。本轮不顺带升级无关依赖或 vendor，依赖修复与生产开放仍是后续阻断项。当前没有推送或触发远程 Actions，因此不能声称 GitHub CI 已运行通过。

## 本轮实测记录

最终统一入口实测时间：**2026-10-17 12:16:09–12:19:08（Asia/Shanghai）**。平台 macOS arm64、Node v26.0.0、pnpm 12.3.4、Chromium 156.0.8078.4。

| 项目 | 实测结果 |
| --- | --- |
| 冻结锁文件安装 | 通过 |
| TypeScript 与 Vite 生产构建 | 通过；原有 Three.js 大分块提示仍在，不声称优化了包体 |
| Node 单元/集成回归 | 283 项全部通过，0 跳过 |
| 后端覆盖率门禁 | 通过；行 96.77%、分支 88.55%、函数 96.61% |
| 邮件模块覆盖率 | 行/函数 100%、分支 92.59% |
| 固定浏览器完整流程 | 1 项通过，0 失败、0 跳过、0 重试；用时约 150 秒 |
| 结果与截图 | `artifacts/baseline/summary.json`、`artifacts/e2e/report/index.html`、`artifacts/e2e/results.json` 和 3 张关键截图，包含浏览器环境附件 |
| 开发服务健康检查 | `/health` 返回 `{"status":"ok"}`；独立 4317 验收服务已退出 |
| 依赖安全 | 未通过：2 严重、11 高危；原始报告另存 `artifacts/baseline/audit.json` |
| 真实 SMTP、GitHub 托管 CI、公网/真实上游 | 未执行，不视作已通过 |

原画质本机 Chrome 也跑通过一次核心流程；固定无头浏览器则需要上文明确的软件渲染测试 profile。固定浏览器下载曾遭官方 CDN 中断，最终从同一 Google 官方源分段续传，核对官方长度 103778487 字节与 MD5 `DlFzouaq+2z7axsdckdo9w==` 后安装同一版本，未换浏览器版本或绕过证书验证；恢复记录另存 `artifacts/baseline/browser-recovery.log`。完整统一入口最终返回 0、`success: true`。

当前结果对应 **main 的 `5d33db3` 基础加本轮未提交代码**，不是声称旧提交本身包含这些功能。工程代码 SHA-256 为 `545b50bb91ebee1f2bfd2517d3f722fe3eb28178b95d6a86f4e09730fd1fcd79`，锁文件 SHA-256 为 `ad22e81466440462a6431975013da2c78c64dc3200695b83468d941ceb073d3a`；完整元数据在 JSON 中。提交后再运行一次可以得到精确提交对应的基线。

## 本轮需要提交的文件

不要使用 `git add .`：原有未跟踪的 `docs/frontend-design/` 没有被修改或包含在本轮清单中。运行产物、真实 `.env`、数据库和音乐文件也不提交。

```bash
git add .env.example .gitignore .node-version README.md \
  package.json pnpm-lock.yaml pnpm-workspace.yaml playwright.config.js \
  .github/workflows/acceptance.yml scripts/acceptance-baseline.js \
  src/app.js src/services/mail.service.js \
  src/routes/applications.routes.js src/routes/adminApplications.routes.js \
  tests/applications.test.js tests/mail.test.js tests/acceptanceBaseline.test.js \
  tests/e2e/fixtures.js tests/e2e/server.js tests/e2e/member-journey.spec.js \
  docs/acceptance-baseline.md open-music-club-technical-roadmap.md
```

本轮没有自动 Commit、推送、部署或触发远程 Actions。建议审阅后 Git Commit 保存，再推送观察两个 CI 作业；安全作业的高危依赖阻断需要另开修复轮次，不能将其忽略后宣称可公网开放。
