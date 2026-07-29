// tests/test_completion_navigation.js — R1.2 Round2-R2 验收:
//   完成弹窗按钮的真实导航按「真实页面状态 + Level.current + Completion._lastError」验证,
//   不再只统计回调次数。关键修复点: Round2Exp.handleCompletion 通过 .call(Game) 调用
//   原始 Game.startLevel / Game.backToMap(保留 Game 上下文), 且不再空 catch 吞掉导航异常。
//
// 测试不替换 Game.startLevel / Game.backToMap(让 handleCompletion 捕获到产品真实原函数),
// 仅 spy Game.switch 用于计数。通过 window.TEST_MODE / window._realUnlocked 放开解锁以便
// 真实 Game.startLevel 真正渲染下一关。
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

    // 公共: 在每个场景里放开解锁门禁, 让真实 Game.startLevel 能渲染下一关
    const unlock = () => page.evaluate(() => {
      window.TEST_MODE = true;
      window._realUnlocked = function () { return true; };
    });

    // 计算「下一世界首关」(与 Round2Exp.nextWorldFirstLevel 等价, 不依赖产品内部)
    const nextWorldFirst = async (id) => page.evaluate((_id) => {
      var wk = LevelData[_id] && LevelData[_id].world;
      var keys = Object.keys(WORLDS);
      var idx = keys.indexOf(wk);
      if (idx < 0 || idx + 1 >= keys.length) return null;
      var nw = WORLDS[keys[idx + 1]];
      return (nw && nw.levels && nw.levels[0]) || null;
    }, id);

    // spy Game.switch(保留原函数身份, 仅计数) —— 不碰 Game.startLevel / Game.backToMap
    const installSwitchSpy = () => page.evaluate(() => {
      const orig = Game.switch;
      window.__switch = { orig: orig, map: 0, level: 0 };
      Game.switch = function (id) {
        if (id === 'map-page') window.__switch.map++;
        if (id === 'level-page') window.__switch.level++;
        return orig.call(Game, id);
      };
    });
    const readSwitch = () => page.evaluate(() => ({ map: window.__switch.map, level: window.__switch.level }));

    // ═══ 1) normal: ai_camp_1 —— 点击「继续学习」真实进入下一关 ═══
    await unlock();
    await installSwitchSpy();
    const n = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      Level.render('ai_camp_1');
      Game.switch('level-page');
      await w(120);
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? [].slice.call(document.querySelectorAll('#r2-comp-actions button')) : [];
      const hasBack = !!btns.find(b => b.textContent.indexOf('返回地图') >= 0);
      const expNext = (typeof getNextCoreLevel === 'function') ? getNextCoreLevel('ai_camp_1') : null;
      // 第二次点击前快照
      const before = Level.current;
      const cont = btns.find(b => b.textContent.indexOf('继续') >= 0) || btns[0];
      cont.click();
      await w(150);
      const afterCurrent = Level.current;
      const levelActive = document.getElementById('level-page').classList.contains('active');
      const lastErr = window.Completion._lastError;
      // 单次执行: 再次点击(应被 _submitted 守卫拦截)
      cont.click();
      await w(120);
      const afterSecond = Level.current;
      const lvlSwitch2 = window.__switch.level;
      window.Completion.hide();
      return { tier, n: btns.length, hasBack, expNext, before, afterCurrent, levelActive, lastErr: !!lastErr, afterSecond, lvlSwitch2 };
    });
    const swN = await readSwitch();
    rep.assert(n.tier === 'normal', `ai_camp_1 弹窗 tier=normal (${n.tier})`);
    rep.assert(n.n === 1 && !n.hasBack, `normal 弹窗只有 1 个按钮、无「返回地图」(按钮数=${n.n}, 有返回=${n.hasBack})`);
    rep.assert(n.expNext && n.expNext === 'ai_camp_2', `ai_camp_1 下一关应为 ai_camp_2 (引擎计算=${n.expNext})`);
    rep.assert(n.afterCurrent === n.expNext, `点击「继续学习」后 Level.current === ${n.expNext} (实际=${n.afterCurrent})`);
    rep.assert(n.levelActive, '点击「继续学习」后: 关卡页 level-page 处于 active(真实 Game.startLevel)');
    rep.assert(n.lastErr === false, `正常导航后 Completion._lastError === null (${n.lastErr})`);
    rep.assert(n.afterSecond === n.afterCurrent, `「继续学习」单次执行: 二次点击后 Level.current 不变 (${n.afterSecond})`);
    rep.assert(swN.level >= 1, `Game.switch('level-page') 至少被真实调用 1 次 (${swN.level})`);

    // ═══ 2) capability: w3_13 —— 点击「下一关」真实进入下一主线关 ═══
    await unlock();
    await installSwitchSpy();
    const c = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      Level.render('w3_13');
      Game.switch('level-page');
      await w(120);
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? [].slice.call(document.querySelectorAll('#r2-comp-actions button')) : [];
      const hasBack = !!btns.find(b => b.textContent.indexOf('返回地图') >= 0);
      const expNext = (typeof getNextCoreLevel === 'function') ? getNextCoreLevel('w3_13') : null;
      const cont = btns.find(b => b.textContent.indexOf('下一关') >= 0) || btns[0];
      const beforeContent = (document.getElementById('level-content') || {}).innerHTML || '';
      cont.click();
      await w(150);
      const afterCurrent = Level.current;
      const afterContent = (document.getElementById('level-content') || {}).innerHTML || '';
      const levelActive = document.getElementById('level-page').classList.contains('active');
      const lastErr = !!window.Completion._lastError;
      window.Completion.hide();
      return { tier, n: btns.length, hasBack, expNext, afterCurrent, levelActive, lastErr, contentChanged: beforeContent !== afterContent };
    });
    const swC = await readSwitch();
    rep.assert(c.tier === 'capability', `w3_13 弹窗 tier=capability (${c.tier})`);
    rep.assert(c.n === 1 && !c.hasBack, `capability 弹窗只有 1 个按钮、无「返回地图」(按钮数=${c.n}, 有返回=${c.hasBack})`);
    rep.assert(c.expNext && c.afterCurrent === c.expNext, `点击「下一关」后 Level.current === ${c.expNext} (实际=${c.afterCurrent})`);
    rep.assert(c.afterCurrent !== 'w3_13', `点击「下一关」后 Level.current 已变化 (原=w3_13, 现=${c.afterCurrent})`);
    rep.assert(c.contentChanged, '点击「下一关」后: 关卡内容已重新渲染(下一关内容)');
    rep.assert(c.levelActive, '点击「下一关」后: 关卡页 level-page 处于 active');
    rep.assert(c.lastErr === false, `正常导航后 Completion._lastError === null (${c.lastErr})`);
    rep.assert(swC.level >= 1, `Game.switch('level-page') 真实调用 (${swC.level})`);

    // ═══ 3) boss: w6_9 —— 合法门禁后点击「进入下一世界」真实进入 w7 首关 ═══
    await unlock();
    await installSwitchSpy();
    const expBoss = await nextWorldFirst('w6_9');
    const b = await page.evaluate(async (exp) => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const cfg = { goal: ['g'], input: ['i'], tools: ['t'], perm: ['p'], stop: ['s'], fallback: ['f'], accept: ['a'], riskRules: [] };
      Level.render('w6_9');
      Game.switch('level-page');
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
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? [].slice.call(document.querySelectorAll('#r2-comp-actions button')) : [];
      const hasBack = !!btns.find(b => b.textContent.indexOf('返回地图') >= 0);
      const cont = btns.find(b => b.textContent.indexOf('进入下一世界') >= 0) || btns[0];
      cont.click();
      await w(150);
      const afterCurrent = Level.current;
      const levelActive = document.getElementById('level-page').classList.contains('active');
      const lastErr = !!window.Completion._lastError;
      cont.click();
      await w(120);
      const afterSecond = Level.current;
      window.Completion.hide();
      return { tier, n: btns.length, hasBack, exp, afterCurrent, levelActive, lastErr, afterSecond };
    }, expBoss);
    const swB = await readSwitch();
    rep.assert(b.tier === 'boss', `w6_9 合法通过门禁后弹窗 tier=boss (${b.tier})`);
    rep.assert(b.n === 2 && b.hasBack, `boss 弹窗含「返回地图」按钮(按钮数=${b.n}, 有返回=${b.hasBack})`);
    rep.assert(b.afterCurrent === expBoss, `点击「进入下一世界」后 Level.current === ${expBoss} (实际=${b.afterCurrent})`);
    rep.assert(b.levelActive, '点击「进入下一世界」后: 关卡页 level-page 处于 active');
    rep.assert(b.lastErr === false, `Boss 导航后 Completion._lastError === null (${b.lastErr})`);
    rep.assert(b.afterSecond === b.afterCurrent, `「进入下一世界」单次执行: 二次点击后 Level.current 不变 (${b.afterSecond})`);
    rep.assert(swB.level >= 1, `Game.switch('level-page') 真实调用 (${swB.level})`);

    // ═══ 3b) boss: w6_9 —— 点击「返回地图」真实回到地图页 ═══
    await unlock();
    await installSwitchSpy();
    const bBack = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const cfg = { goal: ['g'], input: ['i'], tools: ['t'], perm: ['p'], stop: ['s'], fallback: ['f'], accept: ['a'], riskRules: [] };
      Level.render('w6_9');
      Game.switch('level-page');
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
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const btns = m ? [].slice.call(document.querySelectorAll('#r2-comp-actions button')) : [];
      const back = btns.find(b => b.textContent.indexOf('返回地图') >= 0);
      const beforeLevelActive = document.getElementById('level-page').classList.contains('active');
      const beforeMapActive = document.getElementById('map-page').classList.contains('active');
      back.click();
      await w(150);
      const afterMapActive = document.getElementById('map-page').classList.contains('active');
      const afterLevelActive = document.getElementById('level-page').classList.contains('active');
      const lastErr = !!window.Completion._lastError;
      back.click();
      await w(120);
      const afterMapActive2 = document.getElementById('map-page').classList.contains('active');
      window.Completion.hide();
      return { beforeLevelActive, beforeMapActive, afterMapActive, afterLevelActive, lastErr, afterMapActive2 };
    });
    const swBB = await readSwitch();
    rep.assert(bBack.beforeLevelActive && !bBack.beforeMapActive, 'Boss 点击前对照: 关卡页 active、地图页 inactive');
    rep.assert(bBack.afterMapActive, '点击「返回地图」后: 地图页 map-page 变为 active(真实 Game.backToMap)');
    rep.assert(!bBack.afterLevelActive, '点击「返回地图」后: 关卡页 level-page 不再 active');
    rep.assert(bBack.afterMapActive2, '「返回地图」单次执行: 二次点击后地图页仍 active(未重复触发)');
    rep.assert(bBack.lastErr === false, `Boss 返回地图后 Completion._lastError === null (${bBack.lastErr})`);
    rep.assert(swBB.map >= 1, `Game.switch('map-page') 真实调用 (${swBB.map})`);

    // ═══ 4) world: w7_7 —— 合法门禁后点击「继续学习」回到地图页 ═══
    await unlock();
    await installSwitchSpy();
    const w7 = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const cfg = { io: ['in_data', 'out_advice'], exec: ['e_script'], fail: ['f_retry'], confirm: ['c_500'], accept: ['a_evi'] };
      Level.render('w7_7');
      Game.switch('level-page');
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
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const tier = m ? m.getAttribute('data-tier') : null;
      const btns = m ? [].slice.call(document.querySelectorAll('#r2-comp-actions button')) : [];
      const hasBack = !!btns.find(b => b.textContent.indexOf('返回地图') >= 0);
      const cont = btns.find(b => b.textContent.indexOf('继续') >= 0) || btns[0];
      cont.click();
      await w(150);
      const afterMapActive = document.getElementById('map-page').classList.contains('active');
      const afterLevelActive = document.getElementById('level-page').classList.contains('active');
      const lastErr = !!window.Completion._lastError;
      window.Completion.hide();
      return { tier, n: btns.length, hasBack, afterMapActive, afterLevelActive, lastErr };
    });
    const swW = await readSwitch();
    rep.assert(w7.tier === 'world', `w7_7 合法通过门禁后弹窗 tier=world (${w7.tier})`);
    rep.assert(w7.n === 2 && w7.hasBack, `world 弹窗含「返回地图」按钮(按钮数=${w7.n}, 有返回=${w7.hasBack})`);
    rep.assert(w7.afterMapActive, 'world 点击「继续学习」后: 地图页 map-page 变为 active(真实 Game.backToMap)');
    rep.assert(!w7.afterLevelActive, 'world 点击「继续学习」后: 关卡页 level-page 不再 active');
    rep.assert(w7.lastErr === false, `world 导航后 Completion._lastError === null (${w7.lastErr})`);
    rep.assert(swW.map >= 1, `Game.switch('map-page') 真实调用 (${swW.map})`);

    // ═══ 4b) world: w7_7 —— 点击「返回地图」回到地图页 ═══
    await unlock();
    await installSwitchSpy();
    const w7Back = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const cfg = { io: ['in_data', 'out_advice'], exec: ['e_script'], fail: ['f_retry'], confirm: ['c_500'], accept: ['a_evi'] };
      Level.render('w7_7');
      Game.switch('level-page');
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
      Level.done();
      await w(1700);
      const m = document.getElementById('r2-comp-modal');
      const btns = m ? [].slice.call(document.querySelectorAll('#r2-comp-actions button')) : [];
      const back = btns.find(b => b.textContent.indexOf('返回地图') >= 0);
      back.click();
      await w(150);
      const afterMapActive = document.getElementById('map-page').classList.contains('active');
      const afterLevelActive = document.getElementById('level-page').classList.contains('active');
      const lastErr = !!window.Completion._lastError;
      window.Completion.hide();
      return { afterMapActive, afterLevelActive, lastErr };
    });
    const swWB = await readSwitch();
    rep.assert(w7Back.afterMapActive, 'world 点击「返回地图」后: 地图页 map-page 变为 active');
    rep.assert(!w7Back.afterLevelActive, 'world 点击「返回地图」后: 关卡页 level-page 不再 active');
    rep.assert(w7Back.lastErr === false, `world 返回地图后 Completion._lastError === null (${w7Back.lastErr})`);
    rep.assert(swWB.map >= 1, `Game.switch('map-page') 真实调用 (${swWB.map})`);

    // ═══ 5) 全程无 JS 异常(但不再作为导航成功与否的唯一判据) ═══
    rep.assert(st.pageErrors.length === 0, `导航全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
