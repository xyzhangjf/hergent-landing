import { parse, compileTemplate } from '@vue/compiler-sfc'
import fs from 'fs'
const src = fs.readFileSync('src/pages/Forecast.vue','utf8')
const sfc = parse(src, { filename: 'Forecast.vue' })
const tpl = sfc.descriptor.template
const res = compileTemplate({
  source: tpl.content,
  filename: 'Forecast.vue',
  id: 'x',
  compilerOptions: { mode: 'module' }
})
console.log('compileTemplate errors:', res.errors.length)
for (const e of res.errors) console.log('  ', e.message, JSON.stringify(e.loc))
