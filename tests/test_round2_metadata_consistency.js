// tests/test_round2_metadata_consistency.js — R1.2 Round2-R1 验收:
//   体验元数据与真实关卡顺序 / 世界名一致, 不跳关、不串世界。
// 用法: node tests/test_round2_metadata_consistency.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18936;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';
const IDS = ['ai_camp_1', 'w1_1', 'w3_13', 'w4_4', 'w4_7', 'w6_9', 'w7_7'];

(async () => {
  const rep = new TestReport('test_round2_metadata_consistency');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const data = await page.evaluate((IDS) => {
      const R = window.LevelExperienceRegistry;
      const out = { ids: IDS, reg: {}, worlds: Object.keys(WORLDS), levelWorld: {}, worldNameOk: true, badWorld: [] };
      IDS.forEach(id => {
        const e = R[id];
        out.reg[id] = {
          exists: !!e,
          nextReason: e ? e.nextReason : null,
          worldName: e ? e.worldName : null,
          capabilitySummary: e ? e.capabilitySummary : null,
          tier: e ? e.completionTier : null
        };
        const lv = LevelData[id];
        out.levelWorld[id] = lv ? lv.world : null;
        if (e && e.worldName) {
          const wk = lv ? lv.world : null;
          const expectName = wk && WORLDS[wk] ? WORLDS[wk].name : null;
          if (e.worldName !== expectName) { out.worldNameOk = false; out.badWorld.push(id); }
        }
      });
      // LevelData 仅存在于页面上下文, 此检查必须放在 evaluate 内
      out.missing = IDS.filter(id => !Object.prototype.hasOwnProperty.call(LevelData, id));
      return out;
    }, IDS);

    // 1) Registry 引用的 Level ID 必须存在
    const missing = data.missing;
    rep.assert(missing.length === 0, `Registry 7 个 Level ID 均存在于 LevelData (缺失: ${missing.join(',') || '无'})`);

    // 2) ai_camp_1 不得宣称下一站是黑窗口村(不得跳过启蒙营后续十关)
    const ac1 = data.reg['ai_camp_1'];
    rep.assert(!!ac1.exists, 'ai_camp_1 在 Registry 中');
    rep.assert(ac1.nextReason && ac1.nextReason.indexOf('黑窗口村') < 0,
      `ai_camp_1 不宣称跳到黑窗口村(下一关仍在启蒙营) — nextReason="${ac1.nextReason}"`);

    // 3) w1_1 不得宣称下一站是代码森林(不得跳过终端村后续关)
    const w11 = data.reg['w1_1'];
    rep.assert(!!w11.exists, 'w1_1 在 Registry 中');
    rep.assert(w11.nextReason && w11.nextReason.indexOf('代码森林') < 0,
      `w1_1 不宣称跳到代码森林(下一关仍在终端村) — nextReason="${w11.nextReason}"`);

    // 4) w7_7.worldName === '工作流工场'
    const w77 = data.reg['w7_7'];
    rep.assert(w77.worldName === '工作流工场', `w7_7 worldName === '工作流工场' (实际="${w77.worldName}")`);

    // 5) Registry 中带 worldName 的条目必须与 WORLDS 对应世界名一致
    rep.assert(data.worldNameOk, `Registry 引用的世界名与 WORLDS 一致 (异常: ${data.badWorld.join(',') || '无'})`);

    // 附加: 七个代表关卡均含能力总结(capabilitySummary)
    const noCap = IDS.filter(id => !data.reg[id].capabilitySummary);
    rep.assert(noCap.length === 0, `七个代表关卡均含 capabilitySummary (缺: ${noCap.join(',') || '无'})`);

    rep.assert(st.pageErrors.length === 0, `元数据校验全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
