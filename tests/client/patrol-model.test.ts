import { describe, expect, it } from 'vitest'
import { loadPatrolDetails, projectPatrol, type PatrolTask } from '@/utils/hermes/patrol-model'

const business = (id = 'original'): PatrolTask => ({ id, status: 'review', title: 'Long process title', body: '项目：Example\n看板问题：登录后页面空白\n还差：负责人确认\nPR：[当前提案 OPEN](https://github.com/example/app/pull/7)\n<details>PR：[旧候选](https://github.com/example/app/pull/2)</details>' })
const helper = (id: string): PatrolTask => ({ id, status: 'done', title: '检查 #7', body: '目标：检查 #7\nPR：[OPEN](https://github.com/example/app/pull/7)' })

describe('patrol projection', () => {
  it('uses authored current summaries, native status, gate and canonical current PR only', () => {
    const row = projectPatrol([business()])[0]
    expect(row).toMatchObject({ project: 'Example', issue: '登录后页面空白', status: '待确认', gate: '负责人确认' })
    expect(row.refs.map(ref => ref.url)).toEqual(['https://github.com/example/app/pull/7'])
  })
  it('groups three explicitly linked helpers with one business issue and accounts for every ID', () => {
    const tasks = [business(), helper('test'), helper('build'), helper('summary')]
    const details = Object.fromEntries(tasks.map(task => [task.id, { task, links: { parents: task.id === 'original' ? [] : ['original'], children: task.id === 'original' ? ['test', 'build', 'summary'] : [] } }]))
    const rows = projectPatrol(tasks, details)
    expect(rows).toHaveLength(1)
    expect(rows[0].ids.sort()).toEqual(tasks.map(task => task.id).sort())
    expect(rows[0].members).toHaveLength(4)
    expect(projectPatrol(tasks)).toHaveLength(4)
  })
  it('keeps an unfinished helper visible instead of hiding it behind a completed business issue', () => {
    const tasks = [{ ...business(), status: 'done' }, { ...helper('build'), status: 'blocked', body: helper('build').body + '\n还差：恢复打包环境' }]
    const details = Object.fromEntries(tasks.map(task => [task.id, { task, links: { parents: task.id === 'original' ? [] : ['original'], children: task.id === 'original' ? ['build'] : [] } }]))
    const rows = projectPatrol(tasks, details)
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.ids.includes('build'))).toMatchObject({ status: '受阻', gate: '恢复打包环境' })
    expect(rows.find(row => row.ids.includes('original'))).toMatchObject({ status: '已完成' })
  })
  it('never merges unrelated same-number issues across repositories', () => {
    const other = { ...business('other'), body: business().body!.replace('example/app', 'example/other') }
    expect(projectPatrol([business(), other])).toHaveLength(2)
  })
  it('keeps missing linkages independent and reports unavailable', async () => {
    const task = { ...helper('test'), link_counts: { parents: 1, children: 0 } }
    const result = await loadPatrolDetails([task], async () => { throw new Error('offline') })
    expect(result).toEqual({ details: {}, unavailable: true })
    expect(projectPatrol([business(), task], result.details)).toHaveLength(2)
  })
})
