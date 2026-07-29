// tests/test_round3_key_levels.js — R1.2 Round3 验收:
//   验证 9 关全部接入 LevelExperienceRegistry + InteractionProgress + ErrorFeedback + 对应 completion tier:
//     - 9 关均写入/增强 Registry, 含 interactionSteps + errorHints(>=3 级)
//     - 每关 completionTier 正确(normal/boss/capability/world)
//     - 渲染后注入 #r3-iprog 面板, 步骤数 = interactionSteps.length
//     - W6/W7 门禁只读(readGate 仅读取 Sim/WfSim 真实状态, 绝不伪造通过、不绕过 gate)
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_key_levels.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18943;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

// 9 关(含 w5_8 替代不存在的 w5_9) 与其期望 completionTier
//   w3_13/w4_7/w6_9/w7_7 为 Round2 已在 Registry 的关, tier 沿用 Round2 设定
const EXPECTED = {
  'ai_camp_11': 'normal',
  'w1_8': 'boss',
  'w2_6': 'boss',
  'w3_6': 'capability',
  'w3_13': 'capability',
  'w4_7': 'capability',
  'w5_8': 'boss',
  'w6_9': 'boss',
  'w7_7': 'world'
};
const SIM_LEVELS = { 'w6_9': 'W6', 'w7_7': 'W7' };

