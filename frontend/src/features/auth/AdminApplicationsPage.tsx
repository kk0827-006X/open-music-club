import { useEffect, useRef, useState } from 'react'
import { listApplications, reviewApplication, type AdminApplication, type ApplicationFilter } from '../../services/auth/applications.ts'
import { Brand, Modal } from '../../shared/react/ui.tsx'

const filters: [ApplicationFilter, string][] = [['pending', '待审核'], ['awaiting_activation', '待激活'], ['activated', '已激活'], ['rejected', '已拒绝'], ['notification_error', '通知异常']]
const statusLabels = { awaiting_verification: '待验证邮箱', pending: '待审核', approved: '已通过', rejected: '已拒绝' }
const mailLabels = { queued: '通知待处理', sending: '正在发送', accepted: '邮件服务已接受', delivered: '已送达', failed: '发送失败', unknown: '投递结果未知', cancelled: '已撤销' }
function date(value: string | null) { if (!value) return '—'; const time = new Date(value); return Number.isNaN(time.getTime()) ? '—' : time.toLocaleString('zh-CN', { hour12: false }) }
export function AdminApplicationsPage({ onLogout }: { onLogout(): Promise<void> }) {
  const [filter, setFilter] = useState<ApplicationFilter>('pending')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [items, setItems] = useState<AdminApplication[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<AdminApplication | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reviewError, setReviewError] = useState('')
  const detailTitle = useRef<HTMLHeadingElement>(null)
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const mutation = useRef<AbortController | null>(null)
  useEffect(() => () => mutation.current?.abort(), [])
  useEffect(() => { if (selected) detailTitle.current?.focus() }, [selected?.id])
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setItems([]); setSelected(null)
    void listApplications(filter, page, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return
      const lastPage = Math.max(1, Math.ceil(result.total / 20))
      if (page > lastPage) { setPage(lastPage); return }
      setItems(result.applications); setTotal(result.total)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法加载申请') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filter, page, revision])
  async function review() {
    if (!selected || !decision || mutation.current) return
    const controller = new AbortController(); mutation.current = controller; setBusy(true); setReviewError('')
    try {
      await reviewApplication(selected.id, decision, { signal: controller.signal })
      if (!controller.signal.aborted) { setDecision(null); setNotice(decision === 'approve' ? '已通过审核，系统将自动发送激活邮件。' : '已拒绝申请，系统将自动发送通知。'); setRevision(value => value + 1) }
    } catch (cause) { if (!controller.signal.aborted) { setDecision(null); setReviewError(cause instanceof Error ? cause.message : '审核未成功，请刷新确认状态'); setRevision(value => value + 1) } }
    finally { if (!controller.signal.aborted) { mutation.current = null; setBusy(false) } }
  }
  return <main className="application-admin" data-admin-applications>
    <header className="application-admin-header"><Brand /><nav aria-label="管理导航"><a href="/">返回音乐库</a><button type="button" disabled={busy} onClick={() => { void onLogout().catch(() => setError('退出失败，请稍后重试')) }}>退出登录</button></nav></header>
    <div className="application-admin-heading"><div><p className="application-eyebrow">ADMINISTRATION / MEMBER ACCESS</p><h2>申请审核</h2><p className="application-description">你只需判断是否通过审核。邮箱验证、激活链接与通知由系统自动处理。</p></div><button className="application-secondary" type="button" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>刷新列表</button></div>
    <nav className="application-filters" aria-label="申请状态">{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} disabled={busy} onClick={() => { setFilter(value); setPage(1); setNotice(''); setReviewError('') }}>{label}</button>)}</nav>
    <p className="application-feedback" role="status" aria-live="polite">{notice}</p>
    {(error || reviewError) && <p role="alert" className="application-error">{error || reviewError}</p>}
    {error && <p className="application-description">如果尚未绑定认证器，请先<a href="/">返回音乐库</a>，进入“设置 → 两步验证”完成绑定，再重新登录后打开本页。</p>}
    <div className="application-review-layout">
      <section className={`application-list${selected ? ' has-selection' : ''}`} aria-label="申请列表" aria-busy={loading}>
        <div className="application-list-header"><span>{filters.find(([value]) => value === filter)?.[1]}</span><span>{total} 条</span></div>
        {loading ? <p className="application-empty" role="status">正在读取申请…</p> : !items.length ? <p className="application-empty">{error ? '暂时无法读取，请刷新重试。' : '当前没有符合条件的申请。'}</p> : <ul>{items.map(item => <li key={item.id}><button className="application-list-item" type="button" aria-pressed={selected?.id === item.id} disabled={busy} onClick={() => setSelected(item)}><span className="application-item-title"><strong>{item.nickname}</strong><small>#{item.id}</small></span><span>{statusLabels[item.status]}{item.activatedAt ? ' · 已激活' : ''}</span><time>{date(item.createdAt)}</time></button></li>)}</ul>}
        <div className="application-pagination"><button type="button" disabled={page === 1 || loading || busy} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={page * 20 >= total || loading || busy} onClick={() => setPage(value => value + 1)}>下一页</button></div>
      </section>
      <section className={`application-detail${selected ? ' is-selected' : ''}`} aria-labelledby="application-detail-title">
        {selected ? <><button className="application-mobile-back" type="button" disabled={busy} onClick={() => setSelected(null)}>← 返回申请列表</button><p className="application-eyebrow">APPLICATION #{selected.id}</p><h3 ref={detailTitle} tabIndex={-1} id="application-detail-title">{selected.nickname}</h3><dl><div><dt>申请状态</dt><dd>{statusLabels[selected.status]}</dd></div><div><dt>邮箱验证</dt><dd>{selected.emailVerified ? '已验证' : '尚未验证'}</dd></div><div><dt>提交时间</dt><dd>{date(selected.createdAt)}</dd></div><div><dt>审核时间</dt><dd>{date(selected.reviewedAt)}</dd></div><div><dt>激活时间</dt><dd>{date(selected.activatedAt)}</dd></div><div><dt>通知状态</dt><dd>{selected.notificationStatus ? mailLabels[selected.notificationStatus] : '暂无通知'}</dd></div></dl><h4>申请理由</h4><p className="application-reason">{selected.reason || '未填写申请理由。'}</p><div className="application-review-actions"><button className="primary-action" type="button" disabled={busy || selected.status !== 'pending' || !selected.emailVerified} onClick={() => setDecision('approve')}>通过审核</button><button className="application-secondary" type="button" disabled={busy || selected.status !== 'pending' || !selected.emailVerified} onClick={() => setDecision('reject')}>拒绝申请</button></div><p className="application-description">已处理的申请不能重复审核。通知状态与审核状态独立，邮件延迟不会撤销审核决定。</p></> : <p id="application-detail-title" className="application-empty">选择一条申请查看详情</p>}
      </section>
    </div>
    <Modal open={!!decision} onClose={() => setDecision(null)} busy={busy} className="application-confirm-dialog" aria-labelledby="review-confirm-title"><h3 id="review-confirm-title">{decision === 'approve' ? '确认通过申请？' : '确认拒绝申请？'}</h3><p>申请 #{selected?.id} · {selected?.nickname}</p><p>{decision === 'approve' ? '系统将自动向申请人发送一次性激活链接，由申请人自行设置密码。' : '系统将发送固定拒绝通知，申请人可在 7 天后重新申请。'}</p><div className="application-review-actions"><button className="application-secondary" type="button" disabled={busy} onClick={() => setDecision(null)}>取消</button><button className="primary-action" type="button" disabled={busy} onClick={() => void review()}>{busy ? '正在处理…' : '确认决定'}</button></div></Modal>
  </main>
}
