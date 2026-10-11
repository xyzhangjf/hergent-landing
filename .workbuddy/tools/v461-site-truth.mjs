/**
 * v461-site-truth.mjs —— 确定「生产 SPA 到底在哪个路径、加载哪份 chunk」
 *
 * 背景：nginx 里 `hergent.cn` 的 root 是 /opt/hergent-cn-v2（首页是营销页），
 *       而 `location ^~ /admin/` alias 到 /opt/hergent-admin/。
 *       两支 index.html 引用的入口 chunk 不同、且 /assets/ 是**根绝对路径**。
 *       ⇒ 不靠读配置推断，直接开浏览器看**真实加载了哪些 URL、哪些 404**。
 *
 * 用法：node .workbuddy/tools/v461-site-truth.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const TARGETS = [
  'https://hergent.cn/',
  'https://hergent.cn/admin/',
]

async function probe(browser, url) {
  const page = await browser.newPage()
  await page.enable()
  await page.goto(url, 12000)
  await new Promise((r) => setTimeout(r, 2500))
  const info = await page.eval(`(function(){
    var out = { title: document.title, hasApp: !!document.querySelector('#app'),
                appChilds: (document.querySelector('#app')||{}).childElementCount || 0,
                scripts: [], css: [], bad: [] };
    [].forEach.call(document.querySelectorAll('script[src]'), function(s){ out.scripts.push(s.getAttribute('src')) });
    [].forEach.call(document.querySelectorAll('link[rel=stylesheet]'), function(l){ out.css.push(l.getAttribute('href')) });
    try {
      [].forEach.call(performance.getEntriesByType('resource'), function(e){
        if (e.initiatorType === 'script' || e.initiatorType === 'link' || e.initiatorType === 'css') {
          out.bad.push({ u: e.name.replace(location.origin,''), dur: Math.round(e.duration), size: e.transferSize });
        }
      })
    } catch(_) {}
    return JSON.stringify(out)
  })()`)
  let d = {}
  try { d = JSON.parse(info) } catch { d = { raw: info } }
  console.log('\n===== ' + url + ' =====')
  console.log('  title      :', d.title)
  console.log('  #app 存在  :', d.hasApp, ' 子节点数:', d.appChilds)
  console.log('  script src :', (d.scripts || []).join('  '))
  console.log('  css href   :', (d.css || []).join('  '))
  console.log('  资源加载(前 12):')
  ;(d.bad || []).slice(0, 12).forEach((r) => console.log('    -', r.u, '| size=' + r.size, '| ' + r.dur + 'ms'))
  await page.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v461-site/' + url.replace(/[^a-z0-9]/gi, '_') + '.png')
}

const browser = await launch({ headless: true, extraArgs: ['--autoplay-policy=no-user-gesture-required'] })
for (const t of TARGETS) {
  try { await probe(browser, t) } catch (e) { console.log('ERR ' + t + ': ' + e.message) }
}
await browser.close()
console.log('\n完成。')
