export const IPC = {
  loadState: 'state:load',
  addProject: 'projects:add',
  removeProject: 'projects:remove',
  gitStatus: 'git:status',
  createSession: 'session:create',
  closeSession: 'session:close',
  write: 'session:write',
  resize: 'session:resize',
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  openExternal: 'shell:open-external',
  menuCommand: 'menu:command'
} as const

export const E2E_ARGUMENT = '--telegraph-e2e'
