import { modelsFor } from '@shared/models'
import { switchModel } from '../controller'
import { modelOf, type AppState, type SessionView } from '../store'
import { Select } from './Select'

// A value no model can have, for the model the session is on when it is none of the list.
const CURRENT = ''

/** The model a session runs on, and a list to change it where its program can be told to. */
export function ModelSwitch({ state, session }: { state: AppState; session: SessionView }) {
  const name = modelOf(state, session)
  const launcher = state.launchers.find((candidate) => candidate.id === session.launcherId)
  const models = launcher ? modelsFor(launcher, state.catalogue) : []

  if (!launcher?.modelCommand || session.status === 'exited' || models.length === 0) {
    return name ? <span className="stage-model">{name}</span> : null
  }

  const chosen = session.model && models.some((model) => model.id === session.model?.id)
  const value = chosen && session.model?.name === name ? session.model!.id : CURRENT
  return (
    <span className="stage-model">
      <Select
        label="Model of this session"
        value={value}
        options={[
          ...(value === CURRENT ? [{ value: CURRENT, label: name ?? 'its usual model', group: 'current' }] : []),
          ...models.map(({ id, name: label }) => ({
            value: id,
            label,
            group: 'listed',
            ...(label === id ? {} : { hint: id })
          }))
        ]}
        onChange={(modelId) => {
          if (modelId !== CURRENT && modelId !== value) switchModel(session.id, modelId)
        }}
      />
    </span>
  )
}
