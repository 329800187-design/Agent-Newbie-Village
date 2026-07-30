// tests/test_round3_gate_fail_closed.js — R1.2 Round3-R1 验收:
//   验证门禁读取 fail-closed + submitAllowed 纳入真实门禁:
//     - 正常流程: Round3Diagnostics.errors.length === 0
//     - 主动让门禁函数抛错: gate.passed=false / status='error' / 错误被记录 / 不会变成"无门禁"
//     - submitAllowed = 步骤全完成 AND 门禁允许 (gate=false→false; gate=true→true; 无门禁→true)
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_gate_fail_closed.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18945;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_gate_fail_closed');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    rep.assert(await page.evaluate(() => typeof window.Round3Diagnostics === 'object'),
      'window.Round3Diagnostics 全局对象存在');

    // ═══ 1) 正常流程: 门禁读取无异常 → errors.length === 0 ═══
    const normal = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      try {
        if (typeof Sim !== 'undefined' && Sim) {
          Sim.state = { configStatus: 'draft', configRevision: 0, passed: {}, configSnapshot: {}, failures: {} };
        }
      } catch (e) {}
      window.Round3Diagnostics.clear();
      IP.reset('w6_9');
      Level.render('w6_9');
      Game.switch('level-page');
      await w(120);
      const g = IP.getState('w6_9').gate;
      return { passed: g.passed, status: g.status, label: g.label, errors: window.Round3Diagnostics.errors.length };
    });
    rep.assert(normal.errors === 0, `正常门禁读取: Round3Diagnostics.errors.length === 0 (${normal.errors})`);
    rep.assert(normal.passed === false, `正常(未提交)门禁 passed=false (${normal.passed})`);
    rep.assert(normal.label.indexOf('W6') >= 0, `正常门禁标签含 'W6' (${normal.label})`);

    // ═══ 2) fail-closed: 主动让门禁函数抛错 ═══
    const failClosed = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      try {
        if (typeof Sim !== 'undefined' && Sim) {
          // R3 镜像 readGate 仅在 configStatus==='submitted' 时才进入 isCurrentRevisionPassed() 评估分支。
          // 为真实验证「门禁读取抛错 → fail-closed」, 此处先置为 submitted, 并让 getConfig 安全返回,
          // 使被强制抛错的 isCurrentRevisionPassed() 真正被求值并被 readGate 捕获。
          Sim.state = { configStatus: 'submitted', configRevision: 0, passed: {}, configSnapshot: {}, failures: {} };
          Sim.getConfig = function () { return {}; };
          Sim.isCurrentRevisionPassed = function () { throw new Error('forced gate read error'); };
        }
      } catch (e) {}
      window.Round3Diagnostics.clear();
      IP.reset('w6_9');
      // 直接经 ensure → readGate 触发门禁读取异常(不经引擎 Level.render, 避免引擎内部调用抛错影响 pageerror 计数)
      IP.ensure('w6_9', window.LevelExperienceRegistry['w6_9'].interactionSteps);
      await w(120);
      const g = IP.getState('w6_9').gate;
      const errs = window.Round3Diagnostics.errors;
      return {
        passed: g.passed, status: g.status, label: g.label,
        hasError: errs.length > 0,
        errMsg: errs.length ? errs[0].message : '',
        errScope: errs.length ? errs[0].scope : ''
      };
    });
    rep.assert(failClosed.passed === false, `fail-closed: 门禁读取异常时 passed=false (${failClosed.passed})`);
    rep.assert(failClosed.status === 'error', `fail-closed: 门禁 status='error' (${failClosed.status})`);
    rep.assert(failClosed.label.indexOf('无门禁') < 0, `fail-closed: 标签不是"无门禁" (${failClosed.label})`);
    rep.assert(failClosed.hasError, `fail-closed: 错误被记录到 Round3Diagnostics (${failClosed.errMsg})`);
    rep.assert(failClosed.errScope === 'readGate:w6_9', `fail-closed: 诊断 scope=readGate:w6_9 (${failClosed.errScope})`);

    // ═══ 3) submitAllowed 纳入真实门禁 ═══
    const submit = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;

      // 无门禁普通关: 步骤全完成 → submitAllowed=true
      IP.reset('ai_camp_11');
      Level.render('ai_camp_11');
      Game.switch('level-page');
      await w(100);
      window.LevelExperienceRegistry['ai_camp_11'].interactionSteps.forEach(s => IP.complete('ai_camp_11', s.id));
      const noGateAllDone = IP.getState('ai_camp_11').submitAllowed;

      // W6: 步骤全完成 + gate=false → submitAllowed=false (用 ensure 直接建状态, 不经引擎 Level.render)
      IP.reset('w6_9');
      IP.ensure('w6_9', window.LevelExperienceRegistry['w6_9'].interactionSteps);
      window.LevelExperienceRegistry['w6_9'].interactionSteps.forEach(s => IP.complete('w6_9', s.id));
      IP._state['w6_9'].gate = { label: 'W6 · Agent 配置门禁', passed: false, status: 'n/a' };
      IP._recalc('w6_9');
      IP.updatePanel('w6_9');
      const gateFalseAllDone = IP.getState('w6_9').submitAllowed;

      // W6: 步骤全完成 + gate=true → submitAllowed=true
      IP._state['w6_9'].gate = { label: 'W6 · Agent 配置门禁', passed: true, status: 'submitted' };
      IP._recalc('w6_9');
      IP.updatePanel('w6_9');
      const gateTrueAllDone = IP.getState('w6_9').submitAllowed;

      return { noGateAllDone, gateFalseAllDone, gateTrueAllDone };
    });
    rep.assert(submit.noGateAllDone === true, `无门禁 + 步骤全完成 → submitAllowed=true (${submit.noGateAllDone})`);
    rep.assert(submit.gateFalseAllDone === false, `步骤全完成 + gate=false → submitAllowed=false (${submit.gateFalseAllDone})`);
    rep.assert(submit.gateTrueAllDone === true, `步骤全完成 + gate=true → submitAllowed=true (${submit.gateTrueAllDone})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
