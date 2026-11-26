<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { getTask, listTasks } from '@/api/hermes/kanban'
import { getActiveProfileName, getApiKey, getBaseUrlValue } from '@/api/client'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { loadPatrolDetails, projectPatrol, type PatrolTask } from '@/utils/hermes/patrol-model'

const props = defineProps<{ board: string; revision?: unknown }>()
const emit = defineEmits<{ open: [id: string]; reset: [] }>()
const { t } = useI18n()
const profiles = useProfilesStore()
const tasks = ref<PatrolTask[]>([])
const details = ref<Awaited<ReturnType<typeof loadPatrolDetails>>['details']>({})
const loading = ref(true)
const error = ref(false)
const unavailable = ref(false)
const search = ref('')
const status = ref('active')
let generation = 0
let disposed = false
const contextKey = () => JSON.stringify([props.board, profiles.activeProfileName, getActiveProfileName(), getBaseUrlValue(), getApiKey()])
let context = contextKey()
const rows = computed(() => projectPatrol(tasks.value, details.value))
const visibleRows = computed(() => rows.value.filter(row => {
  const terminal = row.ids.every(id => ['done', 'archived'].includes(tasks.value.find(task => task.id === id)?.status || ''))
  return (status.value === 'all' || (status.value === 'active' ? !terminal : row.status === status.value))
    && row.search.includes(search.value.trim().toLowerCase())
}))
const options = computed(() => [
  { label: t('kanban.compact.active'), value: 'active' },
  { label: t('kanban.compact.all'), value: 'all' },
  ...[...new Set(rows.value.map(row => row.status))].map(value => ({ label: value, value })),
])

function reset() {
  generation++
  tasks.value = []
  details.value = {}
  search.value = ''
  status.value = 'active'
  unavailable.value = false
  error.value = false
  emit('reset')
}

