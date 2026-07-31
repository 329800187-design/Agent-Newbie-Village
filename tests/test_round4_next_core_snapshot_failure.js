// tests/test_round4_next_core_snapshot_failure.js — R1.2 Round4-P0-R2 精准修复 (文件 4/4):
//   §五 nextCoreOf() 不得静默吞异常: getNextCoreLevel 抛错 → 快照失败 → 不创建缺下一关
//   信息的快照; 事务进入 preflight_failed 终态, 无任何权威状态写入。
//
//   断言:
//     Level.done() 不抛出(内部已捕获);
//     返回 false;
//     status === 'preflight_failed';
//     completed === false (无权威写入);
//     xp / stars / unlocked 不变;
//     Level._completing === false;
//     diagnostics 包含 CompletionTransaction.nextCoreOf。
//
// 用法: node tests/test_round4_next_core_snapshot_failure.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18974;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';

(async () => {
  const rep = new TestReport('test_round4_next_core_snapshot_failure');
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
      const R3D = window.Round3Diagnostics;
      const origGetNextCore = window.getNextCoreLevel;

      F.clearAll(); CT.reset();
      if (R3D && R3D.clear) R3D.clear();
      if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
      State.levels[LEVEL].completed = false;
      State.levels[LEVEL].stars = 0;
      State.levels[LEVEL].unlocked = true;
      State.currentLevel = LEVEL;
      State.xp = 0; State.totalStars = 0; State.achievements = [];
      Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
      try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
      try { State.save(); } catch (e) {}

      const before = {
        completed: State.levels[LEVEL].completed,
        xp: State.xp,
        stars: State.levels[LEVEL].stars,
        unlocked: State.levels[LEVEL].unlocked,
        currentLevel: State.currentLevel
      };

      // 注入: getNextCoreLevel 抛错(模拟无法确定下一核心关)
      window.getNextCoreLevel = function () { throw new Error('injected getNextCoreLevel'); };

      let thrown = false, ret;
      try { ret = Level.done(); } catch (e) { thrown = true; }
      const cs = CT.getState(LEVEL);
      const diagHit = (R3D && R3D.errors)
        ? R3D.errors.some(function (e) { return (e.scope || '') === 'CompletionTransaction.nextCoreOf'; })
        : false;
      const snapshotCreated = !!(cs && cs.snapshotFields);  // 不应创建快照字段

      // 还原
      window.getNextCoreLevel = origGetNextCore;
      F.clearAll(); CT.reset();

      return {
        thrown: thrown,
        ret: ret === false ? 'false' : (ret === true ? 'true' : String(ret)),
        status: cs ? cs.status : null,
        phase: cs ? cs.phase : null,
        commitPointReached: cs ? cs.commitPointReached : null,
        completed: State.levels[LEVEL].completed,
        xp: State.xp,
        stars: State.levels[LEVEL].stars,
        unlocked: State.levels[LEVEL].unlocked,
        currentLevel: State.currentLevel,
        completing: Level._completing,
        diagHit: diagHit,
        snapshotCreated: snapshotCreated,
        before: before
      };
    }, LEVEL);

    rep.assert(out.thrown === false, `Level.done() 未向调用方抛异常(内部已捕获) (${out.thrown})`);
    rep.assert(out.ret === 'false', `Level.done() 返回 false (${out.ret})`);
    rep.assert(out.status === 'preflight_failed', `status === 'preflight_failed' (${out.status})`);
    rep.assert(out.phase === 'mutating' || out.phase === 'preflight_failed', `phase 未残留 validating/idle (${out.phase})`);
    rep.assert(out.commitPointReached === false, `commitPointReached === false (${out.commitPointReached})`);
    rep.assert(out.completed === false, `completed === false (无权威写入) (${out.completed})`);
    rep.assert(out.xp === out.before.xp, `xp 不变 (${out.xp} === ${out.before.xp})`);
    rep.assert(out.stars === out.before.stars, `stars 不变 (${out.stars} === ${out.before.stars})`);
    rep.assert(out.unlocked === out.before.unlocked, `unlocked 不变 (${out.unlocked} === ${out.before.unlocked})`);
    rep.assert(out.currentLevel === out.before.currentLevel, `currentLevel 不变 (${out.currentLevel} === ${out.before.currentLevel})`);
    rep.assert(out.completing === false, `Level._completing === false (${out.completing})`);
    rep.assert(out.diagHit === true, `diagnostics 包含 CompletionTransaction.nextCoreOf (${out.diagHit})`);
    rep.assert(out.snapshotCreated === false, `未创建缺下一关信息的快照 (snapshotFields 为空) (${out.snapshotCreated})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
