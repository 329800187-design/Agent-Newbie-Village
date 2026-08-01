// tests/test_round4_persistence_failure.js — R1.2 Round4-P0 验收 (文件 5/6):
//   持久化层各类故障 → 阶段 B 异常 → 完整回滚 (内存 + 持久化一致)。
//
//   覆盖 5 种持久化故障 (均通过显式覆盖 State.save / localStorage 方法模拟, 默认关闭, 仅本测试生效):
//     1. localStorage.setItem 抛错 (配额/写入失败): 双写失败 → status === 'rollback_persist_failed',
//        内存已还原, completed === false (双重失败守卫, 禁止继续提交并提示重载)
//     2. State.save 抛错 (写入异常): 捕获后回滚 → status === 'rolled_back'
//     3. State.save 返回 false (保存被拒): _commitCompletion 视为失败 → 回滚 → 'rolled_back'
//     4. 序列化失败 (State.save 抛序列化错误): 等同于写入异常 → 回滚 → 'rolled_back'
//     5. 写后读不一致 (getItem 被篡改, 重读与内存不符): commit 重读校验失败 → 持久化回滚失败 → 'rollback_persist_failed'
//        (§三: 写后重读验证不一致时 status=rollback_persist_failed, 不得报告 persistenceRestored=true / status=rolled_back)
//
//   每个用例断言: Level.done 不向调用方抛异常 (内部已捕获并回滚); completed === false;
//     commitPointReached === false; Level._completing === false; xp 无增量。
//
// 用法: node tests/test_round4_persistence_failure.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18965;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const NEXT = 'ai_camp_2';

(async () => {
  const rep = new TestReport('test_round4_persistence_failure');
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
      const results = [];

      function setup() {
        F.clearAll(); CT.reset(); CT.clearSubmissionBlockForTest(LEVEL);
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        if (!State.levels[NEXT]) State.levels[NEXT] = {};
        State.levels[LEVEL].completed = false;
        State.levels[LEVEL].stars = 0;
        State.levels[LEVEL].unlocked = true;
        if (typeof _refreshUnlockedFlags === 'function') _refreshUnlockedFlags();
        State.levels[NEXT].completed = false;
        State.levels[NEXT].stars = 0;
        State.levels[NEXT].unlocked = false;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {} // 用正常 setItem 写基线存档
      }

      // 1. setItem 抛错 (配额失败)
      (function () {
        setup();
        const origSet = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function () { throw new Error('QuotaExceeded (simulated)'); };
        const xpBefore = State.xp;
        let thrown = false, ret;
        try { ret = Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        localStorage.setItem = origSet; // 还原
        results.push({
          name: 'setItem_throws(quota)', thrown, ret: ret === false ? 'false' : String(ret),
          completed: State.levels[LEVEL].completed, status: cs ? cs.status : null,
          commitPointReached: cs ? cs.commitPointReached : null,
          xpDelta: State.xp - xpBefore, completing: Level._completing
        });
        F.clearAll(); CT.reset();
      })();

      // 2. State.save 抛错
      (function () {
        setup();
        const origSave = State.save;
        State.save = function () { throw new Error('State.save IO error (simulated)'); };
        const xpBefore = State.xp;
        let thrown = false, ret;
        try { ret = Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        State.save = origSave;
        results.push({
          name: 'save_throws', thrown, ret: ret === false ? 'false' : String(ret),
          completed: State.levels[LEVEL].completed, status: cs ? cs.status : null,
          commitPointReached: cs ? cs.commitPointReached : null,
          xpDelta: State.xp - xpBefore, completing: Level._completing
        });
        F.clearAll(); CT.reset();
      })();

      // 3. State.save 返回 false
      (function () {
        setup();
        const origSave = State.save;
        State.save = function () { return false; };
        const xpBefore = State.xp;
        let thrown = false, ret;
        try { ret = Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        State.save = origSave;
        results.push({
          name: 'save_returns_false', thrown, ret: ret === false ? 'false' : String(ret),
          completed: State.levels[LEVEL].completed, status: cs ? cs.status : null,
          commitPointReached: cs ? cs.commitPointReached : null,
          xpDelta: State.xp - xpBefore, completing: Level._completing
        });
        F.clearAll(); CT.reset();
      })();

      // 4. 序列化失败 (State.save 抛序列化错误)
      (function () {
        setup();
        const origSave = State.save;
        State.save = function () { throw new Error('JSON serialize failed (simulated)'); };
        const xpBefore = State.xp;
        let thrown = false, ret;
        try { ret = Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        State.save = origSave;
        results.push({
          name: 'serialize_error', thrown, ret: ret === false ? 'false' : String(ret),
          completed: State.levels[LEVEL].completed, status: cs ? cs.status : null,
          commitPointReached: cs ? cs.commitPointReached : null,
          xpDelta: State.xp - xpBefore, completing: Level._completing
        });
        F.clearAll(); CT.reset();
      })();

      // 5. 写后读不一致 (getItem 被篡改)
      (function () {
        setup();
        const origGet = localStorage.getItem.bind(localStorage);
        let getCount = 0;
        localStorage.getItem = function (k) {
          getCount++;
          if (k === 'agent_village_d' && getCount > 1) {
            // 模拟"保存成功但重读不一致": 返回一个缺少当前关的存档
            return JSON.stringify({ levels: {}, xp: 0, totalStars: 0, currentLevel: 'x', achievements: [] });
          }
          return origGet(k);
        };
        const xpBefore = State.xp;
        let thrown = false, ret;
        try { ret = Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        localStorage.getItem = origGet;
        results.push({
          name: 'write_then_read_mismatch', thrown, ret: ret === false ? 'false' : String(ret),
          completed: State.levels[LEVEL].completed, status: cs ? cs.status : null,
          commitPointReached: cs ? cs.commitPointReached : null,
          xpDelta: State.xp - xpBefore, completing: Level._completing
        });
        F.clearAll(); CT.reset();
      })();

      return results;
    }, { LEVEL, NEXT });

    out.forEach(c => {
      rep.assert(c.thrown === false, `${c.name}: Level.done 内部已捕获持久化故障, 未向调用方抛异常 (thrown=${c.thrown})`);
      rep.assert(c.ret === 'false', `${c.name}: Level.done 返回 false (${c.ret})`);
      rep.assert(c.completed === false, `${c.name}: 回滚后 completed === false (${c.completed})`);
      rep.assert(c.commitPointReached === false, `${c.name}: 提交点未达成 (${c.commitPointReached})`);
      rep.assert(c.xpDelta === 0, `${c.name}: 回滚后 xp 无增量 (${c.xpDelta})`);
      rep.assert(c.completing === false, `${c.name}: 提交锁已恢复 (${c.completing})`);
      if (c.name === 'setItem_throws(quota)' || c.name === 'write_then_read_mismatch') {
        rep.assert(c.status === 'rollback_persist_failed', `${c.name}: 写后重读不一致 → status === 'rollback_persist_failed' (${c.status})`);
      } else {
        rep.assert(c.status === 'rolled_back', `${c.name}: 回滚 → status === 'rolled_back' (${c.status})`);
      }
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
