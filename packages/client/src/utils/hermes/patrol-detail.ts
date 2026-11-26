import { projectPatrol, type PatrolTask } from './patrol-model'

function plain(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*`]/g, '').replace(/\s+/g, ' ').trim()
}

// Omit technical or oversized prose as a whole: cutting before a negation can
// turn "passed locally, but not verified in production" into a false success.
function concise(value: string): string | null {
  const text = plain(value)
  return text && Array.from(text).length <= 80 &&
    !/https?:|\b(?:HEAD|P\d+)\b|\b(?:session|run)[\s:_-]|(?:角色|优先级|role|priority)\s*[：:]|\b[0-9a-f]{7,40}\b|[0-9a-f]{8}-[0-9a-f-]{20,}/i.test(text) ? text : null
}

function currentField(body: string, names: string[]): string {
  for (const name of names) {
    const line = body.replace(/\*\*/g, '').match(new RegExp(`^\\s*(?:[-*]\\s+)?${name}\\s*[：:]([^\\n]*)`, 'm'))
    if (line) return line[1]
    const section = body.match(new RegExp(`^#{1,3}\\s*${name}\\s*\\n([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`, 'm'))
    if (section) return section[1]
  }
  return ''
}

function actionTitle(title: string): string | null {
  const first = title.split(/[；;]/, 1)[0].replace(/^【[^】]*】\s*/, '').replace(/^[^｜|]+[｜|]/, '')
    .replace(/https?:\/\/\S+|#\d+|\b[0-9a-f]{7,40}\b|\bHEAD\b|\bPR\b|\bP\d+\b|\d+\s*(?:tests?\b|项测试|个测试|passed\b)/gi, '')
    .replace(/(?:PR|提交|commit|测试数|测试数量)\s*[：:]?\s*(?=$|[，,；;])/gi, '')
    .replace(/[（(][\s,，:：/\-]*[）)]/g, '').replace(/^[\s:：,，/\-]+|[\s:：,，/\-]+$/g, '')
  return concise(first)
}

export function projectPatrolDetail(task: PatrolTask) {
  const body = (task.body || '').split(/<details\b/i, 1)[0]
  // Do not use latest_summary: it is an execution narrative, not an authored gate.
  const row = projectPatrol([{ ...task, body, latest_summary: null }])[0]
  const issue = currentField(body, ['看板问题', '问题描述'])
  const evidence = body.split('\n').filter(line => /\bAPM\b/i.test(line)).flatMap(line => {
    return [...line.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].flatMap(match => {
      try {
        const url = new URL(match[0])
        return ['https:', 'http:'].includes(url.protocol) ? [url.href] : []
      } catch { return [] }
    })
  })
  return {
    title: concise(issue) || (issue ? null : actionTitle(task.title || '')),
    project: concise(row.project),
    status: row.status,
    gate: ['done', 'archived'].includes(task.status) ? '—' : concise(row.gateFull),
    treatment: ['done', 'archived'].includes(task.status) ? null : concise(currentField(body, ['处理', '处理结果', '代码状态'])),
    validation: ['done', 'archived'].includes(task.status) ? null : concise(currentField(body, ['验证', '验证结果'])),
    refs: row.refs,
    evidence: [...new Set(evidence)].slice(0, 1),
  }
}
