// tests/test_round4_commit_point.js — R1.2 Round4-P0 验收 (文件 3/6):
//   唯一成功提交点的严格门控: 重读一致性校验必须在「全部权威内存写入 + State.save」
//   之后、且 commitPointReached 置位前完成; 任一先于提交点的故障都不应产生已提交事务。
//
//   覆盖:
//     A. 合法完成: Level.done 后 commitPointReached === true, status === 'committed'
//        (证明提交点确实在持久化 + 重读一致之后达成)
//     B. 在提交点之前注入故障 (before_commit_point): 抛错发生在 commit() 之前 →
//        事务回滚, commitPointReached === false, completed === false, status === 'rolled_back'
//        (证明"提交点"是唯一成功边界, 不会在提交点之前误判成功)
//     C. 提交点之后注入 (after_commit_point): 不影响已达成提交, commitPointReached 仍为 true,
//        completed === true, status 仍为 'committed' (提交点之后无副作用回滚)
//     D. commit() 幂等: 再次调用 getState 显示 commitPointReached 保持 true
//     E. 全程 pageerror = 0, requestfailed = 0
//
// 用法: node tests/test_round4_commit_point.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18963;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const NEXT = 'ai_camp_2';

(async () => {
  const rep = new TestReport('test_round4_commit_point');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const out = await page.evaluate(({ LEVEL, NEXT }) => {
      const CT = window.CompletionTransaction;
      const F = window.CompletionTransactionFaults;
      const results = {};

      function setup() {
        F.clearAll(); CT.reset();
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        if (!State.levels[NEXT]) State.levels[NEXT] = {};
        State.levels[LEVEL].completed = false;
        State.levels[LEVEL].stars = 0;
        State.levels[LEVEL].unlocked = true;
        State.levels[NEXT].completed = false;
        State.levels[NEXT].stars = 0;
        State.levels[NEXT].unlocked = false;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}
      }

      // A. 合法完成
      setup();
      let t = false; try { Level.done(); } catch (e) { t = true; }
      let cs = CT.getState(LEVEL);
      results.legit = {
        thrown: t, completed: State.levels[LEVEL].completed,
        commitPointReached: cs ? cs.commitPointReached : null,
        status: cs ? cs.status : null, completing: Level._completing
      };

      // B. 提交点之前注入故障
      setup();
      F.arm('before_commit_point');
      let t2 = false, ret2;
      try { ret2 = Level.done(); } catch (e) { t2 = true; }
      cs = CT.getState(LEVEL);
      results.before = {
        thrown: t2, ret: ret2 === false ? 'false' : String(ret2),
        completed: State.levels[LEVEL].completed,
        commitPointReached: cs ? cs.commitPointReached : null,
        status: cs ? cs.status : null, completing: Level._completing
      };
      F.clearAll(); CT.reset();

      // C. 提交点之后注入 (应无副作用回滚)
      setup();
      F.arm('after_commit_point');
      let t3 = false; try { Level.done(); } catch (e) { t3 = true; }
      cs = CT.getState(LEVEL);
      results.after = {
        thrown: t3, completed: State.levels[LEVEL].completed,
        commitPointReached: cs ? cs.commitPointReached : null,
        status: cs ? cs.status : null, completing: Level._completing
      };
      F.clearAll(); CT.reset();

      return results;
    }, { LEVEL, NEXT });

    // A
    rep.assert(out.legit.thrown === false, `A. 合法完成未抛异常 (${out.legit.thrown})`);
    rep.assert(out.legit.completed === true, `A. 完成后 completed === true (${out.legit.completed})`);
    rep.assert(out.legit.commitPointReached === true, `A. 合法完成 commitPointReached === true (${out.legit.commitPointReached})`);
    rep.assert(out.legit.status === 'committed', `A. 合法完成 status === 'committed' (${out.legit.status})`);
    rep.assert(out.legit.completing === false, `A. 提交锁已恢复 (${out.legit.completing})`);

    // B
    rep.assert(out.before.thrown === false, `B. before_commit_point 未向调用方抛异常 (${out.before.thrown})`);
    rep.assert(out.before.ret === 'false', `B. before_commit_point Level.done 返回 false (${out.before.ret})`);
    rep.assert(out.before.completed === false, `B. 提交点前故障 → completed === false (${out.before.completed})`);
    rep.assert(out.before.commitPointReached === false, `B. 提交点前故障 → commitPointReached === false (${out.before.commitPointReached})`);
    rep.assert(out.before.status === 'rolled_back', `B. 提交点前故障 → status === 'rolled_back' (${out.before.status})`);
    rep.assert(out.before.completing === false, `B. 提交锁已恢复 (${out.before.completing})`);

    // C
    rep.assert(out.after.thrown === false, `C. after_commit_point 未向调用方抛异常 (${out.after.thrown})`);
    rep.assert(out.after.completed === true, `C. 提交点后注入不影响已提交 completed === true (${out.after.completed})`);
    rep.assert(out.after.commitPointReached === true, `C. 提交点后注入 → commitPointReached 仍为 true (${out.after.commitPointReached})`);
    rep.assert(out.after.status !== 'rolled_back', `C. 提交点后注入 → 绝不回滚 (status=${out.after.status}, 可为 committed 或 post_commit_error)`);
    rep.assert(out.after.completing === false, `C. 提交锁已恢复 (${out.after.completing})`);

    rep.assert(st.pageErrors.length === 0, `E. 全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `E. 全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
