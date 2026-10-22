import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode; decorative?: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.decorative) return null
    return <section className="component-error" role="alert"><p>界面资源暂时无法加载，请重新载入页面。</p><button type="button" onClick={() => window.location.reload()}>重新载入</button></section>
  }
}
