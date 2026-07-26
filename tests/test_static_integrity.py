#!/usr/bin/env python3
"""静态完整性测试: 使用 Node VM 提取所有关卡元数据进行验证"""
import subprocess, json, sys, os

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SRC = BASE_DIR / "Agent新手村_当前版.html"

# Write JS probe to a temp file
tmp_dir = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp')
os.makedirs(tmp_dir, exist_ok=True)
js_path = os.path.join(tmp_dir, '_av_si_final.js')

js_code = """
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(process.argv[2], 'utf-8');
const m = html.match(/<script>([\\s\\S]*?)<\\/script>/);

function mock() {
  return new Proxy(function(){return mock();}, {
    get: (t, p) => {
      if (p === 'style') return mock();
      if (p === 'classList') return {add:()=>{},remove:()=>{},contains:()=>false};
      if (p === 'children') return [];
      if (p === 'length') return 0;
      if (p === 'value') return '';
      if (p === 'innerHTML') return '';
      if (p === 'textContent') return '';
      if (p === 'parentNode') return mock();
      if (p === 'tagName') return 'DIV';
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
doc.body = mock();

const ctx = {
  document: doc,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { reload: () => {}, href: 'file:///' },
  setTimeout: (fn) => { try { if (typeof fn==='function') fn(); } catch(e) {} },
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
  console.log(JSON.stringify({error: e.message})); process.exit(0);
}

const LD = ctx.LevelData || {};
const WORLDS = ctx.WORLDS || {};

const levels = [];
for (const [id, lv] of Object.entries(LD)) {
  if (lv && typeof lv === 'object' && (lv.type || lv.id)) {
    levels.push({id, ...lv});
  }
}

const flowTypes = {};
const flowTypeCounts = {};
levels.forEach(l => {
  const flow = l.content && l.content.flow;
  if (Array.isArray(flow)) {
    flow.forEach(step => {
      const keys = Object.keys(step).filter(k => 
        ['talk','try','cmd','sequence','trace','blocks','locate','builder','term','lessonCycle','simulation','quiz'].includes(k)
      );
      keys.forEach(k => {
        flowTypes[k] = true;
        flowTypeCounts[k] = (flowTypeCounts[k] || 0) + 1;
      });
    });
  }
});

const coreLevels = levels.filter(l => l.type === 'core');
const optionalLevels = levels.filter(l => l.optional === true);
const bossLevels = levels.filter(l => l.boss === true);
const dupIds = levels.map(l => l.id).filter((id, i, arr) => arr.indexOf(id) !== i);
const noTitle = levels.filter(l => !l.title).map(l => l.id);
const lcLevels = levels.filter(l => {
  const flow = l.content && l.content.flow;
  return Array.isArray(flow) && flow.some(s => s.lessonCycle);
}).map(l => l.id);

const worldKeys = Object.keys(WORLDS);
const c07 = LD['w1_2'];
const c08 = LD['w1_3'];

console.log(JSON.stringify({
  total: levels.length,
  core: coreLevels.length,
  optional: optionalLevels.length,
  boss: bossLevels.length,
  worlds: worldKeys.length,
  dupIds,
  noTitle,
  coveredFlowTypes: Object.keys(flowTypes),
  flowTypeCounts,
  lessonCycleLevels: lcLevels,
  c07Title: c07 ? c07.title : null,
  c08Title: c08 ? c08.title : null,
}));
"""

with open(js_path, 'w', encoding='utf-8') as f:
    f.write(js_code)

r = subprocess.run(['node', js_path, str(SRC)], capture_output=True, text=True, timeout=30)

try:
    data = json.loads(r.stdout.strip())
except:
    print("JSON parse error:", r.stdout[:500])
    if r.stderr: print("STDERR:", r.stderr[:500])
    sys.exit(1)

failures = []
def check(cond, msg, expected=None, actual=None):
    if not cond:
        msg2 = f"FAIL: {msg}"
        if expected is not None: msg2 += f" (expected={expected}, actual={actual})"
        failures.append(msg2)
        return False
    print(f"  PASS: {msg}")
    return True

print(f"LevelData 条目: {data['total']}")
check(data['total'] == 74, f"总量 74", 74, data['total'])
check(data['core'] == 70, f"core 70", 70, data['core'])
check(data['optional'] == 4, f"optional 4", 4, data['optional'])
check(data['boss'] == 8, f"boss 8", 8, data['boss'])
check(data['worlds'] == 8, f"世界数 8", 8, data['worlds'])
check(len(data['dupIds']) == 0, "无重复ID")
check(len(data['noTitle']) == 0, "全有标题")

required_flows = ['talk','try','cmd','sequence','trace','blocks','locate','builder','lessonCycle','simulation']
for ft in required_flows:
    check(ft in data['coveredFlowTypes'], f"flow '{ft}'")

check(len(data['lessonCycleLevels']) == 2, "lessonCycle 恰好2关")
check(data['c07Title'] == '看看周围', f"C07={data['c07Title']}")
check(data['c08Title'] == '去别的地方', f"C08={data['c08Title']}")

print(f"\n流类型: {data['flowTypeCounts']}")
print(f"{'='*50}")
if failures:
    print(f"FAIL: {len(failures)} failures")
    for f in failures: print(f"  {f}")
    sys.exit(1)
else:
    print("ALL PASS")
