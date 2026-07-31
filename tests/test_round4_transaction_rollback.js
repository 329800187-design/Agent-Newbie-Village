// tests/test_round4_transaction_rollback.js — R1.2 Round4-P0 验收 (文件 2/6):
//   阶段 B (提交前) 任意故障 → 完整回滚 (内存 + 持久化一致), completed 不残留。
//
//   覆盖 6 个注入点 (均通过 CompletionTransactionFaults.arm, 默认关闭, 仅本测试显式生效):
//     A. before_completed_write (权威写入前)   → 回滚
//     B. after_completed_write  (completed 已置 true, 之后故障) → 回滚还原 completed=false
//     C. after_next_unlock      (下一关已解锁, 之后故障) → 回滚还原 unlocked=false
//     D. before_save            (持久化前) → 回滚
//     E. during_save            (State.save 被 patch 抛错) → 回滚
//     F. after_save (corrupt)   (保存成功后故意破坏持久化, 重读不一致) → 回滚
//
//   每个用例断言: Level.done 不抛异常 (内部已捕获并回滚) / 返回 false;
//     completed === false; status === 'rolled_back'; Level._completing === false;
//     xp 无增量; 下一核心关 unlocked 仍为初始 false; currentLevel 未推进; 持久化已还原。
//
// 用法: node tests/test_round4_transaction_rollback.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18962;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const NEXT = 'ai_camp_2';

(async () => {
  const rep = new TestReport('test_round4_transaction_rollback');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const cases = await page.evaluate(({ LEVEL, NEXT }) => {
      const CT = window.CompletionTransaction;
      const F = window.CompletionTransactionFaults;
      const out = [];

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
        State.xp = 0;
        State.totalStars = 0;
        State.achievements = [];
        Level.current = LEVEL;
        Level.hintN = 0;
        Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}
      }

      function run(point, opts) {
        setup();
        F.arm(point, opts); // 默认 mode='throw', once=true
        const xpBefore = State.xp, tsBefore = State.totalStars;
        const nextBefore = State.levels[NEXT].unlocked;
        const curBefore = State.currentLevel;
        const persistedBefore = localStorage.getItem('agent_village_d');
        let thrown = false, ret;
        try { ret = Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        const persistedAfter = localStorage.getItem('agent_village_d');
        out.push({
          name: point,
          thrown,
          ret: ret === false ? 'false' : (ret === true ? 'true' : String(ret)),
          completed: State.levels[LEVEL].completed,
          status: cs ? cs.status : null,
          commitPointReached: cs ? cs.commitPointReached : null,
          xpDelta: State.xp - xpBefore,
          tsDelta: State.totalStars - tsBefore,
          nextUnlocked: State.levels[NEXT].unlocked,
          nextUnlockedBefore: nextBefore,
          currentLevel: State.currentLevel,
          currentLevelBefore: curBefore,
          completing: Level._completing,
          persistRestored: persistedAfter === persistedBefore
        });
        F.clearAll(); CT.reset();
      }

      run('before_completed_write');
      run('after_completed_write');
      run('after_next_unlock');
      run('before_save');
      run('during_save');
      run('after_save', { mode: 'corrupt' });

      return out;
    }, { LEVEL, NEXT });

    cases.forEach(c => {
      rep.assert(c.thrown === false, `${c.name}: Level.done 内部捕获故障, 未向调用方抛异常 (thrown=${c.thrown})`);
      rep.assert(c.ret === 'false', `${c.name}: Level.done 返回 false (${c.ret})`);
      rep.assert(c.completed === false, `${c.name}: 回滚后 completed === false (${c.completed})`);
      rep.assert(c.status === 'rolled_back', `${c.name}: 事务终态 status === 'rolled_back' (${c.status})`);
      rep.assert(c.commitPointReached === false, `${c.name}: 提交点未达成 commitPointReached === false (${c.commitPointReached})`);
      rep.assert(c.xpDelta === 0, `${c.name}: 回滚后 xp 无增量 (${c.xpDelta})`);
      rep.assert(c.tsDelta === 0, `${c.name}: 回滚后 totalStars 无增量 (${c.tsDelta})`);
      if (c.name === 'after_next_unlock') {
        rep.assert(c.nextUnlocked === false && c.nextUnlockedBefore === false,
          `${c.name}: 下一关解锁写入被回滚 (unlocked 仍 false)`);
      }
      rep.assert(c.currentLevel === 'ai_camp_1', `${c.name}: currentLevel 未推进 (${c.currentLevel})`);
      rep.assert(c.completing === false, `${c.name}: 提交锁已恢复 _completing === false (${c.completing})`);
      rep.assert(c.persistRestored === true, `${c.name}: 持久化已还原 (localStorage 与故障前一致)`);
    });

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
