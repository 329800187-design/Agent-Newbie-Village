// tests/test_completion_navigation.js — R1.2 Round2-R1 验收:
//   完成弹窗「返回地图」真实调用 Game.backToMap() 并按真实页面状态验证;
//   Boss / World 弹窗出现「返回地图」; normal / capability 不出现「返回地图」;
//   继续 / 返回地图 均只执行一次; 全程无 JS 异常。
// 注意: 直接调用 Level.render(id) 避开 TEST_MODE=false 的解锁门禁, 再构造合法门禁态后调用 done()。
// 用法: node tests/test_completion_navigation.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18935;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';

(async () => {
  const rep = new TestReport('test_completion_navigation');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const wait = (ms) => page.evaluate((m) => new Promise(r => setTimeout(r, m)), ms);

    // ═══ 1) normal 弹窗无「返回地图」按钮 ═══
    const n = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      Level.render('ai_camp_1');
      await w(120);
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const active = !!(m && m.classList.contains('active'));
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? document.querySelectorAll('#r2-comp-actions button') : [];
      const hasBack = !![].slice.call(btns).find(b => b.textContent.indexOf('返回地图') >= 0);
      window.Completion.hide();
      return { active, tier, n: btns.length, hasBack };
    });
    rep.assert(n.active, 'ai_camp_1 done() 触发完成弹窗');
    rep.assert(n.tier === 'normal', `ai_camp_1 弹窗 tier=normal (${n.tier})`);
    rep.assert(n.n === 1 && !n.hasBack, `normal 弹窗只有 1 个按钮、无「返回地图」(按钮数=${n.n}, 有返回=${n.hasBack})`);

    // ═══ 2) capability 弹窗无「返回地图」按钮 ═══
    const c = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      Level.render('w3_13');
      await w(120);
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? document.querySelectorAll('#r2-comp-actions button') : [];
      const hasBack = !![].slice.call(btns).find(b => b.textContent.indexOf('返回地图') >= 0);
      window.Completion.hide();
      return { tier, n: btns.length, hasBack };
    });
    rep.assert(c.tier === 'capability', `w3_13 弹窗 tier=capability (${c.tier})`);
    rep.assert(c.n === 1 && !c.hasBack, `capability 弹窗只有 1 个按钮、无「返回地图」(按钮数=${c.n}, 有返回=${c.hasBack})`);

    // ═══ 3) Boss 弹窗「返回地图」真实导航 + 单次执行 ═══
    const b = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      // 构造 W6 合法「已通过同版本验收」状态(使用引擎认可的数据结构)
      const cfg = { goal: ['g'], input: ['i'], tools: ['t'], perm: ['p'], stop: ['s'], fallback: ['f'], accept: ['a'], riskRules: [] };
      Level.render('w6_9');
      await w(160);
      Sim.state = {
        builderValues: JSON.parse(JSON.stringify(cfg)),
        configStatus: 'submitted', configRevision: 1,
        configSnapshot: JSON.parse(JSON.stringify(cfg)),
        passed: { normal: 1, 'missing-info': 1, 'high-risk': 1 },
        failures: {}, finalPassedAt: Date.now(),
        totalRuns: { normal: 1, 'missing-info': 1, 'high-risk': 1 }, runs: {}, history: []
      };
      Level.builderState = Level.builderState || {};
      Level.builderState['agent_builder'] = { values: JSON.parse(JSON.stringify(cfg)), attempt: 0 };
      // spy: 必须在 Level.done() 之前包裹, 使 handleCompletion 捕获到被包裹的 _realBack
      let cnt = 0;
      const origBack = Game.backToMap;
      // onBack() 以裸函数方式调用 _realBack(=本 spy), 此时 this 非 Game; 必须显式
      // 用 call(Game) 让原始 backToMap 内部的 this.switch 正确执行(否则静默抛错)。
      Game.backToMap = function () { cnt++; return origBack.call(Game); };
      // 先激活关卡页, 作为导航前后对照
      Game.switch('level-page');
      const beforeLevelActive = document.getElementById('level-page').classList.contains('active');
      const beforeMapActive = document.getElementById('map-page').classList.contains('active');
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? document.querySelectorAll('#r2-comp-actions button') : [];
      const back = [].slice.call(btns).find(b => b.textContent.indexOf('返回地图') >= 0);
      const hasBack = !!back;
      // 点击「返回地图」
      if (back) back.click();
      await w(80);
      const afterMapActive = document.getElementById('map-page').classList.contains('active');
      const afterLevelActive = document.getElementById('level-page').classList.contains('active');
      const cntAfterFirst = cnt;
      // 再次点击(应被单次执行守卫拦截)
      if (back) back.click();
      await w(80);
      const cntAfterSecond = cnt;
      Game.backToMap = origBack;
      window.Completion.hide();
      return { tier, hasBack, n: btns.length, beforeLevelActive, beforeMapActive, afterMapActive, afterLevelActive, cntAfterFirst, cntAfterSecond };
    });
    rep.assert(b.tier === 'boss', `w6_9 合法通过门禁后弹窗 tier=boss (${b.tier})`);
    rep.assert(b.n === 2 && b.hasBack, `boss 弹窗含「返回地图」按钮(按钮数=${b.n}, 有返回=${b.hasBack})`);
    rep.assert(b.beforeLevelActive && !b.beforeMapActive, '点击前: 关卡页 active、地图页 inactive(对照成立)');
    rep.assert(b.afterMapActive, '点击「返回地图」后: 地图页变为 active(真实 Game.backToMap)');
    rep.assert(!b.afterLevelActive, '点击「返回地图」后: 关卡页不再 active');
    rep.assert(b.cntAfterFirst === 1, `「返回地图」真实调用 Game.backToMap 恰好 1 次(首次=${b.cntAfterFirst})`);
    rep.assert(b.cntAfterSecond === 1, `「返回地图」再次点击被单次执行守卫拦截(二次=${b.cntAfterSecond})`);

    // ═══ 4) World 弹窗「返回地图」真实导航 ═══
    const w7 = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const cfg = { io: ['in_data', 'out_advice'], exec: ['e_script'], fail: ['f_retry'], confirm: ['c_500'], accept: ['a_evi'] };
      Level.render('w7_7');
      await w(160);
      WfSim.state = {
        builderValues: JSON.parse(JSON.stringify(cfg)),
        configStatus: 'submitted', configRevision: 1,
        configSnapshot: JSON.parse(JSON.stringify(cfg)),
        passed: { normal: 1, 'high-amount': 1, 'tool-fail': 1 },
        failures: {}, finalPassedAt: Date.now(),
        sequencePassed: true, sequenceOrder: [],
        totalRuns: { normal: 1, 'high-amount': 1, 'tool-fail': 1 }, runs: {}, history: []
      };
      Level.builderState = Level.builderState || {};
      Level.builderState['workflow_builder'] = { values: JSON.parse(JSON.stringify(cfg)), attempt: 0 };
      Level.interactionPassed = Level.interactionPassed || {};
      Level.interactionPassed.workflow_sequence = true;
      Level.interactionPassed.workflow_builder = true;
      let cnt = 0;
      const origBack = Game.backToMap;
      Game.backToMap = function () { cnt++; return origBack.call(Game); };
      Game.switch('level-page');
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? document.querySelectorAll('#r2-comp-actions button') : [];
      const back = [].slice.call(btns).find(b => b.textContent.indexOf('返回地图') >= 0);
      if (back) back.click();
      await w(80);
      const afterMapActive = document.getElementById('map-page').classList.contains('active');
      const afterLevelActive = document.getElementById('level-page').classList.contains('active');
      Game.backToMap = origBack;
      window.Completion.hide();
      return { tier, hasBack: !!back, n: btns.length, afterMapActive, afterLevelActive, cnt };
    });
    rep.assert(w7.tier === 'world', `w7_7 合法通过门禁后弹窗 tier=world (${w7.tier})`);
    rep.assert(w7.n === 2 && w7.hasBack, `world 弹窗含「返回地图」按钮(按钮数=${w7.n}, 有返回=${w7.hasBack})`);
    rep.assert(w7.afterMapActive, 'world 点击「返回地图」后: 地图页变为 active');
    rep.assert(!w7.afterLevelActive, 'world 点击「返回地图」后: 关卡页不再 active');
    rep.assert(w7.cnt === 1, `world「返回地图」真实调用 Game.backToMap 恰好 1 次(${w7.cnt})`);

    // ═══ 5) 全程无 JS 异常 ═══
    rep.assert(st.pageErrors.length === 0, `导航全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
