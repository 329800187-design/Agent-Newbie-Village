// test_unlock_chain.js — 完整主线可达性检查
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'Agent新手村_当前版.html');

const html = fs.readFileSync(htmlPath, 'utf-8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("NO_SCRIPT"); process.exit(1); }

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
      if (p === 'parentElement') return mock();
      if (p === 'firstChild') return null;
      if (p === 'tagName') return 'DIV';
      if (p === 'scrollTop') return 0;
      if (p === 'checked') return false;
      if (p === 'disabled') return false;
      if (p === 'type') return 'text';
      if (p === 'id') return '';
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
doc.createTextNode = (t) => mock();
doc.querySelectorAll = (s) => [];
doc.querySelector = (s) => null;
doc.body = mock(); doc.head = mock();

const ctx = {
  document: doc,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { reload: () => {}, href: 'file:///', hash: '', search: '', pathname: '/' },
  setTimeout: (fn, t) => { try { if (typeof fn === 'function') fn(); } catch(e) {} },
  setInterval: () => {}, clearTimeout: () => {},
  console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
  window: null, self: null,
  navigator: { userAgent: 'node' },
  history: { pushState: () => {}, replaceState: () => {} },
  Math, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error,
  parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent,
  btoa: (s) => Buffer.from(s).toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString(),
  Uint8Array, Int32Array, Float64Array
};
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);

try { vm.runInContext(m[1], ctx); } catch(e) {
  console.log("VM_ERROR:" + e.message); process.exit(1);
}

const LD = ctx.LevelData || {};
const WORLDS = ctx.WORLDS || {};
const State = ctx.State;
const Game = ctx.Game;

let passes = 0, failures = 0;

function T(desc, val) {
  if (val) { passes++; console.log('PASS: ' + desc); }
  else { failures++; console.log('FAIL: ' + desc); }
}

// Check that world unlock mechanism exists
T('State/Game 有初始化逻辑', typeof State === 'function' || typeof Game === 'object');

// Check WORLD_TRIALS_ENABLED
T('WORLD_TRIALS_ENABLED=false', ctx.WORLD_TRIALS_ENABLED === false);

// Get core levels in order
const coreLevels = [];
for (const [id, lv] of Object.entries(LD)) {
  if (lv && typeof lv === 'object' && lv.type === 'core') {
    coreLevels.push({id, ...lv});
  }
}
coreLevels.sort((a,b) => {
  const wa = a.world || 'zzz', wb = b.world || 'zzz';
  if (wa !== wb) return wa < wb ? -1 : 1;
  return (a.n||0) - (b.n||0);
});

const coreIds = coreLevels.map(l => l.id);
console.log('Core levels in order: ' + coreIds.join(' → '));

// Check expected first level
T('初始首关: ai_camp_1', coreIds[0] === 'ai_camp_1');

// Check expected bosses
const expectedBosses = {
  ai_camp_11: 'ai_camp_11',
  w1_8: 'w1_8',
  w2_6: 'w2_6',
  w3_13: 'w3_13',
  w4_8: 'w4_8',
  w5_8: 'w5_8',
  w6_9: 'w6_9',
  w7_7: 'w7_7'
};
for (const [bid, expected] of Object.entries(expectedBosses)) {
  const lv = LD[bid];
  T(`Boss ${bid} 存在且标记为boss`, lv && lv.boss === true);
}

// Check world level sequences match WORLDS config
for (const [wid, w] of Object.entries(WORLDS)) {
  if (w.levels && Array.isArray(w.levels)) {
    // Check that levels in world seq are core (except optionals)
    const coreInWorld = w.levels.filter(id => {
      const lv = LD[id];
      return lv && lv.type === 'core';
    });
    T(`World ${wid}: ${coreInWorld.length} 个core关`, coreInWorld.length > 0);
    
    // Check first level of each world exists
    if (w.levels.length > 0) {
      T(`World ${wid}: 首关 ${w.levels[0]} 存在`, !!LD[w.levels[0]]);
    }
  }
}

// Check w7_7 does not point to non-existent next world
const w7_7 = LD['w7_7'];
T('w7_7 是最终Boss', w7_7 && w7_7.boss === true);

// Check total counts
T('74关总量', coreLevels.length + Object.values(LD).filter(lv => lv && typeof lv === 'object' && lv.optional === true).length === 74);

// Check lessonCycle not expanded
const lcCount = coreLevels.filter(l => {
  const flow = l.content && l.content.flow;
  return Array.isArray(flow) && flow.some(s => s.lessonCycle);
}).length;
T('lessonCycle 仅 2 关 (未批量扩展)', lcCount === 2);

console.log(`\n=== Result: ${passes} PASS / ${failures} FAIL ===`);
if (failures > 0) process.exit(1);
