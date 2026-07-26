// tests/test_onboarding.js — 骨架验收: 入村流程浏览器实测
// 检查: 标准模式可选 / 青少模式禁用不可进入 / foundation 不可确认 /
//       beginner 正常进入 / 旧档保留 / 五维分数正常 / ageMode 不写 youth
// 用法: node tests/test_onboarding.js
const { startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18922;
const REL = 'Agent新手村_v1.0_发布候选版.html'; // 用户真实面 (TEST_MODE=false)

(async () => {
  const rep = new TestReport('test_onboarding');
  const srv = await startServer(PORT);
  const browser = await launch();
  const url = () => `http://127.0.0.1:${PORT}/${encodeURIComponent(REL)}?t=${Date.now()}`;
  try {
    // ═══ 场景 1: 新用户 — 标准可选 / 青少禁用 ═══
    let st = {};
    let ctx = await browser.newContext();
    let page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(url(), { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.evaluate(() => Game.enterVillage());
    await page.waitForTimeout(400);

    let step = await page.evaluate(() => Onboard.state && Onboard.state.step);
    rep.assert(step === 'mode', `新用户进入 mode 步 (${step})`);

    const modeUI = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#ob-inner .ob-card')];
      const youth = cards.find(c => c.innerHTML.indexOf('青少学习模式') >= 0);
      return {
        cards: cards.length,
        youthDisabled: youth ? youth.className.indexOf('ob-card-disabled') >= 0 : null,
        youthSoon: youth ? youth.innerHTML.indexOf('即将开放') >= 0 : null,
      };
    });
    rep.assert(modeUI.youthDisabled === true, '青少卡带 ob-card-disabled 禁用样式');
    rep.assert(modeUI.youthSoon === true, '青少卡显示「即将开放」');

    // 点击青少卡 → 不进入下一步
    await page.click('#ob-inner .ob-card.ob-card-disabled');
    await page.waitForTimeout(300);
    step = await page.evaluate(() => Onboard.state.step);
    rep.assert(step === 'mode', `点击青少卡后仍停留 mode 步 (${step})`);
    // 控制台直接调用也被守卫
    await page.evaluate(() => Onboard.pickMode('youth'));
    await page.waitForTimeout(200);
    step = await page.evaluate(() => Onboard.state.step);
    const modeVal = await page.evaluate(() => Onboard.state.mode);
    rep.assert(step === 'mode' && modeVal !== 'youth', `pickMode('youth') 被守卫 (step=${step}, mode=${modeVal})`);

    // 标准卡可选 → basis
    await page.click('#ob-inner .ob-card:not(.ob-card-disabled)');
    await page.waitForTimeout(300);
    step = await page.evaluate(() => Onboard.state.step);
    rep.assert(step === 'basis', `标准模式点击进入 basis 步 (${step})`);

    // ═══ 场景 2: 低分路径 → 推荐 beginner, foundation 不可确认 ═══
    await page.evaluate(() => Onboard.pickBasis('none'));
    await page.waitForTimeout(200);
    await page.evaluate(async () => {
      // 全部答错(选 s=0 的项)
      for (let i = 0; i < AssessmentQuestions.length; i++) {
        const q = AssessmentQuestions[Onboard.state.qIdx];
        let wrong = q.opts.findIndex(o => !o.s);
        if (wrong < 0) wrong = 0;
        Onboard.answer(wrong);
        await new Promise(r => setTimeout(r, 30));
      }
    });
    await page.waitForTimeout(300);
    let resUI = await page.evaluate(() => ({
      step: Onboard.state.step,
      recommended: Onboard.state.recommended,
      dims: document.querySelectorAll('#ob-inner .ob-dim').length,
      beginnerBtn: !!document.querySelector('#ob-inner .btn-primary'),
      disabledBtn: (document.querySelector('#ob-inner .ob-btn-disabled') || {}).textContent || '',
      html: document.getElementById('ob-inner').innerHTML,
    }));
    rep.assert(resUI.step === 'result', `答完 8 题进入 result 步 (${resUI.step})`);
    rep.assert(resUI.recommended === 'beginner', `低分推荐 beginner (${resUI.recommended})`);
    rep.assert(resUI.dims === 5, `五维能力条渲染 5 条 (${resUI.dims})`);
    rep.assert(resUI.beginnerBtn, 'beginner 确认按钮存在');
    rep.assert(resUI.disabledBtn.indexOf('世界试炼开发中') >= 0, `foundation 按钮禁用+「世界试炼开发中」(${resUI.disabledBtn.trim()})`);
    rep.assert(resUI.html.indexOf('confirmTrack(\'foundation\')') < 0 && resUI.html.indexOf('confirmTrack("foundation")') < 0, '结果页无 foundation 确认入口');

    // 控制台强行 confirmTrack('foundation') → 守卫归一为 beginner
    await page.evaluate(() => Onboard.confirmTrack('foundation'));
    await page.waitForTimeout(300);
    let prof = await page.evaluate(() => State.learnerProfile);
    rep.assert(prof.learningTrack === 'beginner' && prof.confirmedTrack === 'beginner', `confirmTrack('foundation') 被守卫→beginner (${prof.learningTrack})`);
    rep.assert(prof.onboardingCompleted === true, 'onboarding 正常完成');
    rep.assert(prof.ageMode === 'standard', `ageMode 未写入 youth (${prof.ageMode})`);
    rep.assert(prof.assessmentCompleted === true && typeof prof.assessment.terminal === 'number', '五维分数已记录进档案');
    await ctx.close();

    // ═══ 场景 3: 高分路径 → 推荐 foundation, 仍只能进 beginner ═══
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(url(), { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.evaluate(() => Game.enterVillage());
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      Onboard.pickMode('standard');
      await new Promise(r => setTimeout(r, 80));
      Onboard.pickBasis('some');
      await new Promise(r => setTimeout(r, 80));
      for (let i = 0; i < AssessmentQuestions.length; i++) {
        const q = AssessmentQuestions[Onboard.state.qIdx];
        const right = q.opts.findIndex(o => o.s === 100);
        Onboard.answer(right >= 0 ? right : 0);
        await new Promise(r => setTimeout(r, 30));
      }
    });
    await page.waitForTimeout(300);
    resUI = await page.evaluate(() => ({
      recommended: Onboard.state.recommended,
      devNote: document.getElementById('ob-inner').innerHTML.indexOf('世界试炼开发中') >= 0,
      confirmFoundation: document.getElementById('ob-inner').innerHTML.match(/confirmTrack\('([^']+)'\)/g) || [],
    }));
    rep.assert(resUI.recommended === 'foundation', `高分推荐 foundation (${resUI.recommended})`);
    rep.assert(resUI.devNote, '高分结果页显示「世界试炼开发中」说明');
    rep.assert(resUI.confirmFoundation.every(s => s.indexOf('beginner') >= 0), `确认入口全部只指向 beginner (${resUI.confirmFoundation.join(',')})`);
    await page.evaluate(() => document.querySelector('#ob-inner .btn-primary').click());
    await page.waitForTimeout(300);
    prof = await page.evaluate(() => State.learnerProfile);
    rep.assert(prof.learningTrack === 'beginner', `高分用户最终进入 beginner (${prof.learningTrack})`);
    rep.assert(prof.recommendedTrack === 'foundation', `推荐结果 foundation 仍如实记录 (${prof.recommendedTrack})`);
    await ctx.close();

    // ═══ 场景 4: 旧用户升级 — 进度不丢 + gate 步 ═══
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(url(), { waitUntil: 'load' });
    await page.evaluate(() => {
      const old = { schemaVersion: 2, currentLevel: 'w1_3', xp: 120, totalStars: 9, achievements: ['ach_demo'], peipeiFound: false,
        levels: { ai_camp_1: { unlocked: true, completed: true, stars: 3 }, w1_1: { unlocked: true, completed: true, stars: 3 }, w1_2: { unlocked: true, completed: false, stars: 0 } } };
      localStorage.setItem('agent_village_d', JSON.stringify(old));
    });
    await page.goto(url(), { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.evaluate(() => Game.enterVillage());
    await page.waitForTimeout(400);
    const gateInfo = await page.evaluate(() => ({
      step: Onboard.state && Onboard.state.step,
      hasK01: !!document.querySelector('#ob-inner .ob-illu img[src*="K01"]'),
      xp: State.xp,
    }));
    rep.assert(gateInfo.step === 'gate', `老用户进入 gate 升级步 (${gateInfo.step})`);
    rep.assert(gateInfo.hasK01, 'gate 步渲染 K01 插画');
    await page.evaluate(() => Onboard.keepProgress());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      xp: State.xp, stars: State.totalStars,
      c1: State.levels.ai_camp_1.completed, c1s: State.levels.ai_camp_1.stars,
      w13: State.currentLevel, track: State.learnerProfile.learningTrack,
      onboarded: State.learnerProfile.onboardingCompleted, schema: State.schemaVersion,
    }));
    rep.assert(after.xp === 120 && after.stars === 9, `旧档 XP/星星保留 (xp=${after.xp}, stars=${after.stars})`);
    rep.assert(after.c1 === true && after.c1s === 3, '旧档通关记录保留');
    // 注入档不自洽(currentLevel=w1_3 但解锁链断在 ai_camp_2), _validateCurrentLevel(1.1.1冻结逻辑)
    // 应把前沿校正到「已完成关卡之后第一个可进入的 core」= ai_camp_2 —— 记录保留+前沿校正, 不算丢档
    rep.assert(after.w13 === 'ai_camp_2', `currentLevel 被 _validateCurrentLevel 校正到合法前沿 (${after.w13})`);
    rep.assert(after.track === 'beginner' && after.onboarded === true, `老用户 keepProgress → beginner (${after.track})`);
    rep.assert(after.schema === 3, `schemaVersion 迁移到 3 (${after.schema})`);

    // ═══ 场景 5: TrackPanel — beginner 用户 foundation 方向禁用 ═══
    const panelUI = await page.evaluate(() => {
      TrackPanel.show();
      const card = document.getElementById('track-card');
      return { html: card.innerHTML };
    });
    rep.assert(panelUI.html.indexOf('世界试炼开发中') >= 0, 'TrackPanel 显示「世界试炼开发中」');
    rep.assert(panelUI.html.indexOf('ob-btn-disabled') >= 0, 'TrackPanel foundation 方向按钮禁用');
    rep.assert(panelUI.html.indexOf('switchTrack()') < 0, 'TrackPanel 无可点击的 foundation 切换入口');
    const trackAfterSwitch = await page.evaluate(() => {
      window.confirm = () => true;
      TrackPanel.switchTrack();  // 应被守卫拦下
      return State.learnerProfile.learningTrack;
    });
    rep.assert(trackAfterSwitch === 'beginner', `switchTrack() 被守卫, 仍为 beginner (${trackAfterSwitch})`);

    // ═══ 场景 6: 旧 foundation 档案不破坏 + 可切回 beginner ═══
    await page.evaluate(() => {
      const p = State.learnerProfile;
      p.confirmedTrack = 'foundation'; p.learningTrack = 'foundation';
      State.save();
    });
    await page.goto(url(), { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const fInfo = await page.evaluate(() => {
      const t = getActiveTrack();
      TrackPanel.show();
      const html = document.getElementById('track-card').innerHTML;
      return { track: t.id, xp: State.xp, canSwitchBack: html.indexOf('switchTrack()') >= 0 && html.indexOf('零基础成长线') >= 0 };
    });
    rep.assert(fInfo.track === 'foundation', `旧 foundation 档案载入不被改写 (${fInfo.track})`);
    rep.assert(fInfo.xp === 120, `foundation 旧档进度保留 (xp=${fInfo.xp})`);
    rep.assert(fInfo.canSwitchBack, 'foundation 用户可切回零基础成长线 (按钮可用)');

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
