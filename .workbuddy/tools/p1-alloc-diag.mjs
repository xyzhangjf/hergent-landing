/**
 * 诊断：演示账号到底能不能走到「分摊」按钮这一步。
 * 只回答三件事：① 有没有「改单」按钮、是否 disabled ② 点进去有没有编辑态输入框
 * ③ 页面上到底渲染出几个 .pt-alloc-btn。不改动任何生产数据。
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE + '/#/login', 5000)
  await page.eval(`
    (function () {
      const b = [...document.querySelectorAll('button')]
        .find(x => (x.textContent || '').includes('先看看演示效果'));
      if (b) b.click();
      return !!b;
    })()
  `)
  await sleep(4000)
  await page.eval(`location.hash = '#/forecast'; true`)
  await sleep(9000)

  const diag1 = await page.eval(`
    (function () {
      const btns = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean);
      const edit = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('改单'));
      return {
        rows: document.querySelectorAll('table tr').length,
        inputs: document.querySelectorAll('input.cell-input').length,
        hasEditBtn: !!edit,
        editDisabled: edit ? !!edit.disabled : null,
        editText: edit ? (edit.textContent||'').trim() : '',
        btns: btns.slice(0, 25),
      };
    })()
  `).catch((e) => ({ err: e.message }))
  console.log('【进预报页后】', JSON.stringify(diag1, null, 1).slice(0, 900))

  if (diag1.hasEditBtn && !diag1.editDisabled) {
    await page.eval(`
      (function () {
        const b = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('改单'));
        if (b) b.click();
        return !!b;
      })()
    `)
    await sleep(6000)
  }
  const diag2 = await page.eval(`
    (function () {
      return {
        hash: location.hash,
        rows: document.querySelectorAll('table tr').length,
        inputs: document.querySelectorAll('input.cell-input').length,
        allocBtns: document.querySelectorAll('.pt-alloc-btn').length,
        allocCell: document.querySelectorAll('.pt-xmtd').length,
        saveBtn: [...document.querySelectorAll('button')].filter(b=>/保存|定稿/.test(b.textContent||'')).length,
      };
    })()
  `).catch((e) => ({ err: e.message }))
  console.log('【点改单后】', JSON.stringify(diag2, null, 1).slice(0, 600))
} catch (e) {
  console.log('探针异常:', e && e.message)
} finally {
  await browser.close()
}
