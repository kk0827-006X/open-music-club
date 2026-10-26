# PR #6 验收基线修复

## 原始失败与修复范围

基线提交：`9e72cc5e82dee3521663d051f6b7d64780e46c16`，修复分支：`codex/pr6-baseline-fix`。
原始 CI：[可复现验收基线 #27](https://github.com/kk0827-006X/open-music-club/actions/runs/40323024933)。

- `src/app.js:21` 引用的 `src/services/aliyunDelivery.service.js` 未包含在 PR，导致 12 个后端测试文件加载失败。
- 申请服务调用的 `getDeliveryConfig()`、`submitNotification()` 未在 PR 的邮件服务实现中交付；补齐状态分类、独立主题及 Message-ID，同时保留旧通知接口。
- 补齐阿里云官方 SDK 依赖、隔离测试和环境变量示例；浏览器验收服务注入模拟 SMTP 和投递查询，避免新申请流程在邮件关闭时返回 503。
- `multer` 升级至 2.5.0，通过根 overrides 将 `body-parser` 两条依赖链分别修复至 1.20.9、2.4.0，不修改第三方源码或放宽安全门禁。

未纳入主目录已有前端申请弹窗及其他暂存修改，未提交、推送、部署或修改真实环境配置。

## 投递查询配置与边界

`MAIL_ENABLED=true` 时，新申请需要启用 SMTP 及独立投递查询。按 `.env.example` 配置 `ALIYUN_DM_ACCESS_KEY_ID`、`ALIYUN_DM_ACCESS_KEY_SECRET`；使用 STS 时另配置 `ALIYUN_DM_SECURITY_TOKEN`。区域仅支持 `cn-hangzhou`，固定 HTTPS 端点 `dm.aliyuncs.com`，不读取默认云凭据链。

专用 RAM 身份只授予 `dm:SenderStatisticsDetailByParam` 查询权限，禁止使用主账号密钥。SMTP 接受仅代表 accepted；查询精确匹配唯一主题、发件地址及收件地址后才确认 delivered。未知、超时、查询异常不能自动视为可重发的失败。

全部自动化验收使用临时数据库、模拟 SMTP 和模拟投递记录。真实 RAM 权限、上游记录延迟及管理员实际收信仍待人工实发验收，不把自动化通过等同于真实送达。

## 集中验收

2026-10-26 集中验收通过：

| 检查 | 结果 |
| --- | --- |
| `HUSKY=0 pnpm verify:baseline` | 返回 0，六个步骤全部通过 |
| 冻结安装、TypeScript/Vite 构建 | 通过；既有大分块提示仍存在 |
| 单元/集成测试 | 386/386，通过；无跳过 |
| 全部后端覆盖率门禁 | 行/语句 97.29%、分支 89.19%、函数 97.71% |
| 浏览器 | 6/6 通过，含服务启动、申请审批、2FA、上传、混合播放、队列与界面回归 |
| `pnpm audit --registry=https://registry.npmjs.org --audit-level=high --json` | 返回 0；0 高危、0 严重，仍有 8 中危、2 低危 |
| 主 Agent diff 检查、两位只读审查 | 通过，无阻断项 |
| 真实阿里云查询、真实邮件、更新后的 GitHub CI | 待验收；本轮未提交、推送 |

本机环境为 macOS arm64、Node v26.12.0、pnpm 12.3.4；远程 CI 固定 Node 26.0.0，尚未宣称在该远程环境通过。新增依赖为官方 SDK，新增环境变量见上文；生产监听、Session、HTTPS、代理信任配置和 2FA 协议未调整，相关既有安全与上传回归全部通过。

结果保存在忽略目录 `artifacts/baseline/`、`artifacts/security/` 和 `artifacts/e2e/`。

## 文件与后续提交

主 Agent 实现并集中验证；Code Reviewer 和 JavaScript Reviewer 只读复核，均未发现阻断项。修复保留在独立工作树，主目录原有暂存修改没有被覆盖或混入。

确认结果后在此工作树进行一次 Git Commit，准确文件为：

```bash
cd /private/tmp/omc-pr6-baseline-fix
git add .env.example package.json pnpm-lock.yaml pnpm-workspace.yaml \
  src/services/aliyunDelivery.service.js src/services/mail.service.js \
  tests/aliyunDelivery.test.js tests/mail.test.js tests/e2e/server.js \
  docs/pr6-baseline-fix.md
```

工作树基于 PR 原始提交；提交后需将修复纳入 PR 分支并推送，才能取得新的 GitHub CI 结果。本轮未自动执行上述提交或推送。

验收源码 SHA-256：`5e32dc550b61f11cba53aec8b0ac9305a6d53274d4a60488cac145abafcab85a`；锁文件 SHA-256：`a09eab5e907342837d9191e411d9daf6f154a0855eaffd6daeecfe81c1bf6b0e`。完整步骤和环境见 `artifacts/baseline/summary.json`。
