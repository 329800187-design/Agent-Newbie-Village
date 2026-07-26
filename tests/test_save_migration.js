// test_save_migration.js — 存档迁移破坏性测试
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
      if (p === 'tagName') return 'DIV';
      if (p === 'scrollTop') return 0;
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
  Math, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error,
  parseInt, parseFloat, btoa: (s) => Buffer.from(s).toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString(),
  Uint8Array, Int32Array, Float64Array
};
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);

try { vm.runInContext(m[1], ctx); } catch(e) {
  console.log("VM_ERROR:" + e.message); process.exit(1);
}

const migrate = ctx.migrateSaveData;
const normalize = ctx.normalizeLearnerProfile;

let passes = 0, failures = 0;

function T(desc, fn) {
  try {
    const ok = fn();
    if (ok) { passes++; console.log('PASS: ' + desc); }
    else { failures++; console.log('FAIL: ' + desc + ' — returned false'); }
  } catch(e) {
    failures++; console.log('FAIL: ' + desc + ' — ' + e.message);
  }
}

if (!migrate) { console.log('FAIL: migrateSaveData missing'); process.exit(1); }

T('空存档 returns null/undefined', () => {
  const r = migrate(null);
  return r === null || r === undefined;
});

T('完全空存档 {}', () => {
  const r = migrate({});
  return r !== null;
});

// Fixed: use schemaVersion not _v for v1 old schema
T('旧schema (schemaVersion:1)', () => {
  const r = migrate({schemaVersion: 1});
  return r && r.schemaVersion === 3;
});

T('缺learnerProfile', () => {
  const r = migrate({schemaVersion: 2, levels: {}});
  return r && r.learnerProfile;
});

T('role=guardian强制转learner', () => {
  if (!normalize) return false;
  const r = normalize({role: 'guardian', learningTrack: 'beginner'});
  return r.role === 'learner' && r.learningTrack === 'beginner';
});

T('非法learningTrack', () => {
  if (!normalize) return false;
  const r = normalize({role: 'learner', learningTrack: 'invalid'});
  return r.learningTrack === 'beginner';
});

T('XP为字符串', () => {
  const r = migrate({schemaVersion: 2, xp: "100", levels: {}});
  return r !== null;
});

T('重复achievements', () => {
  const r = migrate({schemaVersion: 2, levels: {}, achievements: ['ach1', 'ach1']});
  return r !== null;
});

T('未知关卡ID', () => {
  const r = migrate({schemaVersion: 2, levels: {nonexistent_level: {completed: true}}});
  return r !== null;
});

T('损坏JSON 不崩溃', () => {
  try { migrate({schemaVersion: 2, levels: {ai_camp_1: true}}); return true; }
  catch(e) { return false; }
});

T('SCHEMA_VERSION=3', () => {
  return ctx.SCHEMA_VERSION === 3;
});

T('迁移幂等', () => {
  const d1 = migrate({schemaVersion: 2, levels: {ai_camp_1: {completed: true}}, xp: 50});
  const d2 = migrate(d1);
  return d1 && d2 && d1.schemaVersion === d2.schemaVersion;
});

T('不凭空增加XP', () => {
  const r = migrate({schemaVersion: 2, levels: {}, xp: 0});
  return r && (r.xp === 0 || r.xp === undefined);
});

T('不凭空完成关卡', () => {
  const r = migrate({schemaVersion: 2, levels: {ai_camp_1: {unlocked: true}}, xp: 0});
  return r && r.levels && !r.levels.ai_camp_1.completed;
});

console.log(`\n=== Result: ${passes} PASS / ${failures} FAIL ===`);
if (failures > 0) process.exit(1);
