// tests/test_round4_post_commit_error.js — R1.2 Round4-P0 验收 (文件 4/6):
//   阶段 C (展示) 异常 → 不回滚已提交事务, 仅标记 post_commit_error。
//
//   覆盖:
//     A. during_toast (同步): _showCompletion 中 toast 阶段抛错 → 捕获并 markPostCommitError;
//        已完成事务保持 committed (completed === true, commitPointReached === true,
//        status === 'post_commit_error'), 不发生回滚, Level._completing === false
//     B. during_completion_ui (异步, setTimeout 1400ms 内): 展示导航阶段抛错 →
//        异步捕获并 markPostCommitError; 等待展示阶段完成后:
//        completed === true, commitPointReached === true, status === 'post_commit_error', 不回滚
//     C. 全程 pageerror = 0 (异常被显式捕获, 不冒泡为 pageerror)
//     D. requestfailed = 0
//
//   设计依据: 阶段 B 已成功提交 + 持久化, 阶段 C 仅是展示/导航; 展示失败不应撤销已通关事实。
//
// 用法: node tests/test_round4_post_commit_error.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18964;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';

(async () => {
  const rep = new TestReport('test_round4_post_commit_error');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const out = await page.evaluate((LEVEL) => {
      const CT = window.CompletionTransaction;
      const F = window.CompletionTransactionFaults;
      const results = {};

      function setup() {
        F.clearAll(); CT.reset();
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        State.levels[LEVEL].completed = false;
        State.levels[LEVEL].stars = 0;
        State.levels[LEVEL].unlocked = true;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}
      }

      // A. during_toast (同步)
      setup();
      F.arm('during_toast');
      let t = false; try { Level.done(); } catch (e) { t = true; }
      let cs = CT.getState(LEVEL);
      results.sync = {
        thrown: t,
        completed: State.levels[LEVEL].completed,
        commitPointReached: cs ? cs.commitPointReached : null,
        status: cs ? cs.status : null,
        completing: Level._completing
      };
      F.clearAll(); CT.reset();

      // B. during_completion_ui (异步)
      setup();
      F.arm('during_completion_ui');
      let t2 = false; try { Level.done(); } catch (e) { t2 = true; }
      let csImm = CT.getState(LEVEL);
      results.asyncImmediate = {
        thrown: t2,
        completed: State.levels[LEVEL].completed,
        commitPointReached: csImm ? csImm.commitPointReached : null,
        statusImmediate: csImm ? csImm.status : null,
        completing: Level._completing
      };
      // 不在此处 clearAll, 等待展示阶段 (1400ms) 触发异步 markPostCommitError
      // 由外部等待后读取最终状态

      return { sync: results.sync, asyncImmediate: results.asyncImmediate };
    }, LEVEL);

    // 等待 1400ms 展示阶段完成, 暴露异步异常并触发 markPostCommitError
    await new Promise(r => setTimeout(r, 1700));

    const asyncFinal = await page.evaluate((LEVEL) => {
      const CT = window.CompletionTransaction;
      const cs = CT.getState(LEVEL);
      const r = {
        completed: State.levels[LEVEL].completed,
        commitPointReached: cs ? cs.commitPointReached : null,
        status: cs ? cs.status : null,
        completing: Level._completing
      };
      window.CompletionTransactionFaults.clearAll();
      window.CompletionTransaction.reset();
      return r;
    }, LEVEL);

    // A. during_toast
    rep.assert(out.sync.thrown === false, `A. during_toast 未向调用方抛异常 (${out.sync.thrown})`);
    rep.assert(out.sync.completed === true, `A. during_toast: 已完成事务保持 completed === true (${out.sync.completed})`);
    rep.assert(out.sync.commitPointReached === true, `A. during_toast: commitPointReached === true (${out.sync.commitPointReached})`);
    rep.assert(out.sync.status === 'post_commit_error', `A. during_toast: status === 'post_commit_error' (${out.sync.status})`);
    rep.assert(out.sync.completing === false, `A. during_toast: 提交锁已恢复 (${out.sync.completing})`);

    // B. during_completion_ui (异步)
    rep.assert(out.asyncImmediate.thrown === false, `B. during_completion_ui 同步段未抛异常 (${out.asyncImmediate.thrown})`);
    rep.assert(out.asyncImmediate.completed === true, `B. during_completion_ui: 已完成 completed === true (${out.asyncImmediate.completed})`);
    rep.assert(out.asyncImmediate.commitPointReached === true, `B. during_completion_ui: commitPointReached === true (${out.asyncImmediate.commitPointReached})`);
    rep.assert(asyncFinal.completed === true, `B. 异步完成后 completed 仍为 true (不回滚) (${asyncFinal.completed})`);
    rep.assert(asyncFinal.commitPointReached === true, `B. 异步完成后 commitPointReached 仍为 true (${asyncFinal.commitPointReached})`);
    rep.assert(asyncFinal.status === 'post_commit_error', `B. 异步完成后 status === 'post_commit_error' (${asyncFinal.status})`);
    rep.assert(asyncFinal.completing === false, `B. 异步完成后提交锁已恢复 (${asyncFinal.completing})`);

    rep.assert(st.pageErrors.length === 0, `C. 全程 pageerror = 0 (异常已被显式捕获) (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `D. 全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
