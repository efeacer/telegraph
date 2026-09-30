import { BugReport } from './components/BugReport'
import { Connections } from './components/Connections'
import { Sidebar } from './components/Sidebar'
import { Stage } from './components/Stage'
import { useAppState } from './store'

export function App() {
  const state = useAppState()
  return (
    <div className="app">
      <Sidebar state={state} />
      <Stage state={state} />
      {state.reportingBug && <BugReport />}
      {state.connectionsOpen && <Connections agenda={state.agenda} />}
    </div>
  )
}
