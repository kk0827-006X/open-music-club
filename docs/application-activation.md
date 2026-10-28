# 申请审核与自动激活

现行流程：申请人提交邮箱、昵称和理由后直接进入待审核；管理员可立即通过或拒绝。通过后系统发送 24 小时有效的一次性激活链接，申请人设置密码后才创建账号，随后正常登录。提交不再签发或发送邮箱验证凭证，审批不以邮箱验证或验证邮件送达为前提。管理员只决定通过或拒绝，不填写、查看或转交密码。

## 流程与界面

1. 登录页“申请账号”提交后返回 202 统一提示“符合条件的申请会进入审核，审核结果通过邮件通知”，不返回申请编号或邮箱。重复提交、已有账号、未到重新申请时间等情况使用同一提示。
2. 管理员在“用户”页左侧分类栏末尾打开“申请审核”，在当前页面内嵌显示，保留播放器和队列；`/admin/applications` 深链接仍可使用。管理员必须已绑定并完成 TOTP 2FA，开发环境同样检查；未绑定时先进入设置 → 账号与安全 → 管理 2FA。
3. 后台提供待审核、待激活、已激活、已拒绝、通知异常筛选以及列表、详情、分页。待审核申请无需邮箱验证即可通过或拒绝；后台接口不返回邮箱、用户对象或凭证。
4. 通过后系统发送 24 小时有效的激活链接。审批与激活任务入队在同一个事务内完成；激活邮件额度不足或任务入队失败时整笔审批回滚，申请保持待审核，不会出现“已通过但没有激活任务”。
5. 申请人在 `/activate#token=...` 设置密码：8～72 个可打印 ASCII 字符（0x21～0x7E），不含空格、换行、控制字符、中文或其他 Unicode；必须同时包含大写字母、小写字母、数字和英文符号。保留 72 位上限避免 bcrypt 截断，不 trim、不截断、不记录密码。前端只做界面预检，后端在消费 Token 和 bcrypt 运算前独立校验；设置成功才创建账号，不自动建立登录会话。已有账号密码继续有效。
6. 待激活详情显示激活邮件状态：待发送、正在发送、邮件服务已接受、已送达、发送失败、投递结果未知、已撤销或链接过期。已送达只表示收件服务器接受，不代表已阅读。
7. 待激活申请可由管理员点击“重发激活邮件”，经确认弹窗后签发新链接，旧链接立即失效。成功文案仅表示邮件已入队，不代表已送达。已接受、已送达或结果未知都允许补发；每邮箱每分钟一次、每 24 小时五次冷却，额度命中返回 429，且不撤销仍可用的旧链接。已激活、已拒绝和待审核申请不能补发。
8. 申请人丢失或过期链接时，可在 `/activate` 输入申请邮箱自助重发。未知邮箱、未注册、未到已通过阶段、冷却和额度耗尽都返回统一提示，不泄露申请阶段；未到已通过阶段不发信，也不消耗激活额度。公开入口与管理员补发共享同一激活邮件额度。
9. 拒绝邮件使用固定文案，七天后可重新申请；审核资料不能靠重发修改。
10. 旧版 `/verify-email#token=...` 进入兼容说明页，只说明“申请流程已简化，已提交申请无需邮箱验证，请等待审核”，不提交验证、不引导重发验证邮件，也不挂载播放器。

管理员提醒只是辅助：提交时按申请幂等入队，不含邮箱、理由或 Token。审批后的实际发信或投递故障不撤销审核或激活；本地激活额度或任务入队失败则回滚审批。

## 额度、任务与并发

