// _export_asset_map.js — 从当前版提取 关卡->素材 映射 + WORLDS 映射 (manifest 数据源)
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(process.argv[2] || 'Agent新手村_当前版.html', 'utf-8').replace(/\r\n/g, '\n');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const js = m[1];
const dataBlock = js.slice(0, js.indexOf('var Game={'));
const ctx = {
  document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add: () => {} }, addEventListener: () => {}, appendChild: () => {} }), body: { appendChild: () => {} }, querySelectorAll: () => [], addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { reload: () => {} }, setTimeout: () => {}, setInterval: () => {}, clearTimeout: () => {},
  console: { log: () => {}, warn: () => {}, error: () => {} }
};
vm.createContext(ctx);
try { vm.runInContext(dataBlock, ctx); } catch (e) {}
const LD = ctx.LevelData, W = ctx.WORLDS;
const levels = [];
for (const [id, lv] of Object.entries(LD)) {
  levels.push({ id, world: lv.world, a: lv.a, boss: !!lv.boss, type: lv.type, optional: !!lv.optional });
}
const worlds = {};
for (const [wk, w] of Object.entries(W)) {
  worlds[wk] = { name: w.name, bg: w.bg, boss: w.boss, certTag: w.cert.tag, certId: w.cert.id, levels: w.levels };
}
// 运行时静态引用 (字面路径)
const staticRefs = [];
const re = /assets\/[A-Za-z0-9_\/.]+\.png/g;
let mm; const set = new Set();
while ((mm = re.exec(html)) !== null) set.add(mm[0]);
// 动态 onboard: Onboard._illu -> K01/K02/K03
['K01','K02','K03'].forEach(k => set.add('assets/onboard/' + k + '.png'));
fs.writeFileSync(process.argv[3] || 'C:/Users/lenovo/_asset_map.json',
  JSON.stringify({ levels, worlds, staticRefs: [...set].sort() }, null, 1), 'utf-8');
console.log('levels=' + levels.length + ' worlds=' + Object.keys(worlds).length + ' staticRefs=' + set.size);
