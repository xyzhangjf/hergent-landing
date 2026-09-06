#!/usr/bin/env node
/**
 * 返利计算「前后端契约测试」（v113）
 *
 * 目的：证明「前端看到的数 == 后端内核算出的数」。
 * 做法：拿后端仓库同一份用例文件 server/tests/fixtures/rebate_cases.json，
 * 逐个走**真实 HTTP 接口**（就是前端调用的那些接口）算一遍，与用例期望值比对。
 * 前端不再自带算法，因此这套用例就是前后端之间唯一的口径契约 ——
 * 谁改了算法没同步用例，这里立刻红。
 *
 * 用法：
 *   node tests/rebate-calc.contract.mjs \
 *     --base https://hergent.cn --user mptest --pass 'Mptest@1' [--tenant 1]
 *
 * 环境变量（优先级低于命令行参数）：
 *   REBATE_BASE / REBATE_USER / REBATE_PASS / REBATE_TENANT / REBATE_FIXTURE
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const BASE = (arg('base', process.env.REBATE_BASE || 'http://127.0.0.1:8700')).replace(/\/$/, '')
const USER = arg('user', process.env.REBATE_USER || 'mptest')
const PASS = arg('pass', process.env.REBATE_PASS || 'Mptest@1')
const TENANT = arg('tenant', process.env.REBATE_TENANT || '1')
const FIXTURE = arg('fixture', process.env.REBATE_FIXTURE) ||
  path.resolve(__dirname, '../../hergent-erp/server/tests/fixtures/rebate_cases.json')

let TOKEN = ''

async function call(pathname, init = {}) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN
  headers['X-Tenant-Id'] = String(TENANT)
  const res = await fetch(BASE + pathname, { ...init, headers })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON */ }
  return { status: res.status, json, text }
}

async function login() {
  const r = await call('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  const d = r.json || {}
  TOKEN = d.token || d.access_token || (d.data && (d.data.token || d.data.access_token)) || ''
  if (!TOKEN) throw new Error(`登录失败 (${r.status}): ${r.text.slice(0, 200)}`)
}

async function runCase(c) {
  const ov = c.override || {}
  if (c.kind === 'contract') {
    const r = await call('/api/rebate-contracts/simulate', {
      method: 'POST',
      body: JSON.stringify({
        contract: c.input,
        achieved: c.basis,
        scale_type: ov.scale_type,
        rounding_mode: ov.rounding_mode,
        rounding_digits: ov.rounding_digits,
      }),
    })
    return { status: r.status, data: (r.json && r.json.data) || null, raw: r }
  }
  const r = await call('/api/rebate-rules/simulate-batch', {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        rule: c.input,
        basis_value: c.basis,
        scale_type: ov.scale_type,
        rounding_mode: ov.rounding_mode,
        rounding_digits: ov.rounding_digits,
      }],
      ref_date: c.as_of_date || '',
    }),
  })
  const results = r.json && r.json.data && r.json.data.results
  return { status: r.status, data: Array.isArray(results) ? results[0] : null, raw: r }
}

function main() {
  if (!fs.existsSync(FIXTURE)) {
    console.error(`✗ 找不到用例文件：${FIXTURE}`)
    console.error('  用 --fixture 指定路径，或设环境变量 REBATE_FIXTURE')
    process.exit(2)
  }
  const cases = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).cases
  login().then(async () => {
    const failed = []
    for (const c of cases) {
      let out
      try {
        out = await runCase(c)
      } catch (e) {
        failed.push(`  ✗ ${c.name}: 请求异常 ${e.message}`)
        continue
      }
      if (out.status !== 200 || !out.data || out.data.ok === false) {
        failed.push(`  ✗ ${c.name}: HTTP ${out.status} ${(out.raw && out.raw.text || '').slice(0, 160)}`)
        continue
      }
      for (const [key, want] of Object.entries(c.expect || {})) {
        const got = out.data[key]
        const ok = (typeof want === 'number' || typeof got === 'number')
          ? Math.abs(Number(got || 0) - Number(want)) < 0.005
          : got === want
        if (!ok) failed.push(`  ✗ ${c.name}: ${key} 期望 ${want}，实际 ${got}`)
      }
      if (!Array.isArray(out.data.steps) || !out.data.steps.length) {
        failed.push(`  ✗ ${c.name}: steps 为空，前端透明化面板无法渲染`)
      }
    }
    if (failed.length) {
      console.error(`返利前后端契约测试：${failed.length} 项不通过 / 共 ${cases.length} 条用例（${BASE}）`)
      console.error(failed.join('\n'))
      process.exit(1)
    }
    console.log(`返利前后端契约测试：全部通过（${cases.length} 条用例，${BASE}）`)
    process.exit(0)
  }).catch((e) => {
    console.error('✗ ' + e.message)
    process.exit(2)
  })
}

main()
