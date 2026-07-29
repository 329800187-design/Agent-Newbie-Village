// tests/test_level_experience_registry.js — R1.2 Round2 验收:
//   LevelExperienceRegistry 与课程数据完全解耦(独立结构), 仅含 7 个代表关卡,
//   不改变 LevelData / 课程哈希。
// 用法: node tests/test_level_experience_registry.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18931;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';
const TARGET_HASH = '56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895';
const EXPECTED_IDS = ['ai_camp_1', 'w1_1', 'w3_13', 'w4_4', 'w4_7', 'w6_9', 'w7_7'];

(async () => {
  const rep = new TestReport('test_level_experience_registry');

  // ═══ A. Node 侧: 课程数据哈希不变性(从 round2-dev 第一个 <script> 块计算) ═══
  try {
    const html = fs.readFileSync(path.join(ROOT, REL2), 'utf-8').replace(/\r\n/g, '\n');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('未找到 <script> 块');
    const js = m[1];
    const gp = js.indexOf('var Game={');
    if (gp < 0) throw new Error('未找到 var Game={ 分界');
    const dataBlock = js.slice(0, gp);
    const ctx = {
      document: { getElementById: () => ({ innerHTML: '', querySelectorAll: () => [], addEventListener: () => {}, classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, style: {} }), createElement: () => ({ style: {}, classList: { add: () => {} }, addEventListener: () => {}, appendChild: () => {} }), body: { appendChild: () => {}, removeChild: () => {} }, querySelectorAll: () => [], addEventListener: () => {} },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      location: { reload: () => {} }, setTimeout: () => {}, setInterval: () => {}, clearTimeout: () => {},
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };
    vm.createContext(ctx);
    try { vm.runInContext(dataBlock, ctx); } catch (e) {}
    const LD = ctx.LevelData || {};
    const W = ctx.WORLDS || {};
    if (!Object.keys(LD).length) throw new Error('LevelData 为空');
    const sha = crypto.createHash('sha256').update(JSON.stringify({ LevelData: LD, WORLDS: W }), 'utf-8').digest('hex');
    rep.assert(sha === TARGET_HASH, `课程数据哈希不变 (round2-dev=${sha.slice(0, 16)}… 目标=${TARGET_HASH.slice(0, 16)}…)`);
    rep.assert(Object.keys(LD).length === 74, `课程仍为 74 关 (${Object.keys(LD).length})`);
    rep.assert(Object.values(LD).filter(x => x && x.type === 'core').length === 70, `core 仍为 70 (${Object.values(LD).filter(x => x && x.type === 'core').length})`);
  } catch (e) {
    rep.fail('课程哈希计算异常: ' + e.message);
  }

  // ═══ B. 浏览器侧: 注册表结构 ═══
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    const info = await page.evaluate((EXPECTED_IDS) => {
      const R = window.LevelExperienceRegistry;
      const out = {
        exists: typeof R !== 'undefined' && R !== null,
        isObj: R && typeof R === 'object',
        keys: R ? Object.keys(R) : [],
        ldCount: Object.keys(LevelData).length,
        detail: {}
      };
      for (const id of EXPECTED_IDS) {
        const e = R && R[id];
        out.detail[id] = e ? {
          hasTemplate: !!e.templateType, hasTask: !!e.taskBrief,
          criteria: Array.isArray(e.completionCriteria) ? e.completionCriteria.length : -1,
          hasCap: !!e.capabilitySummary, hasNext: !!e.nextReason,
          tier: e.completionTier
        } : null;
      }
      return out;
    }, EXPECTED_IDS);

    rep.assert(info.exists && info.isObj, 'LevelExperienceRegistry 为对象且已暴露到 window');
    rep.assert(JSON.stringify(info.keys.slice().sort()) === JSON.stringify(EXPECTED_IDS.slice().sort()),
      `注册表恰含 7 个代表关卡 (${info.keys.join(',')})`);
    rep.assert(info.ldCount === 74, `LevelData 未被注册表改动, 仍 74 关 (${info.ldCount})`);

    for (const id of EXPECTED_IDS) {
      const d = info.detail[id];
      rep.assert(d && d.hasTemplate && d.hasTask && d.criteria > 0 && d.hasCap && d.hasNext,
        `${id} 含完整体验元数据(templateType/taskBrief/completionCriteria/capabilitySummary/nextReason)`);
    }

    // tier 映射
    const tiers = await page.evaluate(() => {
      const R = window.LevelExperienceRegistry;
      return {
        n: [R.ai_camp_1.completionTier, R.w1_1.completionTier],
        cap: [R.w3_13.completionTier, R.w4_4.completionTier, R.w4_7.completionTier],
        boss: R.w6_9.completionTier,
        world: R.w7_7.completionTier
      };
    });
    rep.assert(tiers.n.every(t => t === 'normal'), 'ai_camp_1 / w1_1 → normal 层');
    rep.assert(tiers.cap.every(t => t === 'capability'), 'w3_13 / w4_4 / w4_7 → capability 层');
    rep.assert(tiers.boss === 'boss', 'w6_9 → boss 层（综合任务 Boss 验收）');
    rep.assert(tiers.world === 'world', 'w7_7 → world 层');

    // 专属高亮字段
    const spec = await page.evaluate(() => {
      const R = window.LevelExperienceRegistry;
      return {
        w313: !!(R.w3_13.readOrder && R.w3_13.varChange && R.w3_13.branchLoop && R.w3_13.finalOutput),
        w44: !!(R.w4_4.programWhere && R.w4_4.envContains && R.w4_4.whyDiffer),
        w47: !!(R.w4_7.errorSeen && R.w4_7.possibleCause && R.w4_7.checkOrder && R.w4_7.fixAction && R.w4_7.verifyAfter),
        gate: R.w6_9.keepGate === true && R.w7_7.keepGate === true && !!R.w6_9.gateNote && !!R.w7_7.gateNote,
        w77: !!(R.w7_7.worldName && R.w7_7.capabilityList && R.w7_7.realTask && R.w7_7.nextPurpose)
      };
    });
    rep.assert(spec.w313, 'w3_13 含 阅读顺序/变量变化/分支循环/最终输出');
    rep.assert(spec.w44, 'w4_4 含 程序在哪运行/环境包含什么/为何环境不同');
    rep.assert(spec.w47, 'w4_7 含 看到的错误/可能原因/排查顺序/修复动作/修复后验证');
    rep.assert(spec.gate, 'w6_9 / w7_7 keepGate + gateNote 保留');
    rep.assert(spec.w77, 'w7_7 含 worldName/capabilityList/realTask/nextPurpose（world 层）');

    rep.assert(st.pageErrors.length === 0, `pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
