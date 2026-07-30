// tests/test_round3_interaction_progress.js — R1.2 Round3 验收:
//   验证 InteractionProgress 公共交互进度对象(直接 API + 关卡渲染集成):
//     - init / complete / fail / reset / getState / render 行为正确
//     - 关卡渲染后注入 #r3-iprog 面板, 展示当前步骤 / 已完成数 / 是否可提交
//     - 状态只存于 InteractionProgress._state, 不写入 LevelData
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_interaction_progress.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18941;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_interaction_progress');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    rep.assert(await page.evaluate(() => typeof window.InteractionProgress === 'object'),
      'window.InteractionProgress 全局对象存在');

    // ═══ 1) 直接 API: init / complete / fail / reset / getState ═══
    const api = await page.evaluate(() => {
      const IP = window.InteractionProgress;
      IP.reset('ip_a');
      IP.init('ip_a', [
        { id: 's1', label: '第一步' },
        { id: 's2', label: '第二步' },
        { id: 's3', label: '第三步' }
      ]);
      const s0 = IP.getState('ip_a');
      const before = { total: s0.total, current: s0.current, completed: s0.completedCount, submit: s0.submitAllowed };

      IP.complete('ip_a', 's1');
      const s1 = IP.getState('ip_a');
      const after1 = { current: s1.current, completed: s1.completedCount, submit: s1.submitAllowed };

      IP.complete('ip_a', 's2');
      IP.complete('ip_a', 's3');
      const s3 = IP.getState('ip_a');
      const after3 = { current: s3.current, completed: s3.completedCount, submit: s3.submitAllowed };

      IP.fail('ip_a', null, '演示失败原因');
      const sf = IP.getState('ip_a');
      const failReason = sf.failReason;
      const failSubmit = sf.submitAllowed; // fail 不改动已完成步骤, 提交权应保持

      IP.reset('ip_a');
      const afterReset = IP.getState('ip_a');
      return { before, after1, after3, failReason, failSubmit, afterReset };
    });
    rep.assert(api.before.total === 3 && api.before.current === 0 && api.before.completed === 0 && api.before.submit === false,
      `init 后: total=3, current=0, completed=0, submitAllowed=false (${JSON.stringify(api.before)})`);
    rep.assert(api.after1.current === 1 && api.after1.completed === 1 && api.after1.submit === false,
      `complete(s1) 后: current=1, completed=1, submitAllowed 仍 false (${JSON.stringify(api.after1)})`);
    rep.assert(api.after3.current === 3 && api.after3.completed === 3 && api.after3.submit === true,
      `complete 全部 后: current=3, completed=3, submitAllowed=true (${JSON.stringify(api.after3)})`);
    rep.assert(api.failReason === '演示失败原因',
      `fail 写入 failReason (${api.failReason})`);
    rep.assert(api.failSubmit === true,
      `fail 不改动已完成步骤, submitAllowed 保持 true (${api.failSubmit})`);
    rep.assert(api.afterReset === null,
      `reset 后 getState 返回 null (${api.afterReset})`);

    // ═══ 2) 渲染集成: ai_camp_11 渲染后注入交互进度面板 ═══
    const integ = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      IP.reset('ai_camp_11');
      Level.render('ai_camp_11');
      Game.switch('level-page');
      await w(120);
      const panel = document.getElementById('r3-iprog');
      const st0 = IP.getState('ai_camp_11');
      const text0 = panel ? panel.textContent : '';

      // 模拟逐步完成所有交互步骤
      const rep = window.LevelExperienceRegistry['ai_camp_11'];
      (rep.interactionSteps || []).forEach(s => IP.complete('ai_camp_11', s.id));
      const st1 = IP.getState('ai_camp_11');
      return {
        hasPanel: !!panel,
        panelText: text0,
        st0_total: st0 ? st0.total : -1,
        st0_current: st0 ? st0.current : -1,
        st0_completed: st0 ? st0.completedCount : -1,
        st1_total: st1.total,
        st1_completed: st1.completedCount,
        st1_submit: st1.submitAllowed
      };
    });
    rep.assert(integ.hasPanel, 'ai_camp_11 渲染后注入 #r3-iprog 交互进度面板');
    rep.assert(integ.st0_total === 4 && integ.st0_current === 0 && integ.st0_completed === 0,
      `ai_camp_11 初始状态: total=4(交互步骤数), current=0, completed=0 (${JSON.stringify(integ).slice(0, 120)})`);
    rep.assert(integ.panelText.indexOf('交互进度') >= 0, '面板含「交互进度」标题');
    rep.assert(integ.panelText.indexOf('0 / 4') >= 0, '面板初始显示「已完成 / 总步骤：0 / 4」');
    rep.assert(integ.panelText.indexOf('是否允许提交：否') >= 0, '面板初始显示「是否允许提交：否」');
    rep.assert(integ.st1_total === 4 && integ.st1_completed === 4 && integ.st1_submit === true,
      `ai_camp_11 完成全部交互步骤后: completed=4, submitAllowed=true (${JSON.stringify(integ)})`);

    // ═══ 3) 状态隔离: 不写入 LevelData ═══
    const isolated = await page.evaluate(() => {
      // LevelData 中不应出现 InteractionProgress 的私有状态字段
      const ld = window.LevelData['ai_camp_11'] || {};
      const leaked = ('_ipState' in ld) || ('interactionProgress' in ld);
      return { leaked };
    });
    rep.assert(!isolated.leaked, 'InteractionProgress 状态未写入 LevelData(无 _ipState / interactionProgress 字段)');

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
