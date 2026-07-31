// tests/test_round4_absent_save_restore.js — R1.2 Round4-P0-R1 精准修复 (文件 2/4):
//   §二 精确恢复"存档不存在": 故障前存档本就不存在(persistedSaveExists=false)时,
//   回滚必须 removeItem(绝不写入字符串 "null"), 故障前后 getItem 恒为 null。
//
//   覆盖:
//     A. 存档缺失 + before_save 故障 → 回滚; 故障前 null, 故障后仍 null(非字符串 "null")
//     B. 存档存在 + before_save 故障 → 回滚; 存档被精确还原(存在且内容与故障前一致)
//        (正向对照: 证明 removeItem / setItem 两分支都正确, 缺失场景不会误写成 "null")
//
//   每个用例断言: Level.done 不抛异常 / 返回 false; completed=false;
//     commitPointReached=false; status='rolled_back'; Level._completing=false;
//     getItem 状态符合预期(缺失恒 null / 存在则精确还原)。
//
// 用法: node tests/test_round4_absent_save_restore.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18967;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';

(async () => {
  const rep = new TestReport('test_round4_absent_save_restore');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const results = await page.evaluate((LEVEL) => {
      const CT = window.CompletionTransaction;
      const F = window.CompletionTransactionFaults;
      const out = {};

      function setup(absent) {
        F.clearAll(); CT.reset();
        localStorage.removeItem('agent_village_d');
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        State.levels[LEVEL].completed = false;
        State.levels[LEVEL].stars = 0;
        State.levels[LEVEL].unlocked = true;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        if (!absent) {
          // 存在场景: 先做一次干净存档, 作为"故障前"基线
          try { State.save(); } catch (e) {}
        }
      }

      // A. 存档缺失
      setup(true);
      const beforeAbsent = localStorage.getItem('agent_village_d');
      F.arm('before_save'); // 阶段 B 持久化前故障
      let tA = false; let retA;
      try { retA = Level.done(); } catch (e) { tA = true; }
      const csA = CT.getState(LEVEL);
      const afterAbsent = localStorage.getItem('agent_village_d');
      out.absent = {
        beforeNull: beforeAbsent === null,
        afterNull: afterAbsent === null,
        afterNotStringNull: afterAbsent !== 'null',
        thrown: tA,
        ret: retA === false ? 'false' : (retA === true ? 'true' : String(retA)),
        completed: State.levels[LEVEL].completed,
        commitPointReached: csA ? csA.commitPointReached : null,
        status: csA ? csA.status : null,
        completing: Level._completing
      };
      F.clearAll(); CT.reset();

      // B. 存档存在(正向对照)
      setup(false);
      const beforePresent = localStorage.getItem('agent_village_d');
      F.arm('before_save');
      let tB = false; let retB;
      try { retB = Level.done(); } catch (e) { tB = true; }
      const csB = CT.getState(LEVEL);
      const afterPresent = localStorage.getItem('agent_village_d');
      let restored = false;
      try { restored = JSON.parse(afterPresent); } catch (e) {}
      out.present = {
        beforeNotNull: beforePresent !== null,
        afterNotNull: afterPresent !== null,
        afterNotStringNull: afterPresent !== 'null',
        restoredExact: afterPresent === beforePresent,
        restoredObjValid: !!restored,
        thrown: tB,
        ret: retB === false ? 'false' : (retB === true ? 'true' : String(retB)),
        completed: State.levels[LEVEL].completed,
        commitPointReached: csB ? csB.commitPointReached : null,
        status: csB ? csB.status : null,
        completing: Level._completing
      };
      F.clearAll(); CT.reset();

      return out;
    }, LEVEL);

    // A. 存档缺失
    rep.assert(results.absent.beforeNull === true, `A. 故障前 getItem === null (${results.absent.beforeNull})`);
    rep.assert(results.absent.afterNull === true, `A. 故障后仍 getItem === null(精确恢复不存在) (${results.absent.afterNull})`);
    rep.assert(results.absent.afterNotStringNull === true, `A. 故障后不是字符串 "null"(未误写) (${results.absent.afterNotStringNull})`);
    rep.assert(results.absent.thrown === false, `A. Level.done 未抛异常 (${results.absent.thrown})`);
    rep.assert(results.absent.ret === 'false', `A. Level.done 返回 false (${results.absent.ret})`);
    rep.assert(results.absent.completed === false, `A. 回滚后 completed === false (${results.absent.completed})`);
    rep.assert(results.absent.commitPointReached === false, `A. commitPointReached === false (${results.absent.commitPointReached})`);
    rep.assert(results.absent.status === 'rolled_back', `A. status === 'rolled_back' (${results.absent.status})`);
    rep.assert(results.absent.completing === false, `A. 提交锁已恢复 (${results.absent.completing})`);

    // B. 存档存在(正向对照)
    rep.assert(results.present.beforeNotNull === true, `B. 故障前存档存在 (${results.present.beforeNotNull})`);
    rep.assert(results.present.afterNotNull === true, `B. 故障后存档仍存在(未误删) (${results.present.afterNotNull})`);
    rep.assert(results.present.afterNotStringNull === true, `B. 故障后不是字符串 "null" (${results.present.afterNotStringNull})`);
    rep.assert(results.present.restoredExact === true, `B. 存档被精确还原(内容与故障前一致) (${results.present.restoredExact})`);
    rep.assert(results.present.restoredObjValid === true, `B. 还原后存档可解析 (${results.present.restoredObjValid})`);
    rep.assert(results.present.thrown === false, `B. Level.done 未抛异常 (${results.present.thrown})`);
    rep.assert(results.present.status === 'rolled_back', `B. status === 'rolled_back' (${results.present.status})`);
    rep.assert(results.present.completing === false, `B. 提交锁已恢复 (${results.present.completing})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
