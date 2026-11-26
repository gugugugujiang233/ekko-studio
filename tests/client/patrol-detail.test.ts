import { describe, expect, it } from 'vitest'
import { projectPatrolDetail } from '@/utils/hermes/patrol-detail'

describe('concise patrol detail', () => {
  it('keeps current negation, omits long prose whole and ignores all history and latest_summary', () => {
    const detail = projectPatrolDetail({ id: 'a', status: 'review', title: 'Example｜页面空白; more metadata', body: '项目：Example\n还差：等待确认\n## 处理\n- 修复已提交，尚未上线\n## 验证结果\n' + '本地测试通过'.repeat(20) + '，但生产未验证\n<details>\n验证：生产成功\nAPM：https://example.com/old', latest_summary: '生产已成功' })
    expect(detail.title).toBe('页面空白')
    expect(detail.treatment).toBe('修复已提交，尚未上线')
    expect(detail.validation).toBeNull()
    expect(detail.evidence).toEqual([])
  })
  it.each(['测试复核', '打包', '汇总'])('cleans helper action title %s without inventing a business problem', action => {
    const detail = projectPatrolDetail({ id: 'helper', status: 'done', title: `【检查】Example｜#8 ${action} HEAD abcdef123456 42 tests; session-uuid`, body: '目标：检查 #8\n还差：新PR待创建' })
    expect(detail.title).toBe(action)
    expect(detail.gate).toBe('—')
  })
  it('does not execute unsafe markup or offer non-http evidence links', () => {
    const detail = projectPatrolDetail({ id: 'a', status: 'blocked', title: 'Fallback', body: '看板问题：<script>alert(1)</script>页面 <b>空白</b>\nAPM：[unsafe](javascript:alert(1))' })
    expect(detail.title).toBe('页面 空白')
    expect(detail.evidence).toEqual([])
  })
})
