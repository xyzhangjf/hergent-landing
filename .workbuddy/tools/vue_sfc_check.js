// 定点 SFC 编译校验：python/node 均用绝对路径 require，免 NODE_PATH 依赖。
// 用法: node /tmp/vue_sfc_check.js <file.vue> [more.vue ...]
const path = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/@vue/compiler-sfc';
const { parse, compileScript, compileTemplate } = require(path);
const fs = require('fs');

let bad = 0;
for (const f of process.argv.slice(2)) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('READ_ERR ' + f + ' ' + e.message); bad++; continue; }
  try {
    const { descriptor, errors } = parse(src, { filename: f });
    if (errors && errors.length) {
      console.log('PARSE_ERR ' + f);
      errors.forEach(e => console.log('    ' + (e.message || e)));
      bad++; continue;
    }
    const id = 'x' + Math.random().toString(36).slice(2, 8);
    if (descriptor.scriptSetup || descriptor.script) compileScript(descriptor, { id });
    if (descriptor.template) {
      const r = compileTemplate({
        source: descriptor.template.content, filename: f, id,
        compilerOptions: { bindingMetadata: {} },
      });
      if (r.errors && r.errors.length) {
        console.log('TPL_ERR ' + f);
        r.errors.forEach(e => console.log('    ' + (e.message || e)));
        bad++; continue;
      }
    }
    console.log('OK  ' + f);
  } catch (e) {
    console.log('EXC ' + f + ' :: ' + e.message);
    bad++;
  }
}
console.log(bad === 0 ? 'SFC_ALL_OK' : ('SFC_BAD=' + bad));
process.exit(bad === 0 ? 0 : 1);
