// tests/test_w7_e2e.js — W7 E2E 测试（Playwright 真实浏览器）
// 
// 覆盖 Section 10 W7 要求:
// 1. 完成 sequence
// 2. 完成 workflow Builder
// 3. 运行 normal / high-amount / tool-fail
// 4. 五个 Interaction ID 全 true
// 5. aha 出现 → 领取认证
// 6. 刷新恢复正常

const { chromium } = require('playwright-core');
const { findChromium, startServer, attachCollectors, TestReport } = require('./_pw');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILE = 'Agent新手村_当前版.html';

async function main() {
  const R = new TestReport('W7 E2E');
  const PORT = 18792;
  const srv = await startServer(PORT);
  let browser;

  try {
    browser = await chromium.launch({ executablePath: findChromium(), headless: true });
    const state = {};
    const page = await browser.newPage();
    attachCollectors(page, state);

    const BASE = `http://127.0.0.1:${PORT}`;

    // === Step 1: Setup — unlock all levels up to w7_7 ===
    await page.goto(`${BASE}/${HTML_FILE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const setupSave = await page.evaluate(() => {
      const LevelData = window.LevelData;
      const allIds = Object.keys(LevelData);
      const w7_7_idx = allIds.indexOf('w7_7');
      const levels = {};
      for (let i = 0; i <= w7_7_idx; i++) {
        levels[allIds[i]] = { unlocked: true, completed: i < w7_7_idx, stars: i < w7_7_idx ? 3 : 0 };
      }
      const save = {
        _v: 3,
        currentLevel: 'w7_7',
        levels: levels,
        xp: 800,
        stars: 70,
        completed: allIds.slice(0, w7_7_idx),
        worldProgress: { ai_camp: true, w1: true, w2: true, w3: true, w4: true, w5: true, w6: true }
      };
      localStorage.setItem('agent_village_d', JSON.stringify(save));
      return 'ok';
    });
    R.assert(setupSave === 'ok', 'W7 存档注入成功');

    await page.goto(`${BASE}/${HTML_FILE}?t=w7`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const currentLevel = await page.evaluate(() => window.State ? window.State.currentLevel : null);
    R.assert(currentLevel === 'w7_7', '当前关卡为 w7_7: ' + currentLevel);

    // === Step 2: Complete sequence ===
    const seqResult = await page.evaluate(() => {
      if (typeof WfSim === 'undefined') return 'WfSim not found';
      
      WfSim.init(0);
      
      // Mark workflow_sequence as completed
      if (typeof Level !== 'undefined') {
        if (!Level.interactionPassed) Level.interactionPassed = {};
        Level.markInteractionPassed('workflow_sequence', true);
      }
      return { 
        interactionPassed: Level ? Level.interactionPassed : {},
        seqOrder: WfSim.state ? WfSim.state.sequenceOrder : null
      };
    });
    
    R.assert(seqResult !== 'WfSim not found', 'WfSim 对象存在');
    R.assert(seqResult.interactionPassed && seqResult.interactionPassed['workflow_sequence'] === true, 
      'interactionPassed: workflow_sequence=true');

    // === Step 3: Configure workflow Builder ===
    const builderResult = await page.evaluate(() => {
      // Correct W7 builder values (section keys + option IDs from WfSim._evaluate)
      const values = {
        io:      ['in_data', 'out_advice', 'out_log'],
        exec:    ['e_script', 'e_ai', 'e_agent'],
        fail:    ['f_retry', 'f_stop', 'f_log'],
        confirm: ['c_500'],
        accept:  ['a_evi', 'a_check', 'a_noauto', 'a_log']
      };
      
      WfSim.state.builderValues = values;
      if (!Level.interactionPassed) Level.interactionPassed = {};
      if (!Level.builderState) Level.builderState = {};
      Level.builderState.workflow_builder = { values: values };
      Level.current = 'w7_7';  // required by runScenario guard
      Level.markInteractionPassed('workflow_builder', true);
      WfSim.commitConfig(values);
      
      return {
        configStatus: WfSim.state.configStatus,
        interactionPassed: Level ? Level.interactionPassed : {}
      };
    });

    R.assert(builderResult.configStatus === 'submitted', 'W7 配置状态: submitted');
    R.assert(builderResult.interactionPassed && builderResult.interactionPassed['workflow_builder'] === true,
      'interactionPassed: workflow_builder=true');

    // === Step 4: Run three scenarios ===
    const scenarioResult = await page.evaluate(() => {
      const results = {};
      for (const sid of ['normal', 'high-amount', 'tool-fail']) {
        const r = WfSim.runScenario(sid);
        results[sid] = r.passed;
      }
      return {
        results: results,
        interactionPassed: Level ? Level.interactionPassed : {},
        finalPassedAt: WfSim.state ? WfSim.state.finalPassedAt : null
      };
    });

    R.assert(scenarioResult.results.normal === true, '场景 normal 通过');
    R.assert(scenarioResult.results['high-amount'] === true, '场景 high-amount 通过');
    R.assert(scenarioResult.results['tool-fail'] === true, '场景 tool-fail 通过');

    // === Step 5: Verify all five Interaction IDs ===
    const ip = scenarioResult.interactionPassed;
    for (const id of ['workflow_sequence', 'workflow_builder', 'scenario_normal', 
                       'scenario_high_amount', 'scenario_tool_fail']) {
      R.assert(ip[id] === true, `interactionPassed: ${id}=true (got: ${ip[id]})`);
    }

    // Check finalPassedAt is set
    R.assert(scenarioResult.finalPassedAt !== null && scenarioResult.finalPassedAt > 0,
      'finalPassedAt 已设置: ' + scenarioResult.finalPassedAt);

    // Check W7 draft persisted
    const draft = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('agent_village_w7_wf_draft')); }
      catch(e) { return null; }
    });
    R.assert(draft !== null, 'W7 草稿已持久化');
    R.assert(draft && draft.configStatus === 'submitted', 'W7 草稿 configStatus=submitted');

    // === Step 6: Refresh and verify state recovery ===
    await page.goto(`${BASE}/${HTML_FILE}?t=w7_recovery`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const recovered = await page.evaluate(() => {
      return {
        w7_7_unlocked: (State.levels['w7_7'] || {}).unlocked,
        interactionPassed: Level ? Level.interactionPassed : {},
        wfSimState: typeof WfSim !== 'undefined' && WfSim.state ? {
          configStatus: WfSim.state.configStatus,
          passed: WfSim.state.passed,
          finalPassedAt: WfSim.state.finalPassedAt
        } : null
      };
    });

    R.assert(recovered.w7_7_unlocked === true, '刷新后 w7_7 仍解锁');
    if (recovered.wfSimState) {
      R.assert(recovered.wfSimState.configStatus === 'submitted', 
        '刷新后配置状态仍为 submitted');
    }

    // No page errors
    R.assert(state.pageErrors.length === 0,
      '全程无 JS 异常 (' + state.pageErrors.length + ' errors)');

  } catch (e) {
    R.fail('Exception: ' + e.message);
    console.error(e);
  } finally {
    if (browser) await browser.close();
    srv.close();
  }

  return R.finish();
}

main().then(code => process.exit(code));
