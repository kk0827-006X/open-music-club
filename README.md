# Open Music Club

Open Music Club 是面向受控成员、部署在公网 HTTPS 环境中的音乐共享与播放项目。成员需提交访问申请并经管理员审核，不开放自由注册。

项目包含两类音乐来源，在存储、数据库实体、API 命名空间和来源标识上保持独立：

- 网易云接口音乐：通过 `vendor/api-enhanced` 白名单访问 `/api/netease/*`。
- 用户上传的本地音乐：SQLite 元数据 + `storage/` 文件，经受保护的 `/api/local/*` 播放和下载。

前端只使用统一 Track、一个播放队列和一个 Audio，不把两类源数据混存。网易云接入不提供网易云评论、排行榜、推荐、FM、直播等扩展功能，也不以绕过版权或 VIP 限制为目标；网易云解灰默认关闭。

## 技术栈

- 后端：Node.js 26.13.0 LTS（`.node-version`）、Express 5、SQLite（better-sqlite3）；生产环境另需 Redis。
- 前端：TypeScript + React 19 + Vite 7；Three.js 档案墙、Motion、Radix Slider。
- 认证：邮箱密码、Session、TOTP 2FA、一次性恢复码、设置改密和邮件找回密码；管理员在公网开放前必须启用 2FA。
- 包管理：pnpm 12.3.4（`package.json` 的 `packageManager` 锁定）；不要用 npm 或 yarn 修改依赖。

## 本地运行

开发、CI 和未来生产后端统一使用 `.node-version` 中的精确 Node 版本及 `packageManager` 中的 pnpm 版本。先安装对应工具，并初始化子模块：

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm db:init
pnpm dev
```

- 前端开发地址为 `http://127.0.0.1:5173/`，API 默认监听 `http://127.0.0.1:3000`。
- 首次使用从 `.env.example` 复制为受保护的 `.env`，填入独立随机密钥；不要提交真实配置。缺少邮件或加密配置时，申请、审批、补发和激活接口返回 503，不会降级放行。
- 仅本地开发允许 HTTP；公网必须使用 HTTPS，Node 只监听回环地址或受保护网络。

## 网易云账号配置

网站账号与网易云账号独立。缺省 `anonymous` 使用游客身份；推荐管理员扫码接入全站共用账号。不要在模板、代码、Git、浏览器存储或聊天中填写真实密码、Cookie 或加密密钥；真实 `.env` 只供服务账号读取，例如权限设为 `600`。

### 管理员扫码（当前加密保存）

在受保护的真实 `.env` 中设置后重启后端：

```dotenv
NETEASE_AUTH_MODE=qrcode
NETEASE_SESSION_STORAGE=encrypted
NETEASE_SESSION_ENCRYPTION_KEY=填写独立的32字节标准Base64密钥
```

本地生成密钥的命令见 `.env.example`；不要与 Session Secret 或 TOTP 密钥共用。扫码模式不使用 `NETEASE_PHONE`、`NETEASE_PASSWORD`，可从真实配置删除这两项。以网站管理员身份打开「设置 → 账号与安全 → 管理网易云账号」，点击扫码登录，用官方网易云音乐 App 扫码并确认。普通成员没有此入口，后端也拒绝其管理请求；网站原有管理员2FA策略继续生效。

- 登录成功后所有已获网站权限的成员共用该网易云身份。Cookie只留在后端，数据库 `netease_session` 的单行凭据使用 AES-256-GCM 加密；重启后可恢复，不依赖浏览器或网易云密码。
- 二维码在本站最多保留三分钟，绑定发起管理员的具体网站 Session；每三秒查询一次状态，不并发轮询。关闭面板、切换设置分类或HTTP连接中断会取消当前扫码；旧二维码、旧网站会话、迟到响应不能激活或覆盖新身份。
- 「退出网易云登录态（全站）」清除本站内存及保存的凭据，不退出网站账号或手机 App。退出失败不会显示成功。密钥更换/损坏时不会降级保存明文；可检查密钥，或退出本站网易云登录态并重新扫码。
- 状态面板表示本站是否已加载凭据，不持续探测上游有效性。网易云业务请求遇到失效/验证/风控时会清除当前登录态，需要管理员重新扫码；旧账号的迟到请求不会清除后来连接的新账号。
- 接口库不支持用现有 `/login/refresh` 刷新二维码登录 Cookie，本功能不自动刷新或重登，也不绕过验证码/风控。真实扫码成功率和会员歌曲权限仍需真实环境确认。

### 课堂演示（仅内存）

演示部署时改为：

```dotenv
NETEASE_AUTH_MODE=qrcode
NETEASE_SESSION_STORAGE=memory
NETEASE_SESSION_ENCRYPTION_KEY=
```