- 申请提交与激活邮件使用不同邮箱摘要命名空间。申请命名空间沿用旧摘要以兼容升级前额度；激活邮件使用新命名空间，从新命名空间开始，避免刚提交的 60 秒冷却阻塞首次审批发信。
- 两类额度都保留每邮箱每分钟一次、每 24 小时五次检查；公开重发与管理员补发共享激活额度。额度命中 429 时不撤销旧 Token 或旧任务。
- 生产入口 `src/server.js` 在启动时运行进程内 worker：每五秒尝试一轮，每轮优先发送最多十封邮件，再独立查询最多十条投递记录；上一轮未结束时不重叠运行。查询按最早应处理时间排序，不占用新邮件发送额度；SQLite lease 隔离同库多进程领取。
- `createApp()` 本身不启动定时器，供隔离测试显式调用 `accessLifecycle.tick()`；关闭时停止领取并等待当前任务。没有外部队列或新增依赖。
- SMTP 明确拒绝或可证明的系统 connect 失败按 1、5、15 分钟重试，初次加最多三次；通用 CONN 标签本身不能证明邮件尚未发送。已接受和未知只查询阿里云记录，不盲目重发。
- SMTP DATA 后断线或发送中进程崩溃转为未知；查询 pending 不能把未知升级为已接受。自动查询最多持续发送起点之后 24 小时，超时仍标为未知并停止查询。
- SMTP 无法保证绝对只发送一次；重复邮件中的凭证仍只能成功使用一次。重发与正在发送相遇时旧邮件可能到达，但旧凭证无效，迟到结果不能覆盖任务撤销状态。

## 邮件配置与阿里云查询

保留 SMTP TLS 配置。`MAIL_ENABLED=true` 才启用；465 端口使用隐式 TLS，其他端口强制 STARTTLS，保留证书验证。连接、问候、空闲和 DNS 各限 5 秒，通知总等待限 8 秒；现有 HTTP 请求超时应留出该窗口。配置有误在启动时明确失败，不默默退回明文 SMTP。

| 变量 | 用途 |
| --- | --- |
| `MAIL_ENABLED` | 仅 `true` 启用，否则申请、审批、补发和激活返回 503 |
| `SMTP_HOST` / `SMTP_PORT` | SMTP 主机和端口，默认 465 |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP 账号与授权码，不能提交真实值 |
| `MAIL_FROM` | 网站发件地址；`noreply` 地址不是可登录的收件箱 |
| `MAIL_ADMIN_TO` | 管理员通知收件箱，缺省回退 `ADMIN_EMAIL` |
| `PUBLIC_ORIGIN` | 唯一正式 HTTPS 来源，用于生成激活链接和同源校验 |
| `APPLICATION_MAIL_ENCRYPTION_KEY` | 独立 32 字节随机数据的标准 Base64，用于加密待发送 Token，与 TOTP 密钥分开保管 |
| `ALIYUN_DM_REGION_ID` | 固定 `cn-hangzhou` |
| `ALIYUN_DM_ACCESS_KEY_ID` / `ALIYUN_DM_ACCESS_KEY_SECRET` | 专用 RAM 凭据；不是 SMTP 密码 |
| `ALIYUN_DM_SECURITY_TOKEN` | 使用 STS 临时凭据时填写，长期 RAM 凭据留空 |

阿里云 RAM 新建专用用户或角色，最小权限自定义策略如下。不要使用主账号密钥，不授予发信、删除或完整邮件管理权限：

```json
{"Version":"1","Statement":[{"Effect":"Allow","Action":["dm:SenderStatisticsDetailByParam"],"Resource":["*"]}]}
```

API 固定 HTTPS 端点 `dm.aliyuncs.com`。查询用唯一随机主题、发件地址和收件地址精确匹配阿里云记录；保存 Message-ID 仅便于关联，查询接口不返回 Message-ID，不能拿它伪造匹配。每次最多读取三页、每页 100 条，未读完不能确认成功；查询有总超时；首次发送被接受或结果未知后约 10 秒开始查询，后续通常每分钟查询一次，并使用 30 秒 lease 防止重复领取；迟到结果不能覆盖已撤销的任务。

“投递成功”只代表收件服务器接受，不保证进入收件箱、未被放入垃圾箱，更不代表管理员或申请人已阅读。查询留存窗口外和上游不可用的结果继续未知，不能据此自动重发。官方状态依据：[SenderStatisticsDetailByParam](https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-senderstatisticsdetailbyparam)。

邮件为纯文本；管理员提醒仅含申请编号，申请人邮件按用途包含审核结果或激活链接，不发送正式密码、申请理由、TOTP、恢复码或内部路径。失败日志只含 `mail_delivery_failed`、申请 ID、通知类型和请求 ID，不记录 SMTP 错误文本、收件地址或凭据。缺少关键配置时启动日志输出 `access_mail_unavailable` 及缺失的配置名称，不输出值；`/health` 只是进程健康检查，不能当作邮件可用性证明。

## 数据、迁移与兼容

