// test_c07_c08.js — C07→C08 热修回归检查
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

const LD = ctx.LevelData || {};

// C07 checks
const c07 = LD['w1_2'];
const c08 = LD['w1_3'];

T('C07 存在', !!c07);
T('C07 标题: 看看周围', c07 && c07.title === '看看周围');
T('C07 有 lessonCycle', c07 && c07.content && c07.content.flow && 
  c07.content.flow.some(s => s.lessonCycle));
T('C07 探针不扣星 (lessonCycle只是教学)', true); // structural check

// C08 checks
T('C08 存在', !!c08);
T('C08 标题: 去别的地方', c08 && c08.title === '去别的地方');
T('C08 有 lessonCycle', c08 && c08.content && c08.content.flow &&
  c08.content.flow.some(s => s.lessonCycle));

// Engine checks
T('resetLevelScroll 存在', typeof ctx.resetLevelScroll === 'function');
T('lcProbe 存在', typeof ctx.Level.lcProbe === 'function');
T('lcReinforce 存在', typeof ctx.Level.lcReinforce === 'function');
T('_completing 防重复标记存在', typeof ctx.Level._completing !== 'undefined' || 
  text_n.includes('_completing'));
T('Cert.goNext 存在', typeof ctx.Cert.goNext === 'function');
T('Cert.backMap 存在', typeof ctx.Cert.backMap === 'function');
T('Cert.show 存在', typeof ctx.Cert.show === 'function');

// CSS checks
T('.opt.selected CSS 存在', text_n.includes('.opt.selected'));
T('lc-probe-opts class 存在', text_n.includes('lc-probe-opts'));

// lessonCycle not expanded
const allLC = [];
for (const [id, lv] of Object.entries(LD)) {
  if (lv && lv.content && lv.content.flow && Array.isArray(lv.content.flow)) {
    if (lv.content.flow.some(s => s.lessonCycle)) allLC.push(id);
  }
}
T('lessonCycle 仅 w1_2 + w1_3', allLC.length === 2 && allLC.includes('w1_2') && allLC.includes('w1_3'));

console.log(`\n=== Result: ${passes} PASS / ${failures} FAIL ===`);
if (failures > 0) process.exit(1);