此模式不会持久化新Cookie；启动时删除已有加密登录态行，必须重新扫码。后端重启后登录态丢失，网站账号、音乐数据和Session不受此切换影响。不提供明文Cookie文件模式。

### 手机号模式与共用边界

仍兼容 `NETEASE_AUTH_MODE=phone`，并从 `NETEASE_PHONE`、`NETEASE_COUNTRY_CODE`（缺省86）、`NETEASE_PASSWORD` 读取凭据。密码含 `#` 或空格时用引号保留原值；它与网站成员密码、管理员密码独立。手机号模式每进程启动只尝试一次登录、只在内存保留Cookie，失败不降级匿名，不自动重登。不要反复重启碰撞验证码；当前真实环境已观察到上游 `-462`，不能把配置校验通过当作登录成功。

两种账号模式都不提供公开的网易云密码登录入口，不接入下载接口，不把 `NETEASE_COOKIE` 当作配置入口。第三方请求由独立工作线程承载，其原始stdout/stderr被消费丢弃，防止Cookie或内部错误写入日志；硬超时会终止线程并拒绝后续请求，需要人工处理后重启服务。不修改vendor、不新增HTTP服务或依赖。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 同时启动 API 和前端开发服务 |
| `pnpm dev:api` / `pnpm dev:web` | 单独启动后端或前端 |
| `pnpm build:web` | TypeScript 检查与前端生产构建 |
| `pnpm test` | 单元/集成测试 |
| `pnpm test:coverage` | 后端 `src/**` 覆盖率，行/函数/分支/语句门槛均为 80% |
| `pnpm test:e2e` | 独立服务上的 Playwright 浏览器流程 |
| `pnpm verify:baseline` | 顺序执行安装、构建、测试、覆盖率、Chromium 安装和浏览器验收 |

`pnpm verify:baseline` 任一步失败都会返回非零退出码，不用重试掩盖失败。

## 验收边界与报告

- 浏览器验收使用生产构建 `frontend/dist`，独立服务绑定 `127.0.0.1:4317`；SQLite 和音乐存储位于系统临时目录，不读取真实 `.env`、Redis、SMTP、网易云或用户数据。网易云上游和音频使用固定白名单响应与合成资源。
- 这些结果不能替代真实网易云账号/VIP、真实邮件送达、真实 HTTPS/反向代理/Redis 或公网部署验收。
- 覆盖率口径是后端 `src/**`，不是整个 React UI 覆盖率。
- 产物位于忽略目录：`artifacts/baseline/`（summary.json、日志）和 `artifacts/e2e/`（results.json、HTML 报告、截图和失败 trace）。CI 保留 14 天；不要上传数据库、Session、`.env`、真实上传文件或生产 trace。
- 常见问题：子模块未初始化会导致后端测试加载失败；首次浏览器验收需 `pnpm exec playwright install --only-shell chromium`（约 100 MB）；依赖安装重建 `node_modules` 时不要并行构建或测试；4317 端口被占用会直接失败，不复用开发服务器。

## CI 与安全门禁

`.github/workflows/acceptance.yml` 在 push、PR 和手动触发时运行，只读仓库权限且不部署。`acceptance` 作业递归检出子模块后执行 `pnpm verify:baseline`；`dependency-security` 作业单独执行官方源审计：

```bash
pnpm audit --registry=https://registry.npmjs.org --audit-level=high --json
```

不使用 `continue-on-error` 或漏洞忽略列表。既有高危依赖未处理时，安全作业会失败；公网开放前必须修复或明确记录风险。当前改动尚未提交或推送，远程 GitHub Actions 结果不能视为已经通过。

## 文档

- [技术路线图](open-music-club-technical-roadmap.md) — 当前状态、功能边界、未完成事项与后续计划。
- [前端架构与开发指南](docs/frontend-architecture.md) — 目录、React 生命周期、音频/队列/主题契约。
- [申请审核与自动激活](docs/application-activation.md) — 申请、邮件配置、激活、接口与验收边界。
- [部署测试方案](docs/deployment-test-plan.md) — 海外 Nginx、国内 Express、WireGuard 方案（未部署）。
- [音乐足迹功能说明](docs/music-footprint-integration.md)
- [两步验证与密码恢复](docs/security/two-factor.md)
- [修改记录](docs/修改记录.md)

安全底线：公网 HTTPS、Secure/HttpOnly/SameSite Cookie、CSRF 与同源 CORS、分级限流、精确 `trust proxy`、上传校验与失败清理、错误和日志脱敏；数据库、Session、存储和内部端口不得直接暴露。
