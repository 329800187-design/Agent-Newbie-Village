// tests/test_round3_live_progress.js — R1.2 Round3-R1 验收:
//   验证 InteractionProgress 成为实时组件 + Level.done 不重置既有进度:
//     - sync / updatePanel / ensure 方法存在
//     - 初始 0/4; complete 第一步后 DOM 实时显示 1/4; 当前步骤变为第 2 步
//     - fail 后 DOM 实时显示真实失败原因(无需重新进入关卡)
//     - reset 后 #r3-iprog 面板被移除
//     - ensure: 重新渲染(重新进入关卡)不丢失已完成步骤(不重置)
//     - W6 进度保持: 提交前 2/4, 门禁失败, 提交后仍为 2/4(失败提交不清零)
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_live_progress.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18944;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_live_progress');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    rep.assert(await page.evaluate(() =>
      typeof window.InteractionProgress === 'object' &&
      typeof window.InteractionProgress.sync === 'function' &&
      typeof window.InteractionProgress.updatePanel === 'function' &&
      typeof window.InteractionProgress.ensure === 'function'),
      'InteractionProgress 含 sync / updatePanel / ensure 方法');

    // ═══ 1) 实时面板: 初始 0/4; complete 后 DOM 实时刷新; fail 后实时显示原因 ═══
    const live = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      const panelText = () => { const p = document.getElementById('r3-iprog'); return p ? p.textContent : ''; };
      IP.reset('ai_camp_11');
      Level.render('ai_camp_11');
      Game.switch('level-page');
      await w(120);
      const t0 = panelText();
      const initCompleted = /已完成 \/ 总步骤：0 \/ 4/.test(t0);
      const initCurrent = /当前步骤：1 \/ 4/.test(t0);
      const initSubmit = /是否允许提交：否/.test(t0);

      IP.complete('ai_camp_11', 'recall');
      await w(60);
      const t1 = panelText();
      const after1Completed = /已完成 \/ 总步骤：1 \/ 4/.test(t1);
      const after1Current = /当前步骤：2 \/ 4/.test(t1);

      IP.complete('ai_camp_11', 'example');
      await w(60);
      const t2 = panelText();
      const after2Completed = /已完成 \/ 总步骤：2 \/ 4/.test(t2);

      IP.fail('ai_camp_11', null, '真实失败原因：步骤顺序写反了');
      await w(60);
      const t3 = panelText();
      const failShown = t3.indexOf('真实失败原因：步骤顺序写反了') >= 0;
      const failReasonRow = /未完成原因：真实失败原因：步骤顺序写反了/.test(t3);
      return { initCompleted, initCurrent, initSubmit, after1Completed, after1Current, after2Completed, failShown, failReasonRow };
    });
    rep.assert(live.initCompleted, '初始 DOM 显示「已完成 / 总步骤：0 / 4」');
    rep.assert(live.initCurrent, '初始 DOM 显示「当前步骤：1 / 4」');
    rep.assert(live.initSubmit, '初始 DOM 显示「是否允许提交：否」');
    rep.assert(live.after1Completed, 'complete 第一步后 DOM 实时显示「已完成 / 总步骤：1 / 4」(无需重进关卡)');
    rep.assert(live.after1Current, 'complete 第一步后 DOM 实时显示「当前步骤：2 / 4」(推进到第 2 步)');
    rep.assert(live.after2Completed, 'complete 第二步后 DOM 实时显示「已完成 / 总步骤：2 / 4」');
    rep.assert(live.failShown, 'fail 后 DOM 实时显示真实失败原因');
    rep.assert(live.failReasonRow, 'fail 后 DOM「未完成原因」行含真实失败原因');

    // ═══ 2) 实时 reset: 移除面板 ═══
    const resetShown = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      window.InteractionProgress.reset('ai_camp_11');
      await w(60);
      return document.getElementById('r3-iprog') === null;
    });
    rep.assert(resetShown, 'reset 后 #r3-iprog 面板被移除');

    // ═══ 3) ensure 保留进度: 重新渲染(重新进入关卡)不丢失已完成步骤 ═══
    const ensureKeeps = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      IP.reset('ai_camp_11');
      Level.render('ai_camp_11');
      Game.switch('level-page');
      await w(100);
      IP.complete('ai_camp_11', 'recall');
      IP.complete('ai_camp_11', 'example');
      const before = IP.getState('ai_camp_11').completedCount;
      Level.render('ai_camp_11'); // 重新进入关卡 → ensure 不应清空
      Game.switch('level-page');
      await w(100);
      const after = IP.getState('ai_camp_11').completedCount;
      const panel = document.getElementById('r3-iprog');
      const panelShows = panel ? /已完成 \/ 总步骤：2 \/ 4/.test(panel.textContent) : false;
      return { before, after, panelShows };
    });
    rep.assert(ensureKeeps.before === 2, `ensure 前 completedCount=2 (${ensureKeeps.before})`);
    rep.assert(ensureKeeps.after === 2, `重新渲染后 ensure 仍保留 completedCount=2 (不重置) (${ensureKeeps.after})`);
    rep.assert(ensureKeeps.panelShows, '重新渲染后面板仍显示 2/4');

    // ═══ 4) 进度保持(门禁失败场景): W6 提交前 2/4, 门禁失败, 提交后仍为 2/4 ═══
    const retain = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      try {
        if (typeof Sim !== 'undefined' && Sim) {
          Sim.state = { configStatus: 'draft', configRevision: 0, passed: {}, configSnapshot: {}, failures: {} };
        }
      } catch (e) {}
      IP.reset('w6_9');
      Level.render('w6_9');
      Game.switch('level-page');
      await w(100);
      const steps = window.LevelExperienceRegistry['w6_9'].interactionSteps;
      IP.complete('w6_9', steps[0].id);
      IP.complete('w6_9', steps[1].id);
      const before = IP.getState('w6_9').completedCount; // 期望 2
      try { Level.done.call(Level); } catch (e) {} // 触发包裹后的 Level.done; 门禁失败 → 失败分支, 不重置
      await w(100);
      const after = IP.getState('w6_9') ? IP.getState('w6_9').completedCount : -1;
      const gate = IP.getState('w6_9') ? IP.getState('w6_9').gate : null;
      return { before, after, gatePassed: gate ? gate.passed : null };
    });
    rep.assert(retain.before === 2, `W6 提交前已完成 2/4 (${retain.before})`);
    rep.assert(retain.after === 2, `W6 门禁失败后提交, 已完成步骤仍为 2/4 (不重置) (${retain.after})`);
    rep.assert(retain.gatePassed !== true, `W6 门禁未通过(passed !== true) (${retain.gatePassed})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
