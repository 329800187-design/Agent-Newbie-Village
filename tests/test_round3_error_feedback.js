// tests/test_round3_error_feedback.js — R1.2 Round3 验收:
//   验证 ErrorFeedback 公共错误反馈对象(渐进式提示, 绝不泄露正确答案 / 不绕过 gate):
//     - 第 1 次错误给「方向」级提示, 第 2 次更具体, 第 3 次展示完整步骤
//     - 不展示正确答案(completionCriteria); 第 3 次起 canRetry=false
//     - clear 后状态清空
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_error_feedback.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18942;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_error_feedback');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    rep.assert(await page.evaluate(() => typeof window.ErrorFeedback === 'object'),
      'window.ErrorFeedback 全局对象存在');

    // 取 ai_camp_11 的渐进式提示(3 级)与真实答案(completionCriteria, 绝不应出现在反馈中)
    const setup = await page.evaluate(() => {
      const rep = window.LevelExperienceRegistry['ai_camp_11'];
      return {
        hints: rep.errorHints,
        answer: (rep.completionCriteria || []).join(' ')
      };
    });
    rep.assert(setup.hints && setup.hints.length >= 3,
      `ai_camp_11 含 >=3 级错误提示 (${setup.hints ? setup.hints.length : 0} 级)`);

    // ═══ 1) 第 1 次尝试: 方向级提示, canRetry=true, 未展示完整步骤 ═══
    const a1 = await page.evaluate(() => {
      const EF = window.ErrorFeedback;
      const hints = window.LevelExperienceRegistry['ai_camp_11'].errorHints;
      EF.clear('ai_camp_11');
      EF.recordAttempt('ai_camp_11');
      EF.show('ai_camp_11', hints);
      const s = EF.getState('ai_camp_11');
      const panel = document.getElementById('r3-err-feedback');
      return {
        attempt: s.attemptCount, canRetry: s.canRetry, full: s._shownFullSteps,
        type: s.errorType,
        panelText: panel ? panel.textContent : '',
        panelAttempt: panel ? (panel.textContent.match(/第\s*(\d+)\s*次尝试/) || [])[1] : null
      };
    });
    rep.assert(a1.attempt === 1, `第 1 次尝试 attemptCount=1 (${a1.attempt})`);
    rep.assert(a1.canRetry === true, `第 1 次尝试 canRetry=true (${a1.canRetry})`);
    rep.assert(a1.full === false, `第 1 次尝试 未展示完整步骤 (_shownFullSteps=false) (${a1.full})`);
    rep.assert(a1.type === setup.hints[0].errorType, `第 1 次尝试 提示为方向级(${a1.type})`);
    rep.assert(a1.panelText.indexOf(setup.hints[0].whatWentWrong) >= 0, '第 1 次尝试 面板含方向级「哪里不对」文案');
    rep.assert(a1.panelAttempt === '1', `第 1 次尝试 面板标注「第 1 次尝试」(${a1.panelAttempt})`);
    rep.assert(a1.panelText.indexOf(setup.answer) < 0, '第 1 次尝试 面板不泄露正确答案(completionCriteria)');

    // ═══ 2) 第 2 次尝试: 更具体提示, 仍 canRetry=true ═══
    const a2 = await page.evaluate(() => {
      const EF = window.ErrorFeedback;
      const hints = window.LevelExperienceRegistry['ai_camp_11'].errorHints;
      EF.recordAttempt('ai_camp_11');
      EF.show('ai_camp_11', hints);
      const s = EF.getState('ai_camp_11');
      const panel = document.getElementById('r3-err-feedback');
      return {
        attempt: s.attemptCount, canRetry: s.canRetry, full: s._shownFullSteps,
        type: s.errorType,
        panelText: panel ? panel.textContent : ''
      };
    });
    rep.assert(a2.attempt === 2, `第 2 次尝试 attemptCount=2 (${a2.attempt})`);
    rep.assert(a2.canRetry === true, `第 2 次尝试 canRetry=true (${a2.canRetry})`);
    rep.assert(a2.full === false, `第 2 次尝试 未展示完整步骤 (_shownFullSteps=false) (${a2.full})`);
    rep.assert(a2.type === setup.hints[1].errorType, `第 2 次尝试 提示更具体(${a2.type})`);
    rep.assert(a2.panelText.indexOf(setup.hints[1].whatWentWrong) >= 0, '第 2 次尝试 面板含更具体「哪里不对」文案');
    rep.assert(a2.panelText.indexOf(setup.answer) < 0, '第 2 次尝试 面板不泄露正确答案');

    // ═══ 3) 第 3 次尝试: 完整步骤, canRetry=false ═══
    const a3 = await page.evaluate(() => {
      const EF = window.ErrorFeedback;
      const hints = window.LevelExperienceRegistry['ai_camp_11'].errorHints;
      EF.recordAttempt('ai_camp_11');
      EF.show('ai_camp_11', hints);
      const s = EF.getState('ai_camp_11');
      const panel = document.getElementById('r3-err-feedback');
      return {
        attempt: s.attemptCount, canRetry: s.canRetry, full: s._shownFullSteps,
        type: s.errorType,
        panelText: panel ? panel.textContent : ''
      };
    });
    rep.assert(a3.attempt === 3, `第 3 次尝试 attemptCount=3 (${a3.attempt})`);
    rep.assert(a3.canRetry === false, `第 3 次尝试 canRetry=false (${a3.canRetry})`);
    rep.assert(a3.full === true, `第 3 次尝试 展示完整步骤 (_shownFullSteps=true) (${a3.full})`);
    rep.assert(a3.type === setup.hints[2].errorType, `第 3 次尝试 提示为完整步骤级(${a3.type})`);
    rep.assert(a3.panelText.indexOf(setup.hints[2].whatWentWrong) >= 0, '第 3 次尝试 面板含完整步骤文案');
    rep.assert(a3.panelText.indexOf(setup.answer) < 0, '第 3 次尝试 面板仍不泄露正确答案');
    rep.assert(a3.panelText.indexOf('已给出完整步骤') >= 0, '第 3 次尝试 面板提示「已给出完整步骤，请按步骤检查」');

    // ═══ 4) clear 后状态清空 ═══
    const clr = await page.evaluate(() => {
      const EF = window.ErrorFeedback;
      EF.clear('ai_camp_11');
      return EF.getState('ai_camp_11');
    });
    rep.assert(clr === null, `clear 后 getState 返回 null (${clr})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
