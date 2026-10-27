# 申请审核与自动激活

本流程保护 Open Music Club 账号，与网易云账号无关。管理员只决定通过或拒绝，不填写、查看或转交密码。

## 流程与界面

1. 登录页“申请账号”填写邮箱、昵称、理由。提交持久化后返回 202，请查收验证邮件；此时还未进入审核队列。
2. 用户打开 `/verify-email#token=...`，主动点击“确认邮箱”。验证链接 30 分钟有效，GET 与邮件扫描不会消费凭证。
3. 管理员登录后从站内“申请审核”进入 `/admin/applications`；管理员必须已绑定并完成 TOTP 2FA（开发环境同样检查）。未绑定时先进入设置 → 账号与安全 → 管理 2FA，绑定后重新登录。
4. 后台提供待审核、待激活、已激活、已拒绝、通知异常筛选以及列表、详情、分页。管理员确认通过或拒绝后由系统自动发信。后台接口不返回邮箱、用户对象或凭证；用户自行写入昵称/理由的联系方式不在此保证内。
5. 通过后发送 24 小时有效的激活链接。用户在 `/activate#token=...` 设置 15～72 个 UTF-8 字节的密码（中文通常占三字节）；设置成功才创建账号，随后正常登录，不自动建立登录会话。
6. 过期或丢失链接可在相应页面输入邮箱自助重发。未知邮箱、已注册、未达到对应阶段、冷却与额度耗尽都返回同一提示。每邮箱跨用途、跨会话共用每分钟一次、每 24 小时五次额度（首次验证发信占一次）。重发撤销旧凭证与旧任务。
7. 拒绝邮件使用固定文案，七天后可重新申请。已验证资料不能靠重发修改。

管理员提醒只是辅助；邮件服务故障不撤销审核或激活。普通用户直接访问管理网址会看到无权访问，不加载申请内容。公开链接页面不挂载播放器和音乐工作区。

## 配置与运行

保留现有 SMTP TLS 配置和 `PUBLIC_ORIGIN`；生产站点只允许固定 HTTPS Origin。新增 `APPLICATION_MAIL_ENCRYPTION_KEY`，为独立 32 字节随机数据的标准 Base64，与 TOTP 密钥分开保管。只在受保护环境配置，不提交、不打印真实值、不复制到执行 Agent 工作树。缺少配置时相关业务返回 503，不创建申请；非法密钥格式拒绝启动。丢失密钥后旧待发送密文不能恢复，用户须自助重发；上线前须安全备份数据库和独立密钥。

生产入口 `src/server.js` 在启动时运行进程内 worker，每五秒领取最多十个任务；SQLite lease 隔离同库多进程领取。`createApp()` 本身不启动定时器，供隔离测试显式调用 `accessLifecycle.tick()`。关闭时停止领取并等待当前任务。没有增加依赖或外部队列。

旧待审申请由增量迁移保留原编号并补上工作流记录。首次 worker 处理时自动入队一次邮箱验证邀请；事务内的标识防止重启重复创建邀请。历史已审批、已有账号保持原状。本地代码验收不会启动真实生产数据库或自动向历史邮箱发信；实际启动配置齐全的生产服务后才执行迁移发信。

## 凭证、任务与投递

- `access_workflow` 保存邮箱验证、激活与历史迁移标识；原申请表仍使用 pending/approved/rejected，接口将未验证 pending 映射为 awaiting_verification。
- `access_tokens` 保存 32 随机字节凭证的 SHA-256 摘要、用途、期限和消费记录。验证、激活、重发与审批使用数据库事务；激活在 bcrypt 运算后再次检查并原子创建用户。
- `access_mail_jobs` 和业务同时提交。短期可发送 Token 使用 AES-256-GCM 加密，并以 token ID 作 AAD；任务不保存明文 Token，发送接受、结果未知、最终失败、过期或撤销后清除密文。
- SMTP 明确拒绝按 1、5、15 分钟重试，初次加最多三次；Token 过期后不再发送。已接受和未知只查阿里云记录，不盲目重发。阿里云最终失败时记录失败，用户可自助重发新凭证。
- SMTP DATA 后断线或发送中进程崩溃转为未知；查询 pending 不能将未知升级为已接受。唯一主题用于关联投递，缺少阿里云查询配置时保留状态，不谎报送达。
- SMTP 无法实现绝对只发送一次；重复邮件中的凭证仍只能成功使用一次。重发与正在发送相遇时旧邮件可能到达，但旧凭证无效，迟到结果不能覆盖任务撤销状态。
- 邮件与日志不包含用户正式密码、申请理由或上游异常。管理员邮件只包含申请编号；邮件服务商和服务器完全控制者仍在信任边界内。

## HTTP 接口

全部响应 `no-store`；所有 POST 沿用 Session CSRF 与同源检查，生产使用 Secure/HttpOnly/SameSite Cookie。各类公开写入和审批有独立限流。

| 方法 | 地址 | 内容 |
|---|---|---|
| POST | `/api/applications` | `{email,nickname,reason}`，202 统一提示，不返回编号/邮箱 |
| POST | `/api/applications/verify-email` | `{token}`，主动验证并进入审核 |
| POST | `/api/applications/resend` | `{email,purpose:'verify'或'activate'}`，202 统一提示 |
| POST | `/api/auth/activate` | `{token,password}`，成功不自动登录 |
| GET | `/api/admin/applications` | `status` 与 `page`；每页20条，DTO不含邮箱 |
| POST | `/api/admin/applications/:id/approve` | 空 JSON，不再接受 initialPassword |
| POST | `/api/admin/applications/:id/reject` | 空 JSON |

旧 `/api/applications/:id/notification` 公开查询入口已移除。旧 application_notifications 数据保留用于历史记录，新流程不再读取它决定审批。

## 静态部署与验收

Express 不托管前端首页。前端静态服务器必须为 `/verify-email`、`/activate`、`/admin/applications` 返回同版本 SPA index，并为 HTML 设置 `Cache-Control: no-store`、`Referrer-Policy: no-referrer` 以及部署文档中的安全头。不得对 API 失败做 SPA fallback。Token 在 fragment 中不会进入 HTTP URL，前端读取后立即清除，不能被埋点、前端错误上报或浏览器持久化存储收集。

自动验收使用临时数据库、模拟 SMTP 与模拟阿里云；浏览器仅从隔离服务写入 `artifacts/e2e/mailbox.json` 的模拟邮件读取链接，不添加生产测试路由。测试产物含合成凭证，不提交 Git。真实 SMTP、RAM 权限、阿里云时延和投递仍需另行授权验收。已有依赖风险不因本功能通过而消除，不代表可以直接公网发布。
