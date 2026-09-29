import { Component, type ReactNode } from 'react'

/** Stands in for the window when it cannot be drawn. The error itself is reported where React is started. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="failure" role="alert">
        <h1>Telegraph could not draw its window</h1>
        <p>The problem was saved to the bug log. Reloading ends the sessions in this window.</p>
        <div className="empty-actions">
          <button type="button" className="action-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
