import { parse } from '@vue/compiler-sfc'
import fs from 'fs'
const src = fs.readFileSync('src/pages/Forecast.vue','utf8')
try {
  const sfc = parse(src, { filename: 'Forecast.vue' })
  console.log('SFC PARSE OK')
  console.log('blocks:', { template: !!sfc.descriptor.template, scriptSetup: !!sfc.descriptor.scriptSetup, styles: sfc.descriptor.styles.length })
  if (sfc.descriptor.template) {
    console.log('template attrs:', JSON.stringify(sfc.descriptor.template.attrs))
    console.log('template content length:', sfc.descriptor.template.content.length)
    const tc = sfc.descriptor.template.content
    console.log('template last 120 chars:', JSON.stringify(tc.slice(-120)))
  }
} catch (e) {
  console.log('SFC PARSE ERROR:', e.message)
  if (e.loc) console.log('loc:', JSON.stringify(e.loc))
}
