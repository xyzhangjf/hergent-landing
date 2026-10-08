/* v301 前端判据单测：直接 import **真实模块** src/utils/md.js，用生产库里的**原文**做正反例。
   🔴 不复制正则到测试里（那等于自己测自己）—— 只 import。
   ⚠️ 本仓源码用**省略扩展名**的相对导入（Vite 才认），Node 原生解析会 ERR_MODULE_NOT_FOUND，
      所以先用 esbuild 打包再跑：
        node_modules/.bin/esbuild <本文件> --bundle --platform=node --format=esm \
          --outfile=/tmp/v301-media-test.mjs && node /tmp/v301-media-test.mjs
      静态导入还有一个好处：跑的就是**真实依赖树**（含 useCardTrigger → api/client）。 */
import { splitMedia, renderMd } from '../../hergent-cn-v2/src/utils/md.js'

const OUT = '/opt/hermes-tenants/hergent_t1/output/'

// —— 生产库原文（id=530：截图那一轮，恰好 2 行）——
const REAL_530 = [
  '这条你上一轮已经发过，我昨晚做完了——文件我再发一次，可能是没收到。',
  '',
  '1. AI 引擎当卖点——我反对。别把外部评价引进材料，改用「一个人+AI 产出 1,349 接口/367 表/260+ 迭代」当能力证明。',
  '2. 不做 ERP——同意。',
  '',
  '如果你不是没收到，而是对我某几条不认同，直接说哪几条，我改。',
  'MEDIA:' + OUT + 'BP-想法梳理与开发计划-v1.docx',
  'MEDIA:' + OUT + '25-BP正文-终版-v6.docx',
].join('\n')

// —— 生产库原文（id=524：一轮 4 行）——
const REAL_524 = [
  '两份最新稿在下面。',
  'MEDIA:' + OUT + 'BP-想法梳理与开发计划-v1.docx',
  'MEDIA:' + OUT + 'BP-想法梳理与开发计划-v1.md',
  'MEDIA:' + OUT + '25-BP正文-终版-v6.docx',
  'MEDIA:' + OUT + '25-BP正文-终版-v6.md',
].join('\n')

const NO_MEDIA = [
  '## 本周要点',
  '',
  '| 项 | 值 |',
  '| --- | --- |',
  '| 报单 | 12 家 |',
  '',
  '- 第一点',
  '- 第二点',
  '',
  '```json',
  '{"show":["loss"]}',
  '```',
].join('\n')

const CASES = [
  ['真实原文 id=530：两行 MEDIA', REAL_530, 2,
    ['BP-想法梳理与开发计划-v1.docx', '25-BP正文-终版-v6.docx'], true],
  ['真实原文 id=524：四行 MEDIA', REAL_524, 4,
    ['BP-想法梳理与开发计划-v1.docx', 'BP-想法梳理与开发计划-v1.md',
      '25-BP正文-终版-v6.docx', '25-BP正文-终版-v6.md'], true],
  ['反引号包裹', 'MEDIA:`' + OUT + 'a.docx`', 1, ['a.docx'], true],
  ['引号包裹', 'MEDIA:"' + OUT + 'a.docx"', 1, ['a.docx'], true],
  ['行内出现（不在行首）', '文件在 MEDIA:' + OUT + 'a.docx 里，看下。', 1, ['a.docx'], true],
  ['同一个文件标两次 ⇒ 去重', 'MEDIA:' + OUT + 'a.docx\nMEDIA:' + OUT + 'a.docx', 1, ['a.docx'], true],
  ['Windows 盘符路径', 'MEDIA:C:\\x\\a.docx', 1, ['a.docx'], true],
  ['反例：只是正文里提到 MEDIA:', 'MEDIA: 是内部标记，不要写进正文。', 0, [], false],
  ['反例：相对/穿越路径（非绝对）', 'MEDIA:../../etc/passwd.docx', 0, [], false],
  ['反例：未知扩展名', 'MEDIA:' + OUT + 'a.bin', 0, [], false],
  ['反例：普通 markdown（无 MEDIA）', NO_MEDIA, 0, [], false],
]

let fail = 0
console.log('① 用真实模块 src/utils/md.js 跑判据\n')
for (const [desc, src, wantN, wantNames, wantStripped] of CASES) {
  const r = splitMedia(src)
  const names = r.files.map((f) => f.name)
  const hasPath = r.text.includes('/opt/') || r.text.includes('MEDIA:')
  const okN = r.files.length === wantN
  const okNames = JSON.stringify(names) === JSON.stringify(wantNames)
  const okStrip = !wantStripped || !hasPath
  const ok = okN && okNames && okStrip
  if (!ok) fail++
  console.log('  ' + (ok ? '✅' : '❌') + '  ' + desc.padEnd(30) +
    ' 文件数=' + r.files.length + '/' + wantN +
    ' 名称=' + (okNames ? '对' : JSON.stringify(names)))
  if (!ok) {
    console.log('      文本残留 = ' + JSON.stringify(r.text.slice(-80)))
  }
}

console.log('\n② 无 MEDIA 的文本必须**逐字节不变**（不误伤普通回复）')
const same = splitMedia(NO_MEDIA).text === NO_MEDIA
console.log('  ' + (same ? '✅' : '❌') + '  NO_MEDIA 原文 === 输出：' + same)
if (!same) fail++

console.log('\n③ 流式半截：路径未打完就收尾，气泡里不该闪半截路径')
const stream = '好的，这就发。\nMEDIA:/opt/hermes-tenants/hergent_t1/out'
const rs = splitMedia(stream)
const okStream = rs.files.length === 0 && !rs.text.includes('MEDIA:')
console.log('  ' + (okStream ? '✅' : '❌') + '  半截标记已收掉，文本尾部 = ' + JSON.stringify(rs.text.slice(-14)))
if (!okStream) fail++

console.log('\n④ 与 renderMd 串联：渲染结果里不得出现服务器路径')
const html = renderMd(splitMedia(REAL_530).text)
const okHtml = !html.includes('/opt/') && !html.includes('MEDIA:') && html.includes('<ol>')
console.log('  ' + (okHtml ? '✅' : '❌') + '  html 无路径、列表仍渲染：' +
  (html.length + ' 字符'))
if (!okHtml) fail++

console.log('\n' + (fail ? '🔴 失败 ' + fail + ' 条' : '🟢 全部通过') + '（用例 ' + (CASES.length + 3) + ' 条）')
process.exit(fail ? 1 : 0)