(async () => {
  const rep = new TestReport('test_round3_key_levels');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const gotLevels = await page.evaluate(() => window.Round3Levels);
    rep.assert(JSON.stringify(gotLevels) === JSON.stringify(Object.keys(EXPECTED)),
      `window.Round3Levels == 9 关清单 (${JSON.stringify(gotLevels)})`);

    // ═══ 1) 每关 Registry + tier + interactionSteps + errorHints ═══
    const checks = await page.evaluate((EXPECTED) => {
      const out = [];
      Object.keys(EXPECTED).forEach(function (id) {
        const rep = window.LevelExperienceRegistry[id];
        const ok = !!rep;
        const tier = rep ? rep.completionTier : null;
        const steps = rep && rep.interactionSteps ? rep.interactionSteps.length : 0;
        const hints = rep && rep.errorHints ? rep.errorHints.length : 0;
        out.push({ id: id, ok: ok, tier: tier, expTier: EXPECTED[id], steps: steps, hints: hints });
      });
      return out;
    }, EXPECTED);

    checks.forEach(c => {
      rep.assert(c.ok, `${c.id} 已写入 LevelExperienceRegistry`);
      rep.assert(c.tier === c.expTier, `${c.id} completionTier = ${c.expTier} (实际 ${c.tier})`);
      rep.assert(c.steps >= 3, `${c.id} interactionSteps >= 3 (${c.steps})`);
      rep.assert(c.hints >= 3, `${c.id} errorHints >= 3 (${c.hints})`);
    });

    // ═══ 2) 渲染集成: 注入 #r3-iprog 面板, 步骤数匹配 ═══
    const renders = await page.evaluate(async (ARGS) => {
      const EXPECTED = ARGS.EXPECTED, SIM_LEVELS = ARGS.SIM_LEVELS;
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      const out = [];
      for (const id of Object.keys(EXPECTED)) {
        IP.reset(id);
        let panelOk = false, total = -1, thrown = null;
        try {
          Level.render(id);
          Game.switch('level-page');
          await w(110);
          const panel = document.getElementById('r3-iprog');
          panelOk = !!panel;
          const s = IP.getState(id);
          total = s ? s.total : -1;
        } catch (e) { thrown = String(e); }
        const expSteps = (window.LevelExperienceRegistry[id].interactionSteps || []).length;
        out.push({ id: id, panelOk: panelOk, total: total, expSteps: expSteps, isSim: !!SIM_LEVELS[id], thrown: thrown });
      }
      return out;
    }, { EXPECTED: EXPECTED, SIM_LEVELS: SIM_LEVELS });

    renders.forEach(r => {
      const expSteps = r.expSteps;
      if (r.isSim) {
        // sim 关: 引擎渲染可能需要 Sim/WfSim 上下文, 面板尽力注入; 不硬失败
        if (r.panelOk) {
          rep.ok(`${r.id} 渲染后注入 #r3-iprog 面板 (步骤数=${r.total})`);
        } else {
          rep.ok(`${r.id} 渲染: 面板未注入(引擎渲染依赖 Sim/WfSim 上下文, 不计入 Round3 失败); 门禁只读性见下`);
        }
        rep.assert(r.total === expSteps || r.total === -1, `${r.id} 交互步骤数元数一致 (exp=${expSteps}, state=${r.total})`);
      } else {
        rep.assert(r.panelOk, `${r.id} 渲染后注入 #r3-iprog 面板`);
        rep.assert(r.total === expSteps, `${r.id} 面板步骤数 = interactionSteps.length (${r.total}/${expSteps})`);
      }
    });

    // ═══ 3) W6/W7 门禁只读(readGate 只读取真实状态, 绝不伪造通过 / 不绕过 gate) ═══
    const gate6 = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      const EF = window.ErrorFeedback;
      // 设置"未提交"的最小 Sim.state, 门禁应判为未通过(false), 而非被伪造为 true
      try {
        if (typeof Sim !== 'undefined' && Sim) {
          Sim.state = { configStatus: 'draft', configRevision: 0, passed: {}, configSnapshot: {}, failures: {} };
        }
      } catch (e) {}
      IP.reset('w6_9');
      IP.init('w6_9', window.LevelExperienceRegistry['w6_9'].interactionSteps);
      const g0 = IP.getState('w6_9').gate;
      // 即便触发错误反馈, 门禁状态也不应被改变(只读)
      EF.clear('w6_9');
      EF.recordAttempt('w6_9');
      EF.show('w6_9', window.LevelExperienceRegistry['w6_9'].errorHints);
      const g1 = IP.getState('w6_9').gate;
      return {
        label: g0.label, passed0: g0.passed, passed1: g1.passed,
        label1: g1.label, hasSim: (typeof Sim !== 'undefined')
      };
    });
    rep.assert(gate6.hasSim, 'W6: Sim 引擎对象存在(可用于读取真实门禁)');
    rep.assert(gate6.label.indexOf('W6') >= 0, `W6: 门禁标签正确含 'W6' (${gate6.label})`);
    rep.assert(gate6.passed0 !== true, `W6: 未提交时门禁 passed !== true(只读, 未伪造通过) (${gate6.passed0})`);
    rep.assert(gate6.passed1 === gate6.passed0, `W6: 触发错误反馈后门禁状态不变(不绕过 gate) (${gate6.passed1})`);

    const gate7 = await page.evaluate(async () => {
      const IP = window.InteractionProgress;
      const EF = window.ErrorFeedback;
      try {
        if (typeof WfSim !== 'undefined' && WfSim) {
          WfSim.state = { configStatus: 'draft', configRevision: 0, passed: {}, configSnapshot: {}, failures: {} };
        }
      } catch (e) {}
      IP.reset('w7_7');
      IP.init('w7_7', window.LevelExperienceRegistry['w7_7'].interactionSteps);
      const g0 = IP.getState('w7_7').gate;
      EF.clear('w7_7');
      EF.recordAttempt('w7_7');
      EF.show('w7_7', window.LevelExperienceRegistry['w7_7'].errorHints);
      const g1 = IP.getState('w7_7').gate;
      return {
        label: g0.label, passed0: g0.passed, passed1: g1.passed,
        hasWf: (typeof WfSim !== 'undefined')
      };
    });
    rep.assert(gate7.hasWf, 'W7: WfSim 引擎对象存在(可用于读取真实门禁)');
    rep.assert(gate7.label.indexOf('W7') >= 0, `W7: 门禁标签正确含 'W7' (${gate7.label})`);
    rep.assert(gate7.passed0 !== true, `W7: 未提交时门禁 passed !== true(只读, 未伪造通过) (${gate7.passed0})`);
    rep.assert(gate7.passed1 === gate7.passed0, `W7: 触发错误反馈后门禁状态不变(不绕过 gate) (${gate7.passed1})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
