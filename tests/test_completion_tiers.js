// tests/test_completion_tiers.js — R1.2 Round2 验收:
//   Completion 四级完成反馈统一入口(normal/capability/boss/world) 行为正确,
//   含防重复提交守卫。
// 用法: node tests/test_completion_tiers.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18932;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';

(async () => {
  const rep = new TestReport('test_completion_tiers');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, {});
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const meta = await page.evaluate(() => {
      const C = window.Completion;
      if (!C) return { exists: false };
      return { exists: true, tiers: Object.keys(C._tiers || {}) };
    });
    rep.assert(meta.exists, 'Completion 已暴露到 window');
    rep.assert(JSON.stringify(meta.tiers.slice().sort()) === JSON.stringify(['boss', 'capability', 'normal', 'world']),
      `四级完成反馈齐全 (${meta.tiers.join('/')})`);

    const expect = {
      normal: { title: '这一关完成了', icon: '🎉', cont: '继续学习' },
      capability: { title: '关键能力 get！', icon: '🚀', cont: '下一关' },
      boss: { title: 'Boss 通关', icon: '🏆', cont: '进入下一世界' },
      world: { title: '世界通关！', icon: '🌟', cont: '继续学习' }
    };

    for (const tier of ['normal', 'capability', 'boss', 'world']) {
      const r = await page.evaluate(({ tier, exp }) => {
        const C = window.Completion;
        C.hide();
        C.show({ tier, levelId: 'x_' + tier, capability: '能力X', nextReason: '下一步原因Y' });
        const modal = document.getElementById('r2-comp-modal');
        const active = !!(modal && modal.classList.contains('active'));
        const title = document.getElementById('r2-comp-title').textContent;
        const icon = document.getElementById('r2-comp-icon').textContent;
        const cont = (document.querySelector('#r2-comp-actions .r2-comp-continue') || {}).textContent;
        const btns = document.querySelectorAll('#r2-comp-actions button').length;
        const allowClose = C._tiers[tier].allowClose === true;
        const backBtn = [].slice.call(document.querySelectorAll('#r2-comp-actions button'))
          .find(b => b.className.indexOf('r2-comp-continue') < 0);
        const backText = backBtn ? backBtn.textContent : null;
        return { active, title, icon, cont, btns, allowClose, backText };
      }, { tier, exp: expect[tier] });
      rep.assert(r.active, `tier=${tier} 弹窗激活`);
      rep.assert(r.title === expect[tier].title, `tier=${tier} 标题正确 (${r.title})`);
      rep.assert(r.icon === expect[tier].icon, `tier=${tier} 图标正确 (${r.icon})`);
      rep.assert(r.cont === expect[tier].cont, `tier=${tier} 继续按钮文案 (${r.cont})`);
      rep.assert(r.btns === (r.allowClose ? 2 : 1), `tier=${tier} 按钮数符合(allowClose→2) (实际 ${r.btns})`);
      if (r.allowClose) rep.assert(r.backText && r.backText.indexOf('返回地图') >= 0, `tier=${tier} 含「返回地图」按钮 (${r.backText})`);
      else rep.assert(r.backText === null, `tier=${tier} 无「返回地图」按钮`);
      await page.evaluate(() => window.Completion.hide());
    }

    // 防重复提交守卫: 每次 show+click 仅触发一次 onContinue
    const dup = await page.evaluate(() => {
      const C = window.Completion;
      let n = 0;
      C.hide();
      C.show({ tier: 'normal', levelId: 'dup', onContinue: function () { n++; } });
      const btn = document.querySelector('#r2-comp-actions .r2-comp-continue');
      btn.click();
      const guard = typeof C._submitted === 'boolean';
      C.hide();
      return { n, guard };
    });
    rep.assert(dup.n === 1, `每次 show+click 仅触发一次 onContinue (实际 ${dup.n})`);
    rep.assert(dup.guard, 'Completion 含 _submitted 防重复提交守卫');

    // 「返回地图」按钮真实调用 onBack 且只执行一次(单元级)
    const nav = await page.evaluate(() => {
      const C = window.Completion;
      let n = 0;
      C.hide();
      C.show({ tier: 'boss', levelId: 'nav', onBack: function () { n++; } });
      const back = [].slice.call(document.querySelectorAll('#r2-comp-actions button'))
        .find(b => b.textContent.indexOf('返回地图') >= 0);
      if (back) back.click();
      const afterFirst = n;
      if (back) back.click();
      const afterSecond = n;
      const hidden = !(document.getElementById('r2-comp-modal').classList.contains('active'));
      C.hide();
      return { afterFirst, afterSecond, hidden, hasBack: !!back };
    });
    rep.assert(nav.hasBack, 'boss 弹窗单元级存在「返回地图」按钮');
    rep.assert(nav.afterFirst === 1, `「返回地图」onBack 首次点击触发 1 次 (${nav.afterFirst})`);
    rep.assert(nav.afterSecond === 1, `「返回地图」再次点击被单次执行守卫拦截 (${nav.afterSecond})`);
    rep.assert(nav.hidden, '「返回地图」点击后弹窗关闭');

    // hide 后非激活
    const hidden = await page.evaluate(() => {
      window.Completion.hide();
      const m = document.getElementById('r2-comp-modal');
      return !(m && m.classList.contains('active'));
    });
    rep.assert(hidden, 'hide() 后弹窗非激活');

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
