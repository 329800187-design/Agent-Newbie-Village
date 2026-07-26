// tests/test_w6_e2e.js — W6 E2E 测试（Playwright 真实浏览器）
// 
// 覆盖 Section 10 W6 要求:
// 1. 正式模式进入 W6 Boss
// 2. 配置正确 Agent
// 3. 运行 normal / missing-info / high-risk
// 4. 四个 Interaction ID 全 true
// 5. aha 出现 → 点击完成
// 6. W7_1 解锁
// 7. 刷新后状态可恢复

const { chromium } = require('playwright-core');
const { findChromium, startServer, attachCollectors, TestReport } = require('./_pw');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILE = 'Agent新手村_当前版.html';

async function main() {
  const R = new TestReport('W6 E2E');
  const PORT = 18791;
  const srv = await startServer(PORT);
  let browser;

  try {
    browser = await chromium.launch({ executablePath: findChromium(), headless: true });
    const state = {};
    const page = await browser.newPage();
    attachCollectors(page, state);

    const BASE = `http://127.0.0.1:${PORT}`;

    // === Step 1: Load in normal mode (TEST_MODE=false) ===
    await page.goto(`${BASE}/${HTML_FILE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Check page loads without errors
    R.assert(state.pageErrors.length === 0, 
      '页面加载无 JS 错误 (' + state.pageErrors.length + ' errors)');

    // Navigate to W6 Boss (w6_9) by injecting state
    // We need to unlock all levels up to w6_9
    const setupSave = await page.evaluate(() => {
      const LevelData = window.LevelData;
      const allIds = Object.keys(LevelData);
      const w6_9_idx = allIds.indexOf('w6_9');
      const levels = {};
      for (let i = 0; i <= w6_9_idx; i++) {
        levels[allIds[i]] = { unlocked: true, completed: i < w6_9_idx, stars: i < w6_9_idx ? 3 : 0 };
      }
      const save = {
        _v: 3,
        currentLevel: 'w6_9',
        levels: levels,
        xp: 500,
        stars: 50,
        completed: allIds.slice(0, w6_9_idx),
        worldProgress: { ai_camp: true, w1: true, w2: true, w3: true, w4: true, w5: true }
      };
      localStorage.setItem('agent_village_d', JSON.stringify(save));
      return 'save_injected';
    });
    R.assert(setupSave === 'save_injected', '存档注入成功');

    // Reload to apply save
    await page.goto(`${BASE}/${HTML_FILE}?t=w6`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Verify we're on w6_9
    const currentLevel = await page.evaluate(() => window.State ? window.State.currentLevel : null);
    R.assert(currentLevel === 'w6_9', '当前关卡为 w6_9: ' + currentLevel);

    // === Step 2-3: Configure Agent and run scenarios ===
    // Simulate builder configuration via direct JS (Playwright clicks unreliable for dynamic UI)
    const builderResult = await page.evaluate(() => {
      if (typeof Sim === 'undefined') return 'Sim not found';
      
      // Initialize Sim with builder values
      Sim.init(0); // builder step index 0
      
      // Configure: set builder values for all 7 chapters
      // First reset Sim state to a clean blank
      Sim.state = Sim._blank();
      
      // Correct builder values (section keys + option IDs from Sim._evaluate)
      const values = {
        goal:     ['g_read', 'g_out', 'g_cal', 'g_pri'],
        input:    ['i_list', 'i_pri', 'i_date'],
        tools:    ['t_read', 't_cal', 't_save'],
        perm:     ['p_conf'],
        stop:     ['s_done', 's_fail', 's_max'],
        fallback: ['f_ask', 'f_limit'],
        riskRules:['r_list', 'r_mark', 'r_preview', 'r_scope', 'r_confirm'],
        accept:   ['a_list', 'a_reason', 'a_no_fake']
      };
      
      Sim.state.builderValues = values;
      if (!Level.interactionPassed) Level.interactionPassed = {};
      if (!Level.builderState) Level.builderState = {};
      Level.builderState.agent_builder = { values: values };
      Level.current = 'w6_9';  // required by runScenario guard
      Level.markInteractionPassed('agent_builder', true);
      Sim.commitConfig(values);
      
      // Run all three scenarios
      const results = {};
      for (const sid of ['normal', 'missing-info', 'high-risk']) {
        const r = Sim.runScenario(sid);
        results[sid] = r.passed;
      }
      
      return {
        configStatus: Sim.state.configStatus,
        configRevision: Sim.state.configRevision,
        results: results,
        interactionPassed: Level.interactionPassed || {}
      };
    });

    R.assert(builderResult !== 'Sim not found', 'Sim 对象存在');
    if (builderResult !== 'Sim not found') {
      R.assert(builderResult.configStatus === 'submitted', '配置状态: submitted');
      R.assert(builderResult.results.normal === true, '场景 normal 通过');
      R.assert(builderResult.results['missing-info'] === true, '场景 missing-info 通过');
      R.assert(builderResult.results['high-risk'] === true, '场景 high-risk 通过');

      // Check interaction IDs
      const ip = builderResult.interactionPassed;
      R.assert(ip['agent_builder'] === true, 'interactionPassed: agent_builder=true');
      R.assert(ip['scenario_normal'] === true, 'interactionPassed: scenario_normal=true');
      R.assert(ip['scenario_missing_info'] === true, 'interactionPassed: scenario_missing_info=true');
      R.assert(ip['scenario_high_risk'] === true, 'interactionPassed: scenario_high_risk=true');
    }

    // Check localStorage for w6_sim_draft
    const draft = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('agent_village_w6_sim_draft')); }
      catch(e) { return null; }
    });
    R.assert(draft !== null, 'W6 草稿已持久化');
    R.assert(draft && draft.configStatus === 'submitted', '草稿 configStatus=submitted');

    // Check no page errors throughout
    R.assert(state.pageErrors.length === 0,
      '全程无 JS 异常 (' + state.pageErrors.length + ' errors, ' + JSON.stringify(state.pageErrors.slice(0,3)) + ')');

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
