const fs = require('fs');
const DIR = 'src/composables';
function load(file, stubs, fnName, args) {
  let src = fs.readFileSync(DIR + '/' + file, 'utf8');
  src = src.replace(/^import .*$/gm, '');
  src = src.replace(/export function/g, 'function');
  const names = Object.keys(stubs), vals = Object.values(stubs);
  const factory = new Function(...names, src + '\nreturn ' + fnName + ';');
  const fn = factory(...vals);
  const ret = fn(...args);
  return ret;
}
const stubs = {
  ref: (v) => ({ value: v }),
  reactive: (o) => o,
  store: { prompt: async () => '', confirm: async () => true },
  toast: () => {},
  auth: { user: { id: 1, name: 't' } },
  forecastApi: {},
  forecastApproveApi: {},
  columnSchemeApi: {},
  XLSX: { utils: {}, writeFile() {} },
  rowSum: () => 0,
  rowSumOf: () => 0,
};
const cross = { value: { period: null, rows: [], units: [] } };
const cases = [
  ['useForecastApproval.js', 'useForecastApproval', [cross], ['subStatus','subBy','subAt','subReason','subOpen','SUB_LABEL','loadSubmission','doSubmit','doApprove','doReject','doRevise']],
  ['useCloudNotes.js', 'useCloudNotes', [cross], ['notesMap','loadNotes','saveNotes','rowNote','setRowNote','loadCloudNotes','saveCloudNotes']],
  ['useForecastSnapshot.js', 'useForecastSnapshot', [cross, (x)=>x], ['snaps','snapCompare','loadSnaps','saveSnap','diffSnap','cellDiff','exportDiffXlsx']],
  ['useForecastMoq.js', 'useForecastMoq', [cross, ()=>0], ['showMoq','loadMoq','rowMoq','moqWarn','syncMoq']],
  ['useForecastYoY.js', 'useForecastYoY', [cross, {value:[]}], ['yoyOn','loadYoY','yoyQty','yoyPct']],
  ['useForecastSchemes.js', 'useForecastSchemes', [(x)=>x, {value:[]}, {value:{}}, ()=>{}], ['schemes','schemeName','schemeSaveName','loadSchemes','saveScheme','applyScheme','delScheme']],
];
let fail = 0;
for (const [file, fn, args, need] of cases) {
  try {
    const ret = load(file, stubs, fn, args);
    if (ret === undefined || ret === null) { console.log('🔴 ' + file + ': 返回 ' + ret); fail++; continue; }
    const missing = need.filter(k => !(k in ret));
    if (missing.length) { console.log('🔴 ' + file + ': 缺键 ' + missing.join(',')); fail++; }
    else console.log('✅ ' + file + ' → 返回对象，键齐全（' + Object.keys(ret).length + ' 个）');
  } catch (e) { console.log('🔴 ' + file + ': 运行异常 ' + e.message); fail++; }
}
console.log(fail === 0 ? '\n全部通过' : '\n有 ' + fail + ' 个失败');
process.exit(fail === 0 ? 0 : 1);
