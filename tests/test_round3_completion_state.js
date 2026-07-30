// tests/test_round3_completion_state.js — R1.2 Round3-R2 验收:
//   验证完成态一致性:
//     - 完成前 0/4 → 当前步骤 1/4
//     - 完成一步 1/4 → 当前步骤 2/4
//     - 全部完成 4/4 → 当前步骤 已完成
//     - DOM 不得出现分子大于分母(如 "5 / 4")
//   失败原因清理(Section 三):
//     - 先 fail 写入旧失败原因 → failReason 有值, DOM 显示该原因
//     - 随后完成全部步骤并 clearFailure(即 Level.done 成功分支所调用) → failReason === null
//     - DOM 显示"未完成原因：无"; submitAllowed === true
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_completion_state.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18947;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_completion_state');
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
      typeof window.InteractionProgress.currentLabel === 'function' &&
      typeof window.InteractionProgress.clearFailure === 'function'),
      'InteractionProgress 含 currentLabel / clearFailure 方法');

    // ═══ 1) 当前步骤标签进度(0/4 → 1/4 → 2/4 → 已完成) ═══
    const prog = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      const panelText = () => { const p = document.getElementById('r3-iprog'); return p ? p.textContent : ''; };
      const curRow = (txt) => {
        const m = txt.match(/当前步骤：((?:\d+ \/ \d+)|已完成|—)/);
        return m ? m[1].trim() : '';
      };
      // 杜绝 "X / Y" 中分子>分母
      const badOverflow = (txt) => {
        const m = txt.match(/当前步骤：(\d+) \/ (\d+)/);
        if (!m) return false;
        return parseInt(m[1], 10) > parseInt(m[2], 10);
      };

      IP.reset('ai_camp_11');
      Level.render('ai_camp_11');
      Game.switch('level-page');
      await w(120);
      const t0 = panelText();
      const initCur = curRow(t0);
      const initOverflow = badOverflow(t0);

      IP.complete('ai_camp_11', 'recall');
      await w(60);
      const t1 = panelText();
      const after1Cur = curRow(t1);
      const after1Overflow = badOverflow(t1);

      IP.complete('ai_camp_11', 'example');
      IP.complete('ai_camp_11', 'verify');
      IP.complete('ai_camp_11', 'principle');
      await w(60);
      const t2 = panelText();
      const allDoneCur = curRow(t2);
      const allDoneOverflow = badOverflow(t2);
      const allDoneRow = /已完成 \/ 总步骤：4 \/ 4/.test(t2);

      return { initCur, initOverflow, after1Cur, after1Overflow, allDoneCur, allDoneOverflow, allDoneRow };
    });
    rep.assert(prog.initCur === '1 / 4', `完成前: 当前步骤 1/4 (${prog.initCur})`);
    rep.assert(prog.initOverflow === false, '完成前: 当前步骤无分子>分母溢出');
    rep.assert(prog.after1Cur === '2 / 4', `完成一步: 当前步骤 2/4 (${prog.after1Cur})`);
    rep.assert(prog.after1Overflow === false, '完成一步: 当前步骤无溢出');
    rep.assert(prog.allDoneCur === '已完成', `全部完成: 当前步骤 已完成 (${prog.allDoneCur})`);
    rep.assert(prog.allDoneOverflow === false, '全部完成: 当前步骤无溢出(绝不 5/4)');
    rep.assert(prog.allDoneRow, '全部完成: 面板显示「已完成 / 总步骤：4 / 4」');

    // ═══ 2) 先 fail 写旧失败原因 → 完成全部并 clearFailure → 原因清空 ═══
    const flow = await page.evaluate(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const IP = window.InteractionProgress;
      const panelText = () => { const p = document.getElementById('r3-iprog'); return p ? p.textContent : ''; };

      IP.reset('ai_camp_11');
      Level.render('ai_camp_11');
      Game.switch('level-page');
      await w(120);

      // 先失败: 写入旧失败原因
      IP.fail('ai_camp_11', null, '旧失败原因：步骤顺序写反了');
      await w(60);
      const afterFail = IP.getState('ai_camp_11').failReason;
      const domFail = panelText();

      // 随后完成全部步骤
      window.LevelExperienceRegistry['ai_camp_11'].interactionSteps.forEach(s => IP.complete('ai_camp_11', s.id));
      await w(60);

      // Level.done 成功分支会调用 clearFailure(id): 这里直接等效调用该清理逻辑
      IP.clearFailure('ai_camp_11');
      await w(60);
      const afterClear = IP.getState('ai_camp_11').failReason;
      const submitAllowed = IP.getState('ai_camp_11').submitAllowed;
      const domClear = panelText();

      return {
        afterFailHas: !!(afterFail && afterFail.length),
        domFailHasReason: domFail.indexOf('旧失败原因：步骤顺序写反了') >= 0,
        afterClear,
        submitAllowed,
        domClearNoReason: domClear.indexOf('未完成原因：无') >= 0,
        domClearBadOverflow: /当前步骤：(\d+) \/ (\d+)/.test(domClear) &&
          parseInt(domClear.match(/当前步骤：(\d+) \/ (\d+)/)[1], 10) >
          parseInt(domClear.match(/当前步骤：(\d+) \/ (\d+)/)[2], 10),
      };
    });
    rep.assert(flow.afterFailHas, '失败后: failReason 有值');
    rep.assert(flow.domFailHasReason, '失败后: DOM 显示旧失败原因');
    rep.assert(flow.afterClear === null, `成功后 clearFailure: failReason === null (${flow.afterClear})`);
    rep.assert(flow.submitAllowed === true, `成功后: submitAllowed === true (${flow.submitAllowed})`);
    rep.assert(flow.domClearNoReason, '成功后: DOM 显示「未完成原因：无」');
    rep.assert(flow.domClearBadOverflow === false, '成功后: DOM 当前步骤无 "5 / 4" 等溢出');

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
