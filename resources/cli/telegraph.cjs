// The telegraph command, run by agents and people in a Telegraph session.
// It asks Telegraph, which holds the keys to the user's accounts, and prints
// what it answers. Plain Node, without anything to install.
'use strict'
const net = require('node:net')

const HELP = `telegraph: what Telegraph knows of your day, for you and your agents

  telegraph meetings [--days N]         Your meetings from now, for N days (2 by default)
  telegraph mail search <query> [--max N]
                                        Find mail, as Gmail's search box does:
                                        from:ada  subject:review  newer_than:7d  is:unread
  telegraph mail read <id>              Read a message found with search
  telegraph status                      What Telegraph is connected to

Add --json to any of them for JSON.

Nothing is sent, changed or deleted: Telegraph only reads.
`

function fail(message, code = 1) {
  process.stderr.write(`telegraph: ${message}\n`)
  process.exit(code)
}

function option(args, name) {
  const at = args.indexOf(name)
  if (at === -1) return undefined
  const value = Number(args[at + 1])
  args.splice(at, 2)
  return Number.isInteger(value) ? value : undefined
}

function ask(command, args) {
  const socketPath = process.env.TELEGRAPH_BRIDGE
  const token = process.env.TELEGRAPH_BRIDGE_TOKEN
  if (!socketPath || !token) fail('run this inside a Telegraph session, where Telegraph can be reached.')
  return new Promise((resolve) => {
    let answer = ''
    const socket = net.createConnection(socketPath, () => socket.write(`${JSON.stringify({ token, command, args })}\n`))
    socket.setEncoding('utf8')
    socket.on('data', (text) => (answer += text))
    socket.on('error', () => fail('Telegraph could not be reached. Is it still open?'))
    socket.on('end', () => {
      let reply
      try {
        reply = JSON.parse(answer)
      } catch {
        fail('Telegraph gave an answer that could not be read.')
      }
      if (!reply.ok) fail(reply.error || 'Telegraph could not answer.')
      resolve(reply.result)
    })
  })
}

function clock(time) {
  const at = new Date(time)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function day(time) {
  return new Date(time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  if (json) args.splice(args.indexOf('--json'), 1)
  const print = (value, text) => process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : text)
  const [first, second, ...rest] = args

  if (!first || first === 'help' || first === '--help' || first === '-h') return process.stdout.write(HELP)

  if (first === 'status') {
    const status = await ask('status', {})
    return print(status, Object.entries(status).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n')
  }

  if (first === 'meetings') {
    const days = option(args, '--days')
    const meetings = await ask('meetings', { days })
    if (meetings.length === 0) return print(meetings, 'No meetings.\n')
    let lastDay = ''
    const lines = []
    for (const meeting of meetings) {
      const thisDay = day(meeting.start)
      if (thisDay !== lastDay) lines.push(`${lines.length ? '\n' : ''}${thisDay}`)
      lastDay = thisDay
      lines.push(meeting.allDay ? `  all day      ${meeting.title}` : `  ${clock(meeting.start)}–${clock(meeting.end)}  ${meeting.title}`)
    }
    return print(meetings, `${lines.join('\n')}\n`)
  }

  if (first === 'mail' && second === 'search') {
    const most = option(rest, '--max')
    const query = rest.join(' ')
    if (!query) fail('say what to look for, as in: telegraph mail search from:ada newer_than:7d', 2)
    const messages = await ask('mail-search', { query, most })
    if (messages.length === 0) return print(messages, 'No mail found.\n')
    const text = messages.map((message) => `${message.id}  ${message.date}\n  From: ${message.from}\n  ${message.subject}\n  ${message.snippet}`).join('\n\n')
    return print(messages, `${text}\n`)
  }

  if (first === 'mail' && second === 'read') {
    const [id] = rest
    if (!id) fail('say which message, as in: telegraph mail read <id>', 2)
    const message = await ask('mail-read', { id })
    if (!message) return print(message, 'No such message.\n')
    return print(message, `From: ${message.from}\nDate: ${message.date}\nSubject: ${message.subject}\n\n${message.body || message.snippet}\n`)
  }

  fail(`there is no "${args.join(' ')}". See: telegraph help`, 2)
}

main()