- `access_requests` 仍使用 pending/approved/rejected；是否已激活通过 `activatedAt` 判断。`access_workflow` 保存激活、历史本人确认与迁移标识。
- `access_tokens` 保存 32 随机字节凭证的 SHA-256 摘要、用途、期限和消费记录。审批、公开重发、管理员补发与激活使用数据库事务；只有新 Token 成功落库后才撤销旧 Token 和旧任务，事务失败整体回滚。激活在 bcrypt 运算后再次检查并原子创建用户。
- `access_mail_jobs` 与业务同时提交。可发送 Token 使用 AES-256-GCM 加密，并以 token ID 作 AAD；任务不保存明文 Token，发送接受、结果未知、最终失败、过期或撤销后清除密文。后台只读取最新 `kind=activate` 任务作为激活邮件状态，管理员提醒或其他通知不能覆盖。
- 旧待审申请由增量迁移保留原编号、审核记录、既有账号和激活链接。worker 每轮以幂等事务撤销全部旧验证凭证与验证任务、清空相关密文与 lease，并标记 `legacy_invited=1`；即使旧版已标记过邀请，也会清理残留的未消费验证链接。迁移不补发验证邀请，也不生成历史管理员提醒。迁移后的旧待审申请无论是否验证过邮箱、是否有验证送达证据，均可直接审核。历史已审批和已有账号保持原状。
- 旧 `/api/applications/verify-email` 固定返回 410，`/api/applications/resend` 只接受 `purpose=activate`，verify 用途返回 400。旧 `/api/applications/:id/notification` 公开查询入口已移除；旧 `application_notifications` 数据保留用于历史记录，新流程不再读取它决定审批。
- 后台 DTO：`status`、`canReview`、`canResendActivation`（仅资格，不按额度伪装）、`activationMailStatus`（仅最新 activate）、`notificationStatus`（兼容保留）、`activatedAt` 等。筛选保留 pending、awaiting_activation、activated、rejected、notification_error；异常筛选只按当前业务相关邮件判断，管理员提醒失败不混淆。

## HTTP 接口

全部响应 `no-store`；所有 POST 使用 Session CSRF 与同源检查，生产使用 Secure/HttpOnly/SameSite Cookie；公开写入和审批分别限流。

| 方法 | 地址 | 内容 |
|---|---|---|
| POST | `/api/applications` | `{email,nickname,reason}`，202 统一提示，直接待审核 |
| POST | `/api/applications/verify-email` | 固定 410：申请流程已简化 |
| POST | `/api/applications/resend` | `{email,purpose:'activate'}`，202 统一提示 |
| POST | `/api/auth/activate` | `{token,password}`，成功不自动登录 |
| GET | `/api/admin/applications` | `status` 与 `page`；每页 20 条，DTO 不含邮箱 |
| POST | `/api/admin/applications/:id/approve` | 空 JSON，不接受 initialPassword |
| POST | `/api/admin/applications/:id/reject` | 空 JSON |
| POST | `/api/admin/applications/:id/resend-activation` | 空 JSON；仅已通过且未激活可补发 |

## 静态部署与验收

Express 不托管前端首页。前端静态服务器必须为 `/verify-email`、`/activate`、`/admin/applications` 返回同版本 SPA index，并为 HTML 设置 `Cache-Control: no-store`、`Referrer-Policy: no-referrer` 和部署文档中的安全头；不得对 API 失败做 SPA fallback。Token 在 fragment 中，不会进入 HTTP URL；前端读取后立即清除，不能被埋点、错误上报或持久化存储收集。

自动验收使用临时数据库、模拟 SMTP 和模拟阿里云；浏览器只从隔离服务写入 `artifacts/e2e/mailbox.json` 的模拟邮件读取链接，不添加生产测试路由。测试产物含合成凭证，不提交 Git。真实 SMTP、RAM 权限、阿里云查询时延和 Gmail 实际送达必须另行授权验收；当前简化流程没有真实发信验收结论，既有依赖风险也不会因本功能通过而消除。

历史说明：2026-10-27 曾要求“验证邮件确认送达或申请人主动验证后才可审核”，该门槛已取消；相关字段和筛选仅为兼容保留。2026-10-28 之前激活密码曾按 15～72 个 UTF-8 字节校验，现由上方 8～72 位四类字符规则替代。
