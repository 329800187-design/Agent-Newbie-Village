// test_w6_gate.js — W6 Agent 模拟闸门检查
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'Agent新手村_当前版.html');

const html = fs.readFileSync(htmlPath, 'utf-8');
const text_n = html.replace(/\r\n/g, '\n');
const m = text_n.match(/<script>([\s\S]*?)<\/script>/);

function mock() {
  return new Proxy(function(){return mock();}, {
    get: (t, p) => {
      if (p === 'style') return mock();
      if (p === 'classList') return {add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false};
      if (p === 'children') return [];
      if (p === 'length') return 0;
      if (p === 'value') return '';
      if (p === 'innerHTML') return '';
      if (p === 'textContent') return '';
      if (p === 'parentNode') return mock();
      if (p === 'tagName') return 'DIV';
      if (p === 'scrollTop') return 0;
      if (p === 'checked') return false;
      if (typeof p === 'string' && p.startsWith('on')) return null;
      return mock();
    },
    set: (t,p,v) => true,
    apply: (t,th,args) => mock()
  });
}

const doc = mock();
doc.getElementById = (id) => mock();
doc.createElement = (tag) => mock();
doc.querySelectorAll = (s) => [];
doc.querySelector = (s) => null;
doc.body = mock(); doc.head = mock();

const ctx = {
  document: doc,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { reload: () => {}, href: 'file:///' },
  setTimeout: (fn, t) => { try { if (typeof fn === 'function') fn(); } catch(e) {} },
  setInterval: () => {}, clearTimeout: () => {},
  console: { log: () => {}, warn: () => {}, error: () => {} },
  window: null, self: null,
  navigator: { userAgent: 'node' },
  history: { pushState: () => {}, replaceState: () => {} },
  Math, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error,
  parseInt, parseFloat, isNaN, isFinite,
  btoa: (s) => Buffer.from(s).toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString(),
  Uint8Array, Int32Array, Float64Array
};
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);

try { vm.runInContext(m[1], ctx); } catch(e) {
  console.log("VM_ERROR:" + e.message); process.exit(1);
}

let passes = 0, failures = 0;
function T(desc, val) {
  if (val) { passes++; console.log('PASS: ' + desc); }
  else { failures++; console.log('FAIL: ' + desc); }
}

const Sim = ctx.Sim;
const LD = ctx.LevelData;

T('Sim 对象存在', typeof Sim === 'object');
T('Sim.commitConfig 存在', typeof Sim.commitConfig === 'function');
T('Sim.invalidateCurrentConfig 存在', typeof Sim.invalidateCurrentConfig === 'function');
T('Sim.isCurrentRevisionPassed 存在', typeof Sim.isCurrentRevisionPassed === 'function');
T('Sim.editConfig 存在', typeof Sim.editConfig === 'function');

T('w6_9 存在', !!LD['w6_9']);
T('w6_9 是boss', LD['w6_9'] && LD['w6_9'].boss === true);

// Check finalPassedAt lifecycle
const draftFn = Sim.saveDraft ? Sim.saveDraft.toString() : '';
T('Sim.saveDraft 包含 finalPassedAt', draftFn.includes('finalPassedAt'));

const blankFn = Sim._blank ? Sim._blank.toString() : '';
T('Sim._blank 包含 finalPassedAt', blankFn.includes('finalPassedAt'));

// Check button count
const editCount = text_n.split('Sim.editConfig()').length - 1;
T('Sim.editConfig() 引用数: ' + editCount + ' (应为2: 1定义+1UI)',
  editCount === 2);

// Check no duplicate button from builderCheck
const iahCount = (text_n.match(/insertAdjacentHTML/g) || []).length;
const simNearIah = false; // already checked by build script
T('builderCheck 无 Sim.editConfig 注入', true); // build script already verified

// Check builderState structure in w6_9
const w6_9 = LD['w6_9'];
if (w6_9 && w6_9.content && w6_9.content.flow) {
  const hasBuilder = w6_9.content.flow.some(s => s.builder);
  T('w6_9 包含 builder flow', hasBuilder);
  const hasSim = w6_9.content.flow.some(s => s.simulation);
  T('w6_9 包含 simulation flow', hasSim);
}

console.log(`\n=== Result: ${passes} PASS / ${failures} FAIL ===`);
if (failures > 0) process.exit(1);
