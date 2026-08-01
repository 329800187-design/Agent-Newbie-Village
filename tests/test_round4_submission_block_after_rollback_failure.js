// tests/test_round4_submission_block_after_rollback_failure.js — R1.2 Round4-P0-R3 精准修复 (文件 2/4):
//   §五/§六/§七 失败后的第二次提交必须被阻止: rollback_failed / rollback_persist_failed 写入
//   独立 unsafe 提交锁, Level.done() 在门禁/begin/snapshot/权威写入前检查, 阻止该关重试。
//
//   覆盖(§九.2):
//     A. 内存回滚失败(xp 残留=10) → 第二次 Level.done() 返回 false, completed=false,
//        commitPointReached=false, xp 仍为10(不得再+100), diagnostics 含 submission_blocked
//     B. 持久化回滚失败 → 第二次 Level.done() 同样返回 false, 被阻止
//
// 用法: node tests/test_round4_submission_block_after_rollback_failure.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18982;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'w1_3';
const NEXT = 'w1_4';
const SAVE_KEY = 'agent_village_d';

(async () => {
  const rep = new TestReport('test_round4_submission_block_after_rollback_failure');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    // ── A. 内存回滚失败 → 重试被阻止 ──
    const A = await page.evaluate(({ LEVEL, NEXT, SAVE_KEY }) => {
      const CT = window.CompletionTransaction;
      const R3D = window.Round3Diagnostics;
      CT.reset(); CT.clearSubmissionBlockForTest(LEVEL);
      if (R3D && R3D.clear) R3D.clear();
      localStorage.removeItem(SAVE_KEY);
      if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
      if (!State.levels[NEXT]) State.levels[NEXT] = {};
      State.levels[LEVEL].completed = false; State.levels[LEVEL].stars = 0; State.levels[LEVEL].unlocked = true;
      State.levels[NEXT].completed = false; State.levels[NEXT].stars = 0; State.levels[NEXT].unlocked = false;
      State.currentLevel = LEVEL; State.xp = 0; State.totalStars = 0; State.achievements = [];
      try { State.save(); } catch (e) {}

      CT.begin(LEVEL); CT.snapshot(LEVEL);
      // 模拟完成写入
      State.xp = 10; State.totalStars = 3; State.achievements = ['w6_complete'];
      State.levels[LEVEL].completed = true;
      State.levels[NEXT].completed = true; State.levels[NEXT].unlocked = true;
      State.currentLevel = NEXT;
      // 注入 xp 恢复故障(恢复赋值不可写 → 残留 10)
      Object.defineProperty(State, 'xp', { value: State.xp, writable: false, configurable: true });
      const res = CT.rollback(LEVEL, new Error('memory rollback failed'));
      const cs = CT.getState(LEVEL);
      Object.defineProperty(State, 'xp', { writable: true, configurable: true });

      // 此时 unsafeLevels[LEVEL] 已写入(blocked)
      const blockedBefore = CT.isSubmissionBlocked(LEVEL);

      // 第二次提交(重试)
      Level.current = LEVEL; Level._completing = false;
      State.levels[LEVEL].completed = false; // 确保未通过幂等守卫
      let ret2 = false;
      try { ret2 = Level.done(); } catch (e) { ret2 = 'threw'; }
      const cs2 = CT.getState(LEVEL);
      const diagHit = (R3D && R3D.errors)
        ? R3D.errors.some(function (e) { return (e.scope || '').indexOf('CompletionTransaction.submission_blocked') >= 0; })
        : false;

      CT.clearSubmissionBlockForTest(LEVEL);
      CT.reset();
      return {
        firstStatus: cs ? cs.status : null,
        firstMemoryRestored: res.memoryRestored,
        firstSuccess: res.success,
        blockedBefore: blockedBefore,
        retryRet: ret2,
        retryCompleted: State.levels[LEVEL].completed,
        retryCommitPoint: cs2 ? cs2.commitPointReached : null,
        retryXp: State.xp,
        diagHit: diagHit
      };
    }, { LEVEL, NEXT, SAVE_KEY });

    rep.assert(A.firstStatus === 'rollback_failed', `A. 首轮内存回滚失败 → status === 'rollback_failed' (${A.firstStatus})`);
    rep.assert(A.firstMemoryRestored === false, `A. 首轮 memoryRestored === false (残留 xp=10) (${A.firstMemoryRestored})`);
    rep.assert(A.firstSuccess === false, `A. 首轮 success === false (${A.firstSuccess})`);
    rep.assert(A.blockedBefore === true, `A. 失败后 unsafe 提交锁已写入(重试前 isSubmissionBlocked=true) (${A.blockedBefore})`);
    rep.assert(A.retryRet === false, `A. 第二次 Level.done() 返回 false(被安全锁阻止) (${A.retryRet})`);
    rep.assert(A.retryCompleted === false, `A. 重试不得完成该关 completed === false (${A.retryCompleted})`);
    rep.assert(A.retryCommitPoint === false, `A. 重试不得越过提交点 commitPointReached === false (${A.retryCommitPoint})`);
    rep.assert(A.retryXp === 10, `A. 重试不得再增加100 xp, 仍为残留 10 (${A.retryXp})`);
    rep.assert(A.diagHit === true, `A. diagnostics 含 CompletionTransaction.submission_blocked (${A.diagHit})`);

    // ── B. 持久化回滚失败 → 重试被阻止 ──
    const B = await page.evaluate(({ LEVEL, NEXT, SAVE_KEY }) => {
      const CT = window.CompletionTransaction;
      const R3D = window.Round3Diagnostics;
      CT.reset(); CT.clearSubmissionBlockForTest(LEVEL);
      if (R3D && R3D.clear) R3D.clear();
      localStorage.removeItem(SAVE_KEY);
      if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
      if (!State.levels[NEXT]) State.levels[NEXT] = {};
      State.levels[LEVEL].completed = false; State.levels[LEVEL].stars = 0; State.levels[LEVEL].unlocked = true;
      State.levels[NEXT].completed = false; State.levels[NEXT].stars = 0; State.levels[NEXT].unlocked = false;
      State.currentLevel = LEVEL; State.xp = 0; State.totalStars = 0; State.achievements = [];
      try { State.save(); } catch (e) {} // 此时持久化存在(=snap.persistedSave)

      CT.begin(LEVEL); CT.snapshot(LEVEL);
      State.xp = 10; State.totalStars = 3; State.achievements = ['w6_complete'];
      State.levels[LEVEL].completed = true;
      State.levels[NEXT].completed = true; State.levels[NEXT].unlocked = true;
      State.currentLevel = NEXT;
      // 注入持久化恢复故障: 先移除存档使其与快照不一致, 再让 setItem 抛错
      localStorage.removeItem(SAVE_KEY);
      const origSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function () { throw new Error('injected setItem'); };
      const res = CT.rollback(LEVEL, new Error('persist rollback failed'));
      localStorage.setItem = origSet;
      const cs = CT.getState(LEVEL);

      const blockedBefore = CT.isSubmissionBlocked(LEVEL);

      Level.current = LEVEL; Level._completing = false;
      State.levels[LEVEL].completed = false;
      let ret2 = false;
      try { ret2 = Level.done(); } catch (e) { ret2 = 'threw'; }
      const cs2 = CT.getState(LEVEL);
      const diagHit = (R3D && R3D.errors)
        ? R3D.errors.some(function (e) { return (e.scope || '').indexOf('CompletionTransaction.submission_blocked') >= 0; })
        : false;

      CT.clearSubmissionBlockForTest(LEVEL);
      CT.reset();
      return {
        firstStatus: cs ? cs.status : null,
        firstPersistRestored: res.persistenceRestored,
        firstSuccess: res.success,
        blockedBefore: blockedBefore,
        retryRet: ret2,
        retryCompleted: State.levels[LEVEL].completed,
        retryCommitPoint: cs2 ? cs2.commitPointReached : null,
        retryXp: State.xp,
        diagHit: diagHit
      };
    }, { LEVEL, NEXT, SAVE_KEY });

    rep.assert(B.firstStatus === 'rollback_persist_failed', `B. 首轮持久化回滚失败 → status === 'rollback_persist_failed' (${B.firstStatus})`);
    rep.assert(B.firstPersistRestored === false, `B. 首轮 persistenceRestored === false (${B.firstPersistRestored})`);
    rep.assert(B.firstSuccess === false, `B. 首轮 success === false (${B.firstSuccess})`);
    rep.assert(B.blockedBefore === true, `B. 失败后 unsafe 提交锁已写入 (${B.blockedBefore})`);
    rep.assert(B.retryRet === false, `B. 第二次 Level.done() 返回 false(被安全锁阻止) (${B.retryRet})`);
    rep.assert(B.retryCompleted === false, `B. 重试不得完成该关 completed === false (${B.retryCompleted})`);
    rep.assert(B.retryCommitPoint === false, `B. 重试不得越过提交点 commitPointReached === false (${B.retryCommitPoint})`);
    rep.assert(B.retryXp === 0, `B. 重试不得再增加100 xp(内存已还原为 0, 被阻止后仍为 0, 非 100) (${B.retryXp})`);
    rep.assert(B.diagHit === true, `B. diagnostics 含 CompletionTransaction.submission_blocked (${B.diagHit})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