async function refresh() {
  const key = contextKey()
  if (key !== context) { context = key; reset() }
  const current = ++generation
  const board = props.board
  const valid = () => !disposed && current === generation && key === contextKey()
  loading.value = true
  error.value = false
  try {
    const cohort = await listTasks({ board, includeArchived: true })
    if (!valid()) return
    tasks.value = cohort
    details.value = {}
    // Older Studio lists omit link_counts. Probe only likely helper titles,
    // then follow their explicit links, never infer relationships from PR numbers.
    const seeds = cohort.filter(task => !/(?:看板问题[：:]|#{1,3}\s*问题描述)/.test((task.body || '').split(/<details\b/i, 1)[0]) && /测试|检查|打包|证据|汇总|回写|复核|构建|test|build|summary/i.test(task.title))
    const candidates = cohort.map(task => seeds.includes(task) ? { ...task, link_counts: { parents: 1, children: 0 } } : task)
    const fetchDetail = async (id: string) => {
      if (!valid()) throw new Error('Stale patrol request')
      const detail = await getTask(id, { board })
      if (!valid()) throw new Error('Stale patrol request')
      if (!Array.isArray(detail.parents) || !Array.isArray(detail.children)) throw new Error('Linkage unavailable')
      return { task: { ...detail.task, latest_summary: detail.latest_summary }, links: { parents: detail.parents, children: detail.children } }
    }
    const first = await loadPatrolDetails(candidates, fetchDetail)
    if (!valid()) return
    const linked = new Set(Object.values(first.details).flatMap(detail => [...detail.links.parents, ...detail.links.children]))
    const remaining = cohort.filter(task => linked.has(task.id) && !first.details[task.id]).map(task => ({ ...task, link_counts: { parents: 1, children: 0 } }))
    const second = await loadPatrolDetails(remaining, fetchDetail)
    if (!valid()) return
    details.value = { ...first.details, ...second.details }
    tasks.value = cohort.map(task => details.value[task.id]?.task || task)
    unavailable.value = first.unavailable || second.unavailable || [...linked].some(id => !details.value[id])
  } catch {
    if (valid()) { error.value = true; tasks.value = []; details.value = {} }
  } finally {
    if (valid()) loading.value = false
  }
}

watch(() => [props.board, profiles.activeProfileName], () => { context = contextKey(); reset(); void refresh() }, { immediate: true, flush: 'sync' })
watch(() => props.revision, () => { void refresh() })
// Connection credentials live in localStorage, which is not reactive. Check the
// request context before every result and promptly clear selection on changes.
const timer = setInterval(() => {
  if (contextKey() !== context) { context = contextKey(); reset(); void refresh() }
}, 500)
onUnmounted(() => { disposed = true; generation++; clearInterval(timer) })
</script>

<template>
  <section class="patrol-table" data-theme-surface="card">
    <div class="patrol-toolbar">
      <NInput v-model:value="search" size="small" :placeholder="t('kanban.compact.search')" :aria-label="t('kanban.compact.search')" class="patrol-search" />
      <NSelect v-model:value="status" size="small" :options="options" :aria-label="t('kanban.compact.status')" class="patrol-status" />
      <span class="patrol-count">{{ t('kanban.compact.count', { count: visibleRows.length }) }}</span>
    </div>
    <p v-if="error" role="alert">{{ t('kanban.compact.error') }} <NButton size="small" @click="refresh">{{ t('kanban.compact.retry') }}</NButton></p>
    <p v-else-if="loading" role="status">{{ t('kanban.compact.loading') }}</p>
    <p v-if="unavailable" class="patrol-note" role="status">{{ t('kanban.compact.unavailable') }}</p>
    <div class="patrol-scroll" :aria-busy="loading">
      <table>
        <thead><tr><th v-for="key in ['project', 'issue', 'status', 'gate', 'pr']" :key="key" scope="col">{{ t(`kanban.compact.${key}`) }}</th></tr></thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="row.ids.join(':')">
            <td>{{ row.project }}</td>
            <td>
              <button class="patrol-issue" :title="row.issueFull" @click="emit('open', row.ids[0])">{{ row.issue }}</button>
              <details v-if="row.ids.length > 1" class="patrol-records">
                <summary>{{ t('kanban.compact.records', { count: row.ids.length }) }}</summary>
                <button v-for="(id, index) in row.ids" :key="id" class="patrol-issue" @click="emit('open', id)">{{ row.members?.find(member => member.id === id)?.title || t('kanban.compact.record', { index: index + 1 }) }}<template v-if="row.members?.find(member => member.id === id)"> · {{ row.members.find(member => member.id === id)?.status }} · {{ row.members.find(member => member.id === id)?.gate }}</template></button>
              </details>
            </td>
            <td>{{ row.status }}</td>
            <td :title="row.gateFull">{{ row.gate }}</td>
            <td><a v-for="pr in row.refs" :key="pr.url" :href="pr.url" target="_blank" rel="noopener noreferrer" :title="`${pr.repo} · ${pr.state}`">#{{ pr.number }}</a><span v-if="!row.refs.length">—</span></td>
          </tr>
          <tr v-if="!loading && !error && !visibleRows.length"><td colspan="5">{{ t('kanban.compact.empty') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;
.patrol-table { margin: 12px 20px; min-height: 0; display: flex; flex-direction: column; color: $text-primary; }
.patrol-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px; }
.patrol-search { width: 240px; max-width: 100%; }
.patrol-status { width: 150px; }
.patrol-count { white-space: nowrap; }
.patrol-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: inherit; }
th, td { padding: 8px 12px; border-bottom: var(--border-width, 1px) solid $border-light; vertical-align: top; }
th { font-weight: 600; white-space: nowrap; }
.patrol-issue { appearance: none; border: 0; padding: 0; background: transparent; color: $text-primary; font: inherit; text-align: left; cursor: pointer; }
.patrol-issue:hover { text-decoration: underline; }
.patrol-issue:focus-visible { outline: 2px solid $accent-primary; outline-offset: 2px; }
a { color: $accent-primary; display: inline-block; margin-right: 8px; }
.patrol-note, .patrol-records { color: $text-secondary; font-size: 12px; }
.patrol-records .patrol-issue { display: block; margin-top: 6px; }
p { padding: 0 12px; }
</style>
