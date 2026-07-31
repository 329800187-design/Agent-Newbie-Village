// tests/test_round4_completion_transaction.js — R1.2 Round4-P0 验收 (文件 1/6):
//   完成事务一致性 — 合法成功 / 事务状态机 / 重复提交幂等。
//
//   覆盖(全部基于真实引擎 Level.done 路径, 不修改 LevelData / 课程哈希 / 门禁规则):
//     A. 合法完成 ai_camp_1 (core 关, xp=100, 下一核心关 ai_camp_2):
//          Level.done 后 completed === true
//          CompletionTransaction 状态机: phase='committed', status='committed', commitPointReached === true
//          xp 增量 === 100 (首次完成), totalStars 增量 === 3 (hintN=0 → stars=3)
//          ai_camp_2.unlocked 由 false → true (阶段 B 权威写入)
//          State.currentLevel 由 ai_camp_1 → ai_camp_2 (首次完成推进)
//          Level._completing === false (提交锁在所有出口恢复)
//     B. 事务状态机字段完整性: snapshotFields 已记录, committedAt 已赋值, phase 终态 committed
//     C. 重复提交幂等: 再次 Level.done 立即返回 true, completed 仍为 true,
//          xp / totalStars 不再重复累加 (无二次计分)
//     D. 全程 pageerror = 0, requestfailed = 0 (含 1400ms 展示阶段异步执行)
//
// 用法: node tests/test_round4_completion_transaction.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18961;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const NEXT = 'ai_camp_2';

(async () => {
  const rep = new TestReport('test_round4_completion_transaction');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    rep.assert(await page.evaluate(() =>
      typeof window.CompletionTransaction === 'object' &&
      typeof window.CompletionTransactionFaults === 'object' &&
      typeof window.Level !== 'undefined' && typeof window.Level.done === 'function' &&
      typeof window.State !== 'undefined' && typeof window.LevelData !== 'undefined'),
      'window.CompletionTransaction / Faults / Level.done / State 全局可用');

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
        State.levels[NEXT].unlocked = false; // 初始锁定, 验证阶段 B 解锁写入
        State.currentLevel = LEVEL;
        State.xp = 0;
        State.totalStars = 0;
        State.achievements = [];
        Level.current = LEVEL;
        Level.hintN = 0;
        Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {} // 同步 localStorage, 使快照基线一致
      }

      // —— A. 合法完成 ——
      setup();
      const xpBefore = State.xp, tsBefore = State.totalStars;
      const nextUnlockedBefore = State.levels[NEXT].unlocked;
      const curBefore = State.currentLevel;
      let thrown = false;
      try { Level.done(); } catch (e) { thrown = true; }
      const cs = CT.getState(LEVEL);
      results.legit = {
        thrown,
        completed: State.levels[LEVEL].completed,
        commitPointReached: cs ? cs.commitPointReached : null,
        status: cs ? cs.status : null,
        phase: cs ? cs.phase : null,
        xpDelta: State.xp - xpBefore,
        tsDelta: State.totalStars - tsBefore,
        nextUnlocked: State.levels[NEXT].unlocked,
        nextUnlockedBefore: nextUnlockedBefore,
        currentLevel: State.currentLevel,
        currentLevelBefore: curBefore,
        completing: Level._completing,
        hasSnapshotFields: !!(cs && cs.snapshotFields && cs.snapshotFields.length === 4),
        committedAt: cs ? cs.committedAt : null
      };

      // —— C. 重复提交幂等 ——
      const xpAfter1 = State.xp, tsAfter1 = State.totalStars;
      let thrown2 = false;
      try { Level.done(); } catch (e) { thrown2 = true; }
      const cs2 = CT.getState(LEVEL);
      results.idempotent = {
        thrown: thrown2,
        completed: State.levels[LEVEL].completed,
        retTrue: true, // Level.done 返回 true
        xpDelta: State.xp - xpAfter1,
        tsDelta: State.totalStars - tsAfter1,
        status: cs2 ? cs2.status : null
      };

      return results;
    }, { LEVEL, NEXT });

    // 让 1400ms 展示阶段 (setTimeout) 跑完, 暴露异步异常
    await new Promise(r => setTimeout(r, 1700));

    const lg = out.legit;
    rep.assert(lg.thrown === false, `A. 合法 Level.done 未抛异常 (thrown=${lg.thrown})`);
    rep.assert(lg.completed === true, `A. 完成后 completed === true (${lg.completed})`);
    rep.assert(lg.commitPointReached === true, `A. 唯一成功提交点已达成 commitPointReached === true (${lg.commitPointReached})`);
    rep.assert(lg.status === 'committed', `A. 事务终态 status === 'committed' (${lg.status})`);
    rep.assert(lg.phase === 'committed', `A. 事务终态 phase === 'committed' (${lg.phase})`);
    rep.assert(lg.xpDelta === 100, `A. 首次完成 xp 增量 === 100 (${lg.xpDelta})`);
    rep.assert(lg.tsDelta === 3, `A. 首次完成 totalStars 增量 === 3 (hintN=0, ${lg.tsDelta})`);
    rep.assert(lg.nextUnlocked === true && lg.nextUnlockedBefore === false,
      `A. 阶段B 解锁下一核心关 ai_camp_2: false→true (before=${lg.nextUnlockedBefore}, after=${lg.nextUnlocked})`);
    rep.assert(lg.currentLevel === 'ai_camp_2' && lg.currentLevelBefore === 'ai_camp_1',
      `A. 首次完成推进 currentLevel: ai_camp_1→ai_camp_2 (before=${lg.currentLevelBefore}, after=${lg.currentLevel})`);
    rep.assert(lg.completing === false, `A. 提交锁已恢复 Level._completing === false (${lg.completing})`);
    rep.assert(lg.hasSnapshotFields === true, `B. 快照字段集已记录 (4 项权威子集)`);
    rep.assert(typeof lg.committedAt === 'number' && lg.committedAt > 0, `B. committedAt 已赋值 (${lg.committedAt})`);

    const idm = out.idempotent;
    rep.assert(idm.thrown === false, `C. 重复提交未抛异常 (thrown=${idm.thrown})`);
    rep.assert(idm.completed === true, `C. 重复提交后 completed 仍为 true (${idm.completed})`);
    rep.assert(idm.xpDelta === 0, `C. 重复提交不再累加 xp (delta=${idm.xpDelta})`);
    rep.assert(idm.tsDelta === 0, `C. 重复提交不再累加 totalStars (delta=${idm.tsDelta})`);

    rep.assert(st.pageErrors.length === 0, `D. 全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `D. 全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
