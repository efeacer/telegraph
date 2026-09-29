// Turns the lines of the bug log into a list of problems to fix.

/**
 * @typedef {{ version: string, builtAt: string, packaged: boolean }} Build
 * @typedef {{ at: string, run: string, kind: string, message: string, stack?: string,
 *   detail?: Record<string, unknown>, fingerprint: string, count: number, build: Build }} Entry
 * @typedef {{ fingerprint: string, resolvedAt: string, note: string }} Resolution
 * @typedef {{ fingerprint: string, kind: string, message: string, occurrences: number,
 *   runs: number, firstSeen: string, lastSeen: string, builds: Build[], latest: Entry,
 *   status: 'open' | 'came-back' | 'resolved', resolution?: Resolution }} Group
 */

// What ends the app or a window comes first, then what the user took the
// time to write down, then the errors the app lived through.
const URGENCY = [
  ['window-crash', 'child-crash', 'main-error'],
  ['unclean-exit'],
  ['bug-report']
]
const LEAST_URGENT = ['console-error']

/** @returns {Entry[]} */
export function parseLog(text) {
  const entries = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const entry = JSON.parse(line)
      if (isEntry(entry)) entries.push(entry)
    } catch {
      // A crash can cut the last line short.
    }
  }
  return entries
}

function isEntry(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.at === 'string' &&
    typeof value.run === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.message === 'string' &&
    typeof value.fingerprint === 'string' &&
    typeof value.build === 'object' &&
    value.build !== null
  )
}

/**
 * @param {Entry[]} entries
 * @param {{ resolved?: Resolution[], all?: boolean }} [options]
 * @returns {Group[]}
 */
export function digest(entries, { resolved = [], all = false } = {}) {
  const byFingerprint = new Map()
  for (const entry of entries) {
    const group = byFingerprint.get(entry.fingerprint) ?? []
    group.push(entry)
    byFingerprint.set(entry.fingerprint, group)
  }

  return [...byFingerprint.values()]
    .map((group) => summarize(group, resolved))
    .filter((group) => all || group.status !== 'resolved')
    .sort((one, other) => urgencyOf(one) - urgencyOf(other) || compare(other.lastSeen, one.lastSeen))
}

function summarize(entries, resolved) {
  const inOrder = [...entries].sort((one, other) => compare(one.at, other.at))
  const latest = inOrder.at(-1)

  // A flood is only written now and then, and each entry says how far its
  // run had counted.
  const countByRun = new Map()
  for (const entry of inOrder) {
    countByRun.set(entry.run, Math.max(countByRun.get(entry.run) ?? 0, entry.count ?? 1))
  }

  const builds = new Map()
  for (const { build } of inOrder) {
    const { version, builtAt, packaged } = build
    builds.set(`${version} ${builtAt} ${packaged}`, { version, builtAt, packaged })
  }

  const resolution = resolved.find((candidate) => candidate.fingerprint === latest.fingerprint)
  const cameBack = inOrder.some((entry) => entry.build.builtAt > resolution?.resolvedAt)

  return {
    fingerprint: latest.fingerprint,
    kind: latest.kind,
    message: latest.message,
    occurrences: [...countByRun.values()].reduce((sum, count) => sum + count, 0),
    runs: countByRun.size,
    firstSeen: inOrder[0].at,
    lastSeen: latest.at,
    builds: [...builds.values()].sort((one, other) => compare(one.builtAt, other.builtAt)),
    latest,
    status: resolution === undefined ? 'open' : cameBack ? 'came-back' : 'resolved',
    ...(resolution === undefined ? {} : { resolution })
  }
}

function urgencyOf(group) {
  const tier = URGENCY.findIndex((kinds) => kinds.includes(group.kind))
  if (tier !== -1) return tier
  return LEAST_URGENT.includes(group.kind) ? URGENCY.length + 1 : URGENCY.length
}

function compare(one, other) {
  return one < other ? -1 : one > other ? 1 : 0
}

/**
 * @param {Resolution[]} resolved
 * @param {string} fingerprint
 * @param {string} note
 * @param {Date} at
 * @returns {Resolution[]}
 */
export function resolve(resolved, fingerprint, note, at) {
  return [
    ...resolved.filter((resolution) => resolution.fingerprint !== fingerprint),
    { fingerprint, resolvedAt: at.toISOString(), note }
  ]
}

/**
 * @param {Group[]} groups
 * @param {{ folders: string[] }} source
 */
export function render(groups, { folders }) {
  const open = groups.filter((group) => group.status !== 'resolved').length
  const lines = [
    open === 0 ? 'Telegraph bug log: No open problems' : `Telegraph bug log: ${plural(open, 'open problem')}`,
    ...folders.map((folder) => `Read from ${folder}`),
    'Times are in UTC'
  ]

  groups.forEach((group, index) => {
    lines.push('', `${index + 1}. ${group.kind}  ${group.fingerprint}`)
    if (group.status === 'came-back') {
      const { resolvedAt, note } = group.resolution
      lines.push(`   CAME BACK after it was resolved on ${day(resolvedAt)} (${note})`)
    }
    if (group.status === 'resolved') {
      lines.push(`   Resolved on ${day(group.resolution.resolvedAt)} (${group.resolution.note})`)
    }
    lines.push(
      ...indent(group.message, 3),
      `   ${plural(group.occurrences, 'time')} in ${plural(group.runs, 'run')}, ` +
        `first ${minute(group.firstSeen)}, last ${minute(group.lastSeen)}`,
      ...group.builds.map(
        ({ version, builtAt, packaged }) =>
          `   Build ${version} of ${minute(builtAt)}, ${packaged ? 'installed' : 'development'}`
      )
    )
    if (group.latest.stack) lines.push('   Stack:', ...indent(group.latest.stack, 5))
    if (group.latest.detail && Object.keys(group.latest.detail).length > 0) {
      lines.push('   Detail:', ...indent(JSON.stringify(group.latest.detail, null, 2), 5))
    }
  })

  if (open > 0) {
    lines.push('', 'After fixing a problem: npm run bugs -- --resolve <fingerprint> "what fixed it"')
  }
  return `${lines.join('\n')}\n`
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function indent(text, width) {
  return text.split('\n').map((line) => `${' '.repeat(width)}${line.trimEnd()}`)
}

function day(time) {
  return time.slice(0, 10)
}

function minute(time) {
  return `${time.slice(0, 10)} ${time.slice(11, 16)}`
}
