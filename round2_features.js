/* =====================================================================
 * R1.2 Round2 骨架扩展（独立 <script>，不修改 LevelData / 课程哈希）
 * 提供：
 *   1) LevelExperienceRegistry   —— 7 个代表关卡的体验元数据（与课程数据解耦）
 *   2) AssetRegistry             —— 素材注册 + 降级占位（get/exists/fallback/render）
 *   3) Completion                —— 四级完成反馈统一入口（normal/capability/boss/world）
 *   4) Round2Exp                 —— 把统一模板与完成反馈接入 7 个代表关卡（运行时 hook）
 * 接入方式：包裹 Level.render / Level.done（只针对已注册的代表关卡，其余透传）。
 * ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * 1) LevelExperienceRegistry —— 与课程数据完全独立的体验元数据
   * ------------------------------------------------------------------ */
  var LevelExperienceRegistry = {};

  LevelExperienceRegistry['ai_camp_1'] = {
    templateType: '认知教学模板',
    taskBrief: '搞清「AI 是什么、不是什么」——重点是它“不是真的懂”，只是按概率预测下一个词',
    why: '之后每一关你都会和 AI 协作；先建立正确认知，既不被它吓住，也不迷信它',
    completionCriteria: [
      '能说清 AI 的回答是“预测下一个词”而不是“理解”',
      '能举出一个 AI 会一本正经胡说八道的例子',
      '能说清什么时候必须自己核实'
    ],
    capabilitySummary: '你已建立对 AI 的基本认知框架',
    nextReason: '下一站「黑窗口村」：把认知落地，自己动手敲命令行',
    cognitiveNote: 'AI“不是真的懂”——它只是在预测“下一个最可能出现的词”',
    splashId: 'J01',
    completionTier: 'normal'
  };

  LevelExperienceRegistry['w1_1'] = {
    templateType: '终端操作模板',
    taskBrief: '在终端里敲出第一个命令，看清「你敲的命令」和「电脑回显的结果」是两回事',
    why: '命令行是你直接指挥电脑的入口；区分“输入”和“输出”，才不会看不懂终端在说什么',
    completionCriteria: [
      '能区分命令与回显',
      '能说清当前这一步在做什么',
      '操作完成后能看懂验证提示'
    ],
    capabilitySummary: '你已迈出终端操作第一步',
    nextReason: '下一站「代码森林」：终端玩熟了，该学程序怎么思考',
    cmdEchoNote: '看终端要分两半：你敲的是“命令”，电脑回的是“结果”',
    splashId: 'J01',
    completionTier: 'normal'
  };

  LevelExperienceRegistry['w3_13'] = {
    templateType: 'Python 代码阅读关键能力关',
    taskBrief: '逐行读懂一段真实小脚本，预测它的输出',
    why: '读懂别人的代码（包括 AI 写的）是验收能力的根基；读不懂就只能盲信',
    completionCriteria: [
      '能按顺序解释代码执行过程',
      '能判断变量最终值',
      '能说明输出为什么成立'
    ],
    capabilitySummary: '你已经能够独立阅读一段小型 Python 程序',
    nextReason: '下一世界会要求你根据报错定位问题',
    readOrder: '从上到下、一行一行看，注意循环会重复执行',
    varChange: '盯住每个变量：它在哪被赋值、每次循环后变成多少',
    branchLoop: '遇到 if/for，先判断条件真假，再决定走哪条分支、循环几次',
    finalOutput: '把所有步骤串起来，得到最终 print 的结果',
    splashId: 'J01',
    completionTier: 'capability'
  };

  LevelExperienceRegistry['w4_4'] = {
    templateType: '运行环境理解模板',
    taskBrief: '理解“虚拟环境”解决什么问题：给每个项目一个独立的小房间装库',
    why: '不同项目要不同版本的库，共用会“打架”；环境隔离才能各自安稳',
    completionCriteria: [
      '能说清程序在哪里运行',
      '能说清当前环境包含什么',
      '能说清为什么环境不同结果不同'
    ],
    capabilitySummary: '你已理解运行环境与依赖隔离',
    nextReason: '下一关「我这能跑你那不行」：环境差异导致报错',
    programWhere: '脚本不是凭空跑的——它在“解释器 + 依赖库 + 配置 + 文件路径”这套环境里运行',
    envContains: '一个运行环境通常包含：Python 解释器版本、第三方库及其版本、环境变量/密钥、工作目录',
    whyDiffer: '同样的代码，环境（库版本 / Python 版本 / 密钥 / 路径）不同，结果就可能不一样甚至报错',
    splashId: 'J01',
    completionTier: 'capability'
  };

  LevelExperienceRegistry['w4_7'] = {
    templateType: '报错排查模板',
    taskBrief: '面对“我这能跑你那不行”的报错，按套路定位环境差异',
    why: '报错不是洪水猛兽；按“看到错误→猜原因→按顺序排查→修复→验证”走，就能稳定解决',
    completionCriteria: [
      '能描述看到的错误信息',
      '能列出可能原因',
      '能按固定顺序排查',
      '能说出修复动作',
      '能验证修复后结果'
    ],
    capabilitySummary: '你已掌握一套报错排查的基本顺序',
    nextReason: '下一世界「程序底层」：理解代码到运行的完整链路',
    errorSeen: '先完整复制 / 看清报错信息，别急着改代码',
    possibleCause: '环境差异最常见：库版本不同、Python 版本不同、缺密钥/配置、文件路径不对',
    checkOrder: '① 读报错类型和关键信息 → ② 对比两边环境（版本 / 依赖 / 配置）→ ③ 缩小差异点',
    fixAction: '对齐环境：统一库版本、补齐依赖、配置密钥、修正路径',
    verifyAfter: '修复后在“出问题的那台机器”重跑，确认不再报错',
    splashId: 'J01',
    completionTier: 'capability'
  };

  LevelExperienceRegistry['w6_9'] = {
    templateType: 'Agent 配置与验证模板',
    taskBrief: '给 Agent 配目标/工具/权限/停止条件/异常处理，并在三个真实场景里验证安全性',
    why: '配 Agent 不是写完提示词就完事；要在 normal / missing-info / high-risk 三个场景验证它真的守规矩',
    completionCriteria: [
      '能描述 Agent 配置包含什么',
      '能跑通三个验收场景',
      '能说清 finalPassedAt 代表什么'
    ],
    capabilitySummary: '你已能为 Agent 定边界、设权限、配工具、验安全',
    nextReason: '下一站「工作流工场」：把脚本+AI+人串成自动化流水线',
    keepGate: true,
    gateNote: '门禁不变：必须三个场景同版本全部通过，finalPassedAt 才会写入；缺任一都不算完成',
    splashId: 'J01',
    completionTier: 'capability'
  };

  LevelExperienceRegistry['w7_7'] = {
    templateType: '工作流综合设计模板',
    taskBrief: '设计一个包含输入→处理→判断→输出→人工确认的完整工作流',
    why: '把前面学的脚本、代码、环境、Agent 拧成一条带审批/重试/验收的流水线，才是真干活',
    completionCriteria: [
      '能描述工作流包含哪些环节',
      '能配出正常 / 高金额 / 工具失败三场景',
      '能说清为什么需要人工确认'
    ],
    capabilitySummary: '你已能设计一条带审批、重试、验收的真实工作流',
    nextReason: '这是最后一站——之后你就能用 AI 真正开始干活',
    keepGate: true,
    gateNote: '门禁不变：workflow_sequence 与 workflow_builder 通过、三场景同版本验收，finalPassedAt 才写入',
    worldName: '智能体工坊',
    capabilityList: '配置 Agent、设计工作流、三场景验收、带审批/重试/验收的自动化',
    realTask: '给“订单→库存→补货建议”这类流程配一条带人工确认的工作流',
    nextPurpose: '理解程序从代码到运行的完整链路之后，你能独立设计可投产的 AI 工作流',
    splashId: 'J01',
    completionTier: 'world'
  };

  /* ------------------------------------------------------------------
   * 2) AssetRegistry —— 素材注册与降级占位
   * ------------------------------------------------------------------ */
  var AssetRegistry = {
    splash: {}, onboard: {}, character: {}, node: {}, done: {}, background: {}, boss: {}, certificate: {}, ui: {}
  };
  AssetRegistry._meta = {
    splash: '开场插画', onboard: '入村引导', character: '角色', node: '节点',
    done: '完成插画', background: '背景', boss: 'Boss', certificate: '认证', ui: '界面元素'
  };
  /*__ASSET_SEED__*/
  AssetRegistry.get = function (type, id) {
    if (!type || !id) return { ok: false, reason: '参数缺失' };
    var bucket = this[type];
    if (!bucket) return { ok: false, reason: '未知素材分类:' + type };
    if (Object.prototype.hasOwnProperty.call(bucket, id)) {
      return { ok: true, src: bucket[id], type: type, id: id };
    }
    return { ok: false, reason: '素材未注册:' + type + '/' + id };
  };
  AssetRegistry.exists = function (type, id) {
    var bucket = this[type];
    return !!(bucket && Object.prototype.hasOwnProperty.call(bucket, id));
  };
  AssetRegistry.fallback = function (type, id) {
    var label = (this._meta[type] || type) + ' #' + id;
    return '<div class="asset-fallback" data-type="' + type + '" data-id="' + id +
      '" role="img" aria-label="占位素材：' + label + '">🖼️ ' + label + '</div>';
  };
  AssetRegistry.render = function (type, id) {
    if (this.exists(type, id)) {
      var src = this[type][id];
      var label = (this._meta[type] || type) + ' ' + id;
      return '<img class="asset-img" alt="' + label + '" src="' + src + '" onerror="this.style.display=\'none\'">';
    }
    return this.fallback(type, id);
  };

  /* ------------------------------------------------------------------
   * 3) Completion —— 四级完成反馈统一入口
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  var Completion = { _modal: null, _submitted: false, _allowClose: false };

  Completion._tiers = {
    normal: { icon: '🎉', title: '这一关完成了', sub: function (o) { return o.levelTitle || '普通关卡'; }, continueText: '继续学习' },
    capability: { icon: '🚀', title: '关键能力 get！', sub: function (o) { return o.capability || '你掌握了一项关键能力'; }, continueText: '下一关' },
    boss: { icon: '🏆', title: 'Boss 通关', sub: function (o) { return (o.worldName || 'Boss') + ' · Boss'; }, continueText: '进入下一世界', allowClose: true },
    world: { icon: '🌟', title: '世界通关！', sub: function (o) { return (o.worldName || '世界') + ' 全部主线完成'; }, continueText: '继续学习', allowClose: true }
  };

  Completion.ensureModal = function () {
    if (this._modal && document.getElementById('r2-comp-modal')) return this._modal;
    var m = document.createElement('div');
    m.id = 'r2-comp-modal';
    m.className = 'r2-comp-modal';
    m.innerHTML =
      '<div class="r2-comp-card">' +
      '<div class="r2-comp-badge"><span class="r2-comp-icon" id="r2-comp-icon">🎉</span>' +
      '<div class="r2-comp-title" id="r2-comp-title"></div>' +
      '<div class="r2-comp-sub" id="r2-comp-sub"></div></div>' +
      '<div class="r2-comp-body" id="r2-comp-body"></div>' +
      '<div class="r2-comp-actions" id="r2-comp-actions"></div>' +
      '</div>';
    document.body.appendChild(m);
    var self = this;
    m.addEventListener('click', function (e) {
      if (e.target === m && self._allowClose) self.hide();
    });
    this._modal = m;
    return m;
  };

  Completion._row = function (k, v) {
    return '<div class="r2-comp-row"><span class="r2-comp-k">' + esc(k) + '</span>' +
      '<span class="r2-comp-v">' + esc(v) + '</span></div>';
  };

  Completion._renderBody = function (tier, o) {
    o = o || {};
    if (tier === 'normal') {
      return this._row('完成了什么', o.task || o.levelTitle || '本关任务') +
        this._row('获得经验', '+' + (o.xp || 0) + ' XP') +
        this._row('下一步', o.nextReason || '继续往下学');
    }
    if (tier === 'capability') {
      return this._row('学会的能力', o.capability || '') +
        this._row('能独立完成', o.canDo || '') +
        this._row('现实应用例子', o.realExample || '') +
        this._row('下一关为什么重要', o.nextReason || '');
    }
    if (tier === 'boss') {
      return this._row('本世界综合任务结果', o.worldResult || '') +
        this._row('已验证的能力', o.verifiedCapabilities || '') +
        this._row('世界认证', o.worldCert || '') +
        this._row('下一世界预告', o.nextWorldPreview || '');
    }
    if (tier === 'world') {
      return this._row('世界认证', (o.worldName || '') + ' 认证达成') +
        this._row('本世界能力清单', o.capabilityList || '') +
        this._row('可独立完成的真实任务', o.realTask || '') +
        this._row('下一世界学习目的', o.nextPurpose || '');
    }
    return this._row('完成', o.levelTitle || '');
  };

  Completion.show = function (opt) {
    opt = opt || {};
    var tier = opt.tier || 'normal';
    var meta = this._tiers[tier] || this._tiers.normal;
    var m = this.ensureModal();
    document.getElementById('r2-comp-icon').textContent = meta.icon;
    document.getElementById('r2-comp-title').textContent = meta.title;
    document.getElementById('r2-comp-sub').textContent = meta.sub(opt) || '';
    document.getElementById('r2-comp-body').innerHTML = this._renderBody(tier, opt);
    var actions = document.getElementById('r2-comp-actions');
    actions.innerHTML = '';
    this._allowClose = !!meta.allowClose;
    this._submitted = false;
    var self = this;
    var cont = document.createElement('button');
    cont.className = 'btn btn-gold r2-comp-continue';
    cont.textContent = meta.continueText || '继续学习';
    cont.onclick = function () {
      if (self._submitted) return;            // 防重复提交
      self._submitted = true;
      try { if (typeof opt.onContinue === 'function') opt.onContinue(); } catch (e) {}
      self.hide();
    };
    actions.appendChild(cont);
    if (meta.allowClose) {
      var back = document.createElement('button');
      back.className = 'btn btn-secondary';
      back.textContent = '返回地图';
      back.onclick = function () {
        if (self._submitted) return;
        self._submitted = true;
        try { if (typeof opt.onBack === 'function') opt.onBack(); } catch (e) {}
        self.hide();
      };
      actions.appendChild(back);
    }
    m.classList.add('active');
    m.setAttribute('data-tier', tier);
    m.setAttribute('data-level', opt.levelId || '');
    return m;
  };

  Completion.hide = function () {
    if (this._modal) this._modal.classList.remove('active');
    this._submitted = false;
  };

  /* ------------------------------------------------------------------
   * 4) Round2Exp —— 把统一模板 / 四级反馈接入代表关卡（运行时 hook）
   * ------------------------------------------------------------------ */
  var Round2Exp = {};

  Round2Exp.templateHTML = function (rep) {
    var h = '<div class="r2-exp-head">🧭 本关体验指引</div>';
    h += '<div class="r2-exp-sec" data-exp="task"><span class="r2-exp-k">当前任务</span><span class="r2-exp-v">' + esc(rep.taskBrief) + '</span></div>';
    h += '<div class="r2-exp-sec" data-exp="why"><span class="r2-exp-k">为什么要做</span><span class="r2-exp-v">' + esc(rep.why) + '</span></div>';
    if (rep.completionCriteria && rep.completionCriteria.length) {
      h += '<div class="r2-exp-sec" data-exp="criteria"><span class="r2-exp-k">完成标准</span><ul class="r2-exp-ul">' +
        rep.completionCriteria.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>';
    }
    // 模块专属高亮（按关卡“必须突出”的内容）
    if (rep.readOrder || rep.varChange || rep.branchLoop || rep.finalOutput) {
      h += '<div class="r2-exp-sec" data-exp="read"><span class="r2-exp-k">阅读要点</span><ul class="r2-exp-ul">' +
        ['readOrder', 'varChange', 'branchLoop', 'finalOutput'].map(function (k) {
          return rep[k] ? '<li><b>' + ({ readOrder: '阅读顺序', varChange: '变量变化', branchLoop: '分支/循环', finalOutput: '最终输出' }[k]) + '：</b>' + esc(rep[k]) + '</li>' : '';
        }).join('') + '</ul></div>';
    }
    if (rep.programWhere || rep.envContains || rep.whyDiffer) {
      h += '<div class="r2-exp-sec" data-exp="env"><span class="r2-exp-k">运行环境</span><ul class="r2-exp-ul">' +
        ['programWhere', 'envContains', 'whyDiffer'].map(function (k) {
          return rep[k] ? '<li><b>' + ({ programWhere: '程序在哪运行', envContains: '环境包含什么', whyDiffer: '为何环境不同结果不同' }[k]) + '：</b>' + esc(rep[k]) + '</li>' : '';
        }).join('') + '</ul></div>';
    }
    if (rep.errorSeen || rep.possibleCause || rep.checkOrder || rep.fixAction || rep.verifyAfter) {
      h += '<div class="r2-exp-sec" data-exp="troubleshoot"><span class="r2-exp-k">报错排查顺序</span><ul class="r2-exp-ul">' +
        ['errorSeen', 'possibleCause', 'checkOrder', 'fixAction', 'verifyAfter'].map(function (k) {
          return rep[k] ? '<li><b>' + ({ errorSeen: '看到的错误', possibleCause: '可能原因', checkOrder: '排查顺序', fixAction: '修复动作', verifyAfter: '修复后验证' }[k]) + '：</b>' + esc(rep[k]) + '</li>' : '';
        }).join('') + '</ul></div>';
    }
    if (rep.cognitiveNote || rep.cmdEchoNote) {
      h += '<div class="r2-exp-sec" data-exp="note"><span class="r2-exp-k">小提醒</span><ul class="r2-exp-ul">' +
        [rep.cognitiveNote, rep.cmdEchoNote].filter(Boolean).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    }
    if (rep.gateNote) {
      h += '<div class="r2-exp-sec" data-exp="gate"><span class="r2-exp-k">门禁说明</span><span class="r2-exp-v">' + esc(rep.gateNote) + '</span></div>';
    }
    h += '<div class="r2-exp-sec" data-exp="hint"><span class="r2-exp-k">小黑提示</span><span class="r2-exp-v">' + esc(rep.hint || '跟着小黑一步步来，卡住就点“小黑提醒”。') + '</span></div>';
    h += '<div class="r2-exp-sec" data-exp="opzone"><span class="r2-exp-k">当前操作区 ↓</span></div>';
    if (rep.capabilitySummary) {
      h += '<div class="r2-exp-sec" data-exp="learned"><span class="r2-exp-k">真正学会了什么</span><span class="r2-exp-v">' + esc(rep.capabilitySummary) + '</span></div>';
    }
    if (rep.nextReason) {
      h += '<div class="r2-exp-sec" data-exp="next"><span class="r2-exp-k">下一步为什么学</span><span class="r2-exp-v">' + esc(rep.nextReason) + '</span></div>';
    }
    return h;
  };

  Round2Exp.injectTemplate = function (id) {
    if (typeof LevelExperienceRegistry === 'undefined') return;
    var rep = LevelExperienceRegistry[id];
    if (!rep) return;
    var box = document.getElementById('level-content');
    if (!box) return;
    var old = document.getElementById('r2-lev-exp');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var panel = document.createElement('div');
    panel.id = 'r2-lev-exp';
    panel.className = 'r2-exp-panel';
    panel.setAttribute('data-level-exp', id);
    panel.innerHTML = Round2Exp.templateHTML(rep);
    if (box.firstChild) box.insertBefore(panel, box.firstChild);
    else box.appendChild(panel);
  };

  Round2Exp.handleCompletion = function (id, rep) {
    var _realStart = Game.startLevel, _realBack = Game.backToMap;
    // 吞掉原 done() 在 1400ms 调度的自动跳转，改为弹出统一完成反馈
    Game.startLevel = function () {};
    Game.backToMap = function () {};
    var self = Level;
    setTimeout(function () {
      Game.startLevel = _realStart; Game.backToMap = _realBack;
      var m = (typeof getLevelMeta === 'function') ? getLevelMeta(id) : null;
      var isCore = !!(m && m.type === 'core');
      var nextCore = isCore && (typeof getNextCoreLevel === 'function') ? getNextCoreLevel(id) : null;
      var canAdvance = !!(nextCore && State.levels[nextCore] &&
        (typeof _realUnlocked === 'function' ? _realUnlocked(nextCore) : true));
      Completion.show({
        tier: rep.completionTier,
        levelId: id,
        levelTitle: (m && m.title) || id,
        xp: (LevelData[id] && LevelData[id].xp) || 0,
        capability: rep.capabilitySummary,
        canDo: rep.canDo,
        realExample: rep.realExample,
        nextReason: rep.nextReason,
        worldName: rep.worldName || (m && m.world) || '',
        capabilityList: rep.capabilityList,
        realTask: rep.realTask,
        nextPurpose: rep.nextPurpose,
        onContinue: function () {
          if (canAdvance) _realStart(nextCore); else _realBack();
        }
      });
    }, 1500);
  };

  /* ---- 包裹 Level.render / Level.done（只拦截已注册的代表关卡） ---- */
  if (typeof Level !== 'undefined' && Level && typeof Level.render === 'function') {
    var _origRender = Level.render.bind(Level);
    Level.render = function (id) {
      var r = _origRender(id);
      try { Round2Exp.injectTemplate(id); } catch (e) {}
      return r;
    };
  }
  if (typeof Level !== 'undefined' && Level && typeof Level.done === 'function') {
    var _origDone = Level.done.bind(Level);
    Level.done = function () {
      var id = this.current;
      var rep = (typeof LevelExperienceRegistry !== 'undefined') ? LevelExperienceRegistry[id] : null;
      if (!rep) { return _origDone(); }
      _origDone();
      if (this._completing === true) { Round2Exp.handleCompletion(id, rep); }
      return;
    };
  }

  /* ---- 暴露到全局，供测试访问 ---- */
  window.LevelExperienceRegistry = LevelExperienceRegistry;
  window.AssetRegistry = AssetRegistry;
  window.Completion = Completion;

  /* ---- 注入样式（自包含，不依赖既有 class） ---- */
  (function injectCSS() {
    try {
      var s = document.createElement('style');
      s.textContent =
        '.r2-exp-panel{border:2px dashed #b89020;background:#fffdf3;border-radius:12px;padding:12px 14px;margin-bottom:14px;box-shadow:0 2px 0 rgba(0,0,0,.06)}' +
        '.r2-exp-head{font-weight:900;color:#5a4a20;margin-bottom:8px}' +
        '.r2-exp-sec{display:flex;gap:8px;padding:5px 0;border-top:1px dashed #eee}' +
        '.r2-exp-k{flex:0 0 92px;font-weight:700;color:#8a6d20}' +
        '.r2-exp-v{flex:1;line-height:1.7}' +
        '.r2-exp-ul{margin:2px 0 2px 18px;padding:0;line-height:1.7}' +
        '.r2-exp-sec[data-exp=opzone]{color:#2a7;font-weight:700;border-top:2px solid #2a7}' +
        '.asset-fallback{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:2px dashed #bbb;border-radius:8px;background:#fafafa;color:#888;font-size:13px}' +
        '.asset-img{max-width:100%;border-radius:8px}' +
        '.r2-comp-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9999}' +
        '.r2-comp-modal.active{display:flex}' +
        '.r2-comp-card{background:#fff;border:3px solid #222;border-radius:16px;max-width:460px;width:92%;padding:20px;box-shadow:0 6px 0 rgba(0,0,0,.25)}' +
        '.r2-comp-badge{text-align:center;margin-bottom:10px}' +
        '.r2-comp-icon{font-size:40px}' +
        '.r2-comp-title{font-weight:900;font-size:20px}' +
        '.r2-comp-sub{color:#666;font-size:13px;margin-top:2px}' +
        '.r2-comp-body{margin:12px 0}' +
        '.r2-comp-row{display:flex;gap:10px;padding:7px 0;border-top:1px solid #eee}' +
        '.r2-comp-k{flex:0 0 110px;font-weight:700;color:#444}' +
        '.r2-comp-v{flex:1;line-height:1.7}' +
        '.r2-comp-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:8px}';
      if (document.head) document.head.appendChild(s);
    } catch (e) {}
  })();
})();
