# Open Music Club

Open Music Club 是面向受控成员、部署在公网 HTTPS 环境中的音乐共享与播放项目。成员需提交访问申请并经管理员审核，不开放自由注册。

项目包含两类音乐来源，在存储、数据库实体、API 命名空间和来源标识上保持独立：

- 网易云接口音乐：通过 `vendor/api-enhanced` 白名单访问 `/api/netease/*`。
- 用户上传的本地音乐：SQLite 元数据 + `storage/` 文件，经受保护的 `/api/local/*` 播放和下载。

前端只使用统一 Track、一个播放队列和一个 Audio，不把两类源数据混存。网易云接入不提供网易云评论、排行榜、推荐、FM、直播等扩展功能，也不以绕过版权或 VIP 限制为目标；网易云解灰默认关闭。

## 技术栈

- 后端：Node.js 26.0.0（`.node-version`）、Express 5、SQLite（better-sqlite3）；生产环境另需 Redis。
- 前端：TypeScript + React 19 + Vite 7；Three.js 档案墙、Motion、Radix Slider。
- 认证：邮箱密码、Session、TOTP 2FA 和一次性恢复码；管理员在公网开放前必须启用 2FA。
- 包管理：pnpm 12.3.4（`package.json` 的 `packageManager` 锁定）；不要用 npm 或 yarn 修改依赖。

## 本地运行

先安装与锁定版本一致的 Node 和 pnpm，并初始化子模块：

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm db:init
pnpm dev
```

- 前端开发地址为 `http://127.0.0.1:5173/`，API 默认监听 `http://127.0.0.1:3000`。
- 首次使用从 `.env.example` 复制为受保护的 `.env`，填入独立随机密钥；不要提交真实配置。缺少邮件或加密配置时，申请、审批、补发和激活接口返回 503，不会降级放行。
- 仅本地开发允许 HTTP；公网必须使用 HTTPS，Node 只监听回环地址或受保护网络。

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
- [两步验证](docs/security/two-factor.md)
- [修改记录](docs/修改记录.md)

安全底线：公网 HTTPS、Secure/HttpOnly/SameSite Cookie、CSRF 与同源 CORS、分级限流、精确 `trust proxy`、上传校验与失败清理、错误和日志脱敏；数据库、Session、存储和内部端口不得直接暴露。
