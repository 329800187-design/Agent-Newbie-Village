// tests/test_round3_no_answer_leak.js — R1.2 Round3-R1 验收:
//   验证 ErrorFeedback 绝不泄露完成标准答案(protectedAnswerFragments):
//     - 9 关均定义 protectedAnswerFragments
//     - 第 1 / 2 / 3 次错误反馈(repairAction/whatWentWrong/whyItHappened 等)
//       均不包含任一 protectedAnswerFragment
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_no_answer_leak.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18946;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_no_answer_leak');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const levels = await page.evaluate(() => window.Round3Levels);
    rep.assert(Array.isArray(levels) && levels.length === 9, `Round3 共 9 关 (${levels.length})`);

    for (const id of levels) {
      const data = await page.evaluate((id) => {
        const rep0 = window.LevelExperienceRegistry[id];
        const frags = (rep0 && rep0.protectedAnswerFragments) || [];
        const hints = (rep0 && rep0.errorHints) || [];
        // 渲染以确保 level-content 容器存在
        window.InteractionProgress.reset(id);
        Level.render(id);
        Game.switch('level-page');
        const EF = window.ErrorFeedback;
        const attempts = [];
        for (let i = 0; i < 3; i++) {
          EF.clear(id);
          EF.recordAttempt(id);
          EF.show(id, hints);
          const s = EF.getState(id);
          const text = [s.errorType, s.whatWentWrong, s.whyItHappened, s.repairAction, s.verificationMethod].join(' ');
          attempts.push({ attempt: s.attemptCount, text: text });
        }
        return { frags, attempts };
      }, id);

      rep.assert(data.frags.length >= 1, `${id} 定义了 protectedAnswerFragments (${data.frags.length} 条)`);

      data.attempts.forEach(a => {
        data.frags.forEach(frag => {
          rep.assert(a.text.indexOf(frag) < 0,
            `${id} 第 ${a.attempt} 次反馈不含保护片段「${frag}」`);
        });
      });
    }

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
