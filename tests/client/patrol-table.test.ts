// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
const api = vi.hoisted(() => ({ listTasks: vi.fn(), getTask: vi.fn(), profile: 'main', server: '', token: '' }))
vi.mock('@/api/hermes/kanban', () => ({ listTasks: api.listTasks, getTask: api.getTask }))
vi.mock('@/api/client', () => ({ getActiveProfileName: () => api.profile, getBaseUrlValue: () => api.server, getApiKey: () => api.token }))
vi.mock('@/stores/hermes/profiles', () => ({ useProfilesStore: () => ({ activeProfileName: 'main' }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, args?: any) => key + (args ? JSON.stringify(args) : '') }) }))
vi.mock('naive-ui', () => ({
 NInput: defineComponent({ props: ['value', 'size'], emits: ['update:value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' }),
 NSelect: defineComponent({ props: ['value', 'options'], emits: ['update:value'], template: '<select :value="value" @change="$emit(\'update:value\', $event.target.value)"><option v-for="o in options" :value="o.value">{{o.label}}</option></select>' }),
 NButton: defineComponent({ template: '<button><slot /></button>' }),
}))
import PatrolTable from '@/components/hermes/kanban/PatrolTable.vue'
const original = { id: 'original', title: 'Verbose task', status: 'review', body: '项目：Example\n看板问题：登录后页面空白\n还差：负责人确认\nPR：[OPEN](https://github.com/example/app/pull/7)' }
const helpers = ['test', 'build', 'summary'].map(id => ({ id, title: `检查 #7 ${id}`, status: 'done', body: '目标：检查 #7\nPR：[OPEN](https://github.com/example/app/pull/7)' }))
const wrappers: ReturnType<typeof mount>[] = []
const render = () => { const w = mount(PatrolTable, { props: { board: 'patrol' } }); wrappers.push(w); return w }
beforeEach(() => {
 vi.useFakeTimers(); vi.clearAllMocks(); api.profile = 'main'; api.server = ''; api.token = ''
 api.listTasks.mockResolvedValue([original, ...helpers, { id: 'done', title: 'Finished', status: 'done', body: '项目：Example\n看板问题：已解决问题' }])
 api.getTask.mockImplementation(async (id: string) => ({ task: [original, ...helpers].find(task => task.id === id), latest_summary: null, parents: id === 'original' ? [] : ['original'], children: id === 'original' ? helpers.map(task => task.id) : [] }))
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers() })
describe('actual mounted patrol table', () => {
 it('fetches the unfiltered board, groups helpers without link_counts, opens all records and leaves PR independent', async () => {
  const w = render(); await flushPromises()
  expect(api.listTasks).toHaveBeenCalledWith({ board: 'patrol', includeArchived: true })
  expect(api.getTask).toHaveBeenCalledTimes(4)
  expect(w.findAll('tbody tr')).toHaveLength(1)
  expect(w.findAll('th')).toHaveLength(5)
  await w.find('.patrol-issue').trigger('click')
  expect(w.emitted('open')?.[0]).toEqual(['original'])
  await w.find('a').trigger('click')
  expect(w.emitted('open')).toHaveLength(1)
  for (const button of w.findAll('.patrol-records button')) await button.trigger('click')
  expect(new Set(w.emitted('open')?.flat())).toEqual(new Set(['original', 'test', 'build', 'summary']))
  await w.find('select').setValue('all')
  expect(w.findAll('tbody tr')).toHaveLength(2)
  await w.find('input').setValue('已解决')
  expect(w.findAll('tbody tr')).toHaveLength(1)
  await w.find('select').setValue('已完成')
  expect(w.text()).toContain('已解决问题')
 })
 it('keeps independent records and reports linkage failure honestly', async () => {
  api.getTask.mockRejectedValue(new Error('offline'))
  const w = render(); await flushPromises(); await w.find('select').setValue('all')
  expect(w.findAll('tbody tr')).toHaveLength(5)
  expect(w.text()).toContain('kanban.compact.unavailable')
 })
 it('clears search and selection on connection change and rejects a stale response', async () => {
  let resolve!: (value: any) => void
  api.listTasks.mockReturnValueOnce(new Promise(r => { resolve = r }))
  const w = render(); await w.find('input').setValue('old')
  api.server = 'new-server'; await vi.advanceTimersByTimeAsync(500); await flushPromises()
  resolve([{ ...original, body: '项目：Stale\n看板问题：Stale' }]); await flushPromises()
  expect(w.find('input').element.value).toBe('')
  expect(w.emitted('reset')!.length).toBeGreaterThan(1)
  expect(w.text()).not.toContain('Stale')
  expect(w.text()).toContain('登录后页面空白')
 })
 it('shows loading, error and retry without claiming an empty successful result', async () => {
  api.listTasks.mockRejectedValueOnce(new Error('offline'))
  const w = render(); expect(w.text()).toContain('kanban.compact.loading'); await flushPromises()
  expect(w.find('[role="alert"]').text()).toContain('kanban.compact.error')
  expect(w.text()).not.toContain('kanban.compact.empty')
  await w.find('[role="alert"] button').trigger('click'); await flushPromises()
  expect(w.text()).toContain('登录后页面空白')
 })
})
