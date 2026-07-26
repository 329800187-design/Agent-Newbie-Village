// _leveldata_hash.js — LevelData+WORLDS 归一化哈希（课程数据不变性验证）
// 用法: node _leveldata_hash.js <html文件> [输出文件]
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const htmlPath = process.argv[2] || 'Agent新手村_当前版.html';
const html = fs.readFileSync(htmlPath, 'utf-8').replace(/\r\n/g, '\n');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('NO SCRIPT'); process.exit(1); }
let js = m.group ? m.group(1) : m[1];
const gamePos = js.indexOf('var Game={');
const dataBlock = js.slice(0, gamePos);

const ctx = {
  document: { getElementById: () => ({ innerHTML: '', querySelectorAll: () => [], addEventListener: () => {}, classList:{add:()=>{},remove:()=>{}}, setAttribute:()=>{}, style:{} }),
    createElement: () => ({ style: {}, classList: { add: () => {} }, addEventListener: () => {}, appendChild: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} }, querySelectorAll: () => [], addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { reload: () => {} }, setTimeout: () => {}, setInterval: () => {}, clearTimeout: () => {},
  console: { log: () => {}, warn: () => {}, error: () => {} }
};
vm.createContext(ctx);
try { vm.runInContext(dataBlock, ctx); } catch (e) {}

const LD = ctx.LevelData || {};
const W = ctx.WORLDS || {};
if (!Object.keys(LD).length) { console.error('LevelData EMPTY'); process.exit(1); }

// 归一化: 稳定序列化（键按源码插入序——源码不动则稳定；double-stringify 防 undefined）
const payload = JSON.stringify({ LevelData: LD, WORLDS: W });
const sha = crypto.createHash('sha256').update(payload, 'utf-8').digest('hex');
const summary = {
  leveldata_worlds_sha256: sha,
  levels: Object.keys(LD).length,
  core: Object.values(LD).filter(x => x && x.type === 'core').length,
  optional: Object.values(LD).filter(x => x && x.optional === true).length,
  worlds: Object.keys(W).length,
  payload_chars: payload.length
};
const out = JSON.stringify(summary, null, 2);
console.log(out);
if (process.argv[3]) fs.writeFileSync(process.argv[3], out + '\n', 'utf-8');
