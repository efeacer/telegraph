/** Names the file a session is to report its status to. Set for every session Telegraph starts. */
export const USAGE_FILE_VARIABLE = 'TELEGRAPH_USAGE_FILE'

// Written to the side and moved into place, so that the file is never read half written.
// Nothing is printed, so that no line of status shows in the session.
const REPORT = [
  `[ -n "$${USAGE_FILE_VARIABLE}" ] || exit 0`,
  `cat > "$${USAGE_FILE_VARIABLE}.tmp" && mv "$${USAGE_FILE_VARIABLE}.tmp" "$${USAGE_FILE_VARIABLE}"`
].join('; ')

/**
 * Settings for one session of Claude Code, given to it as it is started.
 * Claude Code hands what it knows of the session, the limits of the plan
 * among it, to the command of its status line. This one keeps it for
 * Telegraph to read. The settings of the user are left as they are.
 */
export const STATUS_LINE_SETTINGS = JSON.stringify({
  statusLine: { type: 'command', command: REPORT }
})
