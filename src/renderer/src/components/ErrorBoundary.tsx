import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clip, describeProblem } from '@shared/buglog'
import { report } from '../problems'

const COMPONENT_STACK_LIMIT = 2_000

/** Stands in for the window when it cannot be drawn, and says why in the bug log. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    void report({
      kind: 'render-error',
      ...describeProblem(error),
      detail: { components: clip(info.componentStack ?? '', COMPONENT_STACK_LIMIT) }
    })
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
