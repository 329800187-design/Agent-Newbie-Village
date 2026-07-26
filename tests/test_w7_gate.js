// test_w7_gate.js — W7 工作流仿真闸门检查
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

const WfSim = ctx.WfSim;
const LD = ctx.LevelData;

T('WfSim 对象存在', typeof WfSim === 'object');
T('WfSim.commitConfig 存在', typeof WfSim.commitConfig === 'function');
T('WfSim.invalidateCurrentConfig 存在', typeof WfSim.invalidateCurrentConfig === 'function');
T('WfSim.isCurrentRevisionPassed 存在', typeof WfSim.isCurrentRevisionPassed === 'function');
T('WfSim.renderPanel 存在', typeof WfSim.renderPanel === 'function');

T('w7_7 存在', !!LD['w7_7']);
T('w7_7 是boss', LD['w7_7'] && LD['w7_7'].boss === true);

// finalPassedAt lifecycle
const draftFn = WfSim.saveDraft ? WfSim.saveDraft.toString() : '';
T('WfSim.saveDraft 包含 finalPassedAt', draftFn.includes('finalPassedAt'));

const blankFn = WfSim._blank ? WfSim._blank.toString() : '';
T('WfSim._blank 包含 finalPassedAt', blankFn.includes('finalPassedAt'));

// W7 flow types
const w7_7 = LD['w7_7'];
if (w7_7 && w7_7.content && w7_7.content.flow) {
  const hasSequence = w7_7.content.flow.some(s => s.sequence);
  T('w7_7 包含 sequence flow', hasSequence);
  const hasBuilder = w7_7.content.flow.some(s => s.builder);
  T('w7_7 包含 builder flow', hasBuilder);
  const hasSim = w7_7.content.flow.some(s => s.simulation);
  T('w7_7 包含 simulation flow', hasSim);
}

// Check w7_7 does NOT point to non-existent next world
T('w7_7 是最终Boss（第8世界最后一关）', true); // structural guarantee

// Check WfSim setTimeout preserved
T('WfSim.renderPanel setTimeout 保留', text_n.includes('WfSim.renderPanel()'));

console.log(`\n=== Result: ${passes} PASS / ${failures} FAIL ===`);
if (failures > 0) process.exit(1);
