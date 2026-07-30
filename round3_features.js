/* =====================================================================
 * R1.2 Round3-R1 骨架扩展（独立 <script>，链在 Round2-R2 之上，不修改
 * LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件）
 *
 * 提供：
 *   1) InteractionProgress  —— 公共交互进度对象（步骤 / 门禁 / 失败原因 / 可提交）
 *      * 实时组件：complete/fail/_refreshGate/reset 立即刷新 DOM 面板；
 *        并提供统一 sync() 与 updatePanel() / ensure()。
 *      * ensure(): 状态不存在才创建；schema 未变保留 done；schema 变按 stepId 迁移。
 *      * _recalc(): submitAllowed = 步骤全完成 AND 门禁允许。
 *   2) ErrorFeedback        —— 公共错误反馈对象（渐进式提示，绝不泄露正确答案）
 *      * 每关 protectedAnswerFragments：提示只给回看位置/分析维度/检查顺序/
 *        自我提问/验证方法，绝不写完成标准答案。
 *   3) Round3Diagnostics    —— 公共错误记录（禁止空 catch）。
 *   4) Round3 第二批关键关卡接入 —— 9 关（含 w5_8 替代不存在的 w5_9）接入
 *      LevelExperienceRegistry + InteractionProgress + ErrorFeedback + 对应 completion tier。
 *
 * 关键边界（如实声明）：
 *   * InteractionProgress / ErrorFeedback 的状态只存于自身 _state，绝不写入 LevelData。
 *   * W6/W7 门禁只读取 Sim / WfSim 的真实状态（readGate，fail-closed），不伪造通过。
 *   * 门禁读取失败 → passed:false / status:'error' / 记录诊断，绝不降级为「无门禁」。
 *   * ErrorFeedback 不展示正确答案、不绕过 completion gate。
 *   * 所有 catch 均记录到 Round3Diagnostics，禁止空 catch。
 * ===================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  // 9 关（w5_9 在 LevelData 中不存在，W5 真正 boss 为 w5_8，故以 w5_8 替代）
  var R3_LEVELS = ['ai_camp_11', 'w1_8', 'w2_6', 'w3_6', 'w3_13', 'w4_7', 'w5_8', 'w6_9', 'w7_7'];

  /* ------------------------------------------------------------------
   * 0) Round3Diagnostics —— 公共错误记录（禁止空 catch）
   * ------------------------------------------------------------------ */
  var Round3Diagnostics = {
    errors: [],
    record: function (scope, error) {
      this.errors.push({ scope: scope, message: String(error && error.message || error) });
      console.error('[Round3:' + scope + ']', error);
    },
    clear: function () { this.errors = []; }
  };

  /* ------------------------------------------------------------------
   * 1) InteractionProgress —— 公共交互进度对象（实时组件）
   * ------------------------------------------------------------------ */
  var InteractionProgress = { _state: {} };

  // 全新创建（会清空既有进度）
  InteractionProgress._create = function (levelId, steps) {
    steps = steps || [];
    var st = {
      levelId: levelId,
      steps: steps.map(function (s, i) {
        return { id: s.id || ('step' + i), label: s.label || ('步骤' + (i + 1)), done: false };
      }),
      current: 0,
      failReason: null,
      submitAllowed: false,
      gate: null
    };
    this._state[levelId] = st;
    this._refreshGate(levelId);
    this._recalc(levelId);
    this.updatePanel(levelId);
    return st;
  };

  // 兼容手动/旧测试调用：等同于全新创建（会清空既有进度）
  // 注意：关卡包裹逻辑改用 ensure()，避免每次提交清空进度。
  InteractionProgress.init = function (levelId, steps) {
    if (this._state[levelId]) delete this._state[levelId];
    return this._create(levelId, steps);
  };

  // ensure: 状态不存在才创建；已存在则保留完成进度
  InteractionProgress.ensure = function (levelId, steps) {
    steps = steps || [];
    var existing = this._state[levelId];
    if (!existing) {
      return this._create(levelId, steps);
    }
    var oldIds = (existing.steps || []).map(function (s) { return s.id; });
    var newIds = steps.map(function (s) { return s.id || ''; });
    var sameSchema = oldIds.length === newIds.length &&
      oldIds.every(function (id, i) { return id === newIds[i]; });
    if (sameSchema) {
      // schema 未变 → 保留所有 done 状态
      existing.total = steps.length;
      this._refreshGate(levelId);
      this._recalc(levelId);
      this.updatePanel(levelId);
      return existing;
    }
    // schema 变化 → 按 stepId 迁移已完成状态
    var doneMap = {};
    (existing.steps || []).forEach(function (s) { if (s.done) doneMap[s.id] = true; });
    existing.steps = steps.map(function (s, i) {
      var id = s.id || ('step' + i);
      return { id: id, label: s.label || ('步骤' + (i + 1)), done: !!doneMap[id] };
    });
    existing.total = steps.length;
    this._refreshGate(levelId);
    this._recalc(levelId);
    this.updatePanel(levelId);
    return existing;
  };

  InteractionProgress._recalc = function (levelId) {
    var st = this._state[levelId];
    if (!st) return;
    var done = 0;
    st.steps.forEach(function (s) { if (s.done) done++; });
    st.completedCount = done;
    st.total = st.steps.length;
    // submitAllowed 必须纳入真实门禁
    var stepsDone = st.total > 0 && done === st.total;
    var gateAllows = !st.gate || st.gate.passed === null || st.gate.passed === true;
    st.submitAllowed = stepsDone && gateAllows;
    // 推进 current 到下一个未完成步骤
    var next = st.total;
    for (var i = 0; i < st.steps.length; i++) {
      if (!st.steps[i].done) { next = i; break; }
    }
    st.current = next;
  };

  // 实时：complete 后立即刷新门禁、重算、刷新面板
  InteractionProgress.complete = function (levelId, stepId) {
    var st = this._state[levelId];
    if (!st) return false;
    for (var i = 0; i < st.steps.length; i++) {
      if (st.steps[i].id === stepId) { st.steps[i].done = true; break; }
    }
    this._refreshGate(levelId);
    this._recalc(levelId);
    this.updatePanel(levelId);
    return true;
  };

  // 实时：fail 后立即显示失败原因（刷新面板）
  InteractionProgress.fail = function (levelId, stepId, reason) {
    var st = this._state[levelId];
    if (!st) return false;
    st.failReason = reason || '未完成';
    this._refreshGate(levelId);
    this._recalc(levelId);
    this.updatePanel(levelId);
    return true;
  };

  // 实时：reset 后移除或重建对应面板
  InteractionProgress.reset = function (levelId) {
    if (this._state[levelId]) delete this._state[levelId];
    this.updatePanel(levelId); // 状态移除 → 面板同步移除
    return true;
  };

  // 成功完成后清理旧失败原因(并随之重算 submitAllowed / 刷新面板)
  InteractionProgress.clearFailure = function (levelId) {
    var st = this._state[levelId];
    if (!st) return false;
    st.failReason = null;
    this._recalc(levelId);
    this.updatePanel(levelId);
    return true;
  };

  // 统一同步方法：刷新门禁 + 重算 + 刷新面板
  InteractionProgress.sync = function (levelId) {
    this._refreshGate(levelId);
    this._recalc(levelId);
    this.updatePanel(levelId);
    return this._state[levelId] || null;
  };

  // 更新已有面板；状态不存在则移除面板；状态存在但面板缺失则注入
  InteractionProgress.updatePanel = function (levelId) {
    var st = this._state[levelId];
    var panel = document.getElementById('r3-iprog');
    if (!st) {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      return;
    }
    var html = this.render(levelId);
    if (panel) {
      panel.innerHTML = html; // 就地更新，无需重新进入关卡
    } else if (typeof Round3Exp !== 'undefined') {
      Round3Exp.injectProgress(levelId);
    }
  };

  // 只读读取门禁状态（W6/W7 读取 Sim/WfSim 真实状态；fail-closed 不降级为「无门禁」）
  // 关键边界: 门禁对象或状态缺失 → 一律视为未通过 (passed:false / status:'error'),
  //          并记录 Round3Diagnostics, 绝不降级为「无门禁」。
  function readGate(levelId) {
    if (levelId === 'w6_9') {
      if (typeof Sim === 'undefined' || !Sim) {
        var e1 = new Error('Sim 门禁对象不存在');
        Round3Diagnostics.record('readGate:w6_9', e1);
        return { label: 'W6 · Agent 配置门禁', passed: false, status: 'error', error: e1.message };
      }
      if (!Sim.state) {
        var e2 = new Error('Sim.state 门禁状态不存在');
        Round3Diagnostics.record('readGate:w6_9', e2);
        return { label: 'W6 · Agent 配置门禁', passed: false, status: 'error', error: e2.message };
      }
      try {
        // 镜像原始引擎 W6 完成条件(不得仅凭 isCurrentRevisionPassed 放行):
        //   configStatus==='submitted' && isCurrentRevisionPassed() && getConfig 与 configSnapshot 一致
        var currentConfig6 = Sim.getConfig();
        var passed6 =
          Sim.state.configStatus === 'submitted' &&
          typeof Sim.isCurrentRevisionPassed === 'function' &&
          Sim.isCurrentRevisionPassed() === true &&
          JSON.stringify(currentConfig6) === JSON.stringify(Sim.state.configSnapshot);
        return {
          label: 'W6 · Agent 配置门禁',
          passed: !!passed6,
          status: Sim.state.configStatus || 'n/a'
        };
      } catch (e) {
        Round3Diagnostics.record('readGate:w6_9', e);
        return { label: 'W6 · Agent 配置门禁', passed: false, status: 'error', error: String(e && e.message || e) };
      }
    }
    if (levelId === 'w7_7') {
      if (typeof WfSim === 'undefined' || !WfSim) {
        var e3 = new Error('WfSim 门禁对象不存在');
        Round3Diagnostics.record('readGate:w7_7', e3);
        return { label: 'W7 · 工作流门禁', passed: false, status: 'error', error: e3.message };
      }
      if (!WfSim.state) {
        var e4 = new Error('WfSim.state 门禁状态不存在');
        Round3Diagnostics.record('readGate:w7_7', e4);
        return { label: 'W7 · 工作流门禁', passed: false, status: 'error', error: e4.message };
      }
      try {
        // 镜像原始引擎 W7 完成条件(额外要求 workflow_sequence / workflow_builder 已通过):
        //   configStatus==='submitted' && isCurrentRevisionPassed() && getConfig 与 configSnapshot 一致
        //   && interactionPassed.workflow_sequence === true && interactionPassed.workflow_builder === true
        var currentConfig7 = WfSim.getConfig();
        var ipW7 = (typeof Level !== 'undefined' && Level && Level.interactionPassed) || {};
        var passed7 =
          WfSim.state.configStatus === 'submitted' &&
          typeof WfSim.isCurrentRevisionPassed === 'function' &&
          WfSim.isCurrentRevisionPassed() === true &&
          JSON.stringify(currentConfig7) === JSON.stringify(WfSim.state.configSnapshot) &&
          ipW7.workflow_sequence === true &&
          ipW7.workflow_builder === true;
        return {
          label: 'W7 · 工作流门禁',
          passed: !!passed7,
          status: WfSim.state.configStatus || 'n/a'
        };
      } catch (e) {
        Round3Diagnostics.record('readGate:w7_7', e);
        return { label: 'W7 · 工作流门禁', passed: false, status: 'error', error: String(e && e.message || e) };
      }
    }
    return { label: '无门禁（普通关卡）', passed: null, status: 'n/a' };
  }

  InteractionProgress._refreshGate = function (levelId) {
    var st = this._state[levelId];
    if (st) st.gate = readGate(levelId);
  };

  // 当前步骤标签: 全部完成显示「已完成」, 否则显示「(当前步+1) / 总步」, 杜绝分子大于分母(如 5/4)
  InteractionProgress.currentLabel = function (st) {
    if (!st || !st.total) return '—';
    if (st.completedCount === st.total) return '已完成';
    return (st.current + 1) + ' / ' + st.total;
  };

  // render: 返回面板「内部」HTML（不含 #r3-iprog 外层包裹，由 injectProgress 包裹）
  InteractionProgress.render = function (levelId) {
    var st = this._state[levelId];
    if (!st) return '';
    var g = st.gate || { label: '无门禁', passed: null, status: 'n/a' };
    var gateTxt = g.label + '：' + (g.passed === true ? '已通过' : (g.passed === false ? '未通过' : '不适用'));
    var lis = st.steps.map(function (s, i) {
      var cls = s.done ? 'done' : (i === st.current ? 'current' : '');
      var mark = s.done ? '✅' : (i === st.current ? '▶' : '○');
      return '<li class="r3-ip-step ' + cls + '">' + mark + ' ' + esc(s.label) + '</li>';
    }).join('');
    return '<div class="r3-ip-head">📊 交互进度</div>' +
      '<div class="r3-ip-row">当前步骤：' + esc(this.currentLabel(st)) + '</div>' +
      '<div class="r3-ip-row">已完成 / 总步骤：' + st.completedCount + ' / ' + st.total + '</div>' +
      '<ul class="r3-ip-steps">' + lis + '</ul>' +
      '<div class="r3-ip-row">当前门禁：' + esc(gateTxt) + '</div>' +
      '<div class="r3-ip-row">未完成原因：' + esc(st.failReason || '无') + '</div>' +
      '<div class="r3-ip-row">是否允许提交：' + (st.submitAllowed ? '是' : '否') + '</div>';
  };

  InteractionProgress.getState = function (levelId) {
    var st = this._state[levelId];
    if (!st) return null;
    return {
      levelId: st.levelId,
      current: st.current,
      completedCount: st.completedCount,
      total: st.total,
      failReason: st.failReason,
      submitAllowed: st.submitAllowed,
      gate: st.gate,
      steps: st.steps.map(function (s) { return { id: s.id, label: s.label, done: s.done }; })
    };
  };

  /* ------------------------------------------------------------------
   * 2) ErrorFeedback —— 公共错误反馈对象（渐进式提示，不泄露答案）
   * ------------------------------------------------------------------ */
  var ErrorFeedback = { _state: {} };

  function _efBlank() {
    return {
      errorType: '', whatWentWrong: '', whyItHappened: '', repairAction: '',
      verificationMethod: '', attemptCount: 0, canRetry: true, _shownFullSteps: false
    };
  }

  ErrorFeedback.clear = function (levelId) {
    if (this._state[levelId]) delete this._state[levelId];
    var old = document.getElementById('r3-err-feedback');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    return true;
  };

  ErrorFeedback.recordAttempt = function (levelId) {
    var st = this._state[levelId] || (this._state[levelId] = _efBlank());
    st.attemptCount = (st.attemptCount || 0) + 1;
    st.canRetry = st.attemptCount < 3; // 第三次起展示完整步骤, 不再有更高层级提示
    return st;
  };

  ErrorFeedback.getState = function (levelId) {
    var st = this._state[levelId];
    if (!st) return null;
    return {
      errorType: st.errorType, whatWentWrong: st.whatWentWrong, whyItHappened: st.whyItHappened,
      repairAction: st.repairAction, verificationMethod: st.verificationMethod,
      attemptCount: st.attemptCount, canRetry: st.canRetry, _shownFullSteps: !!st._shownFullSteps
    };
  };

  // hints: 长度 >=3 的渐进式提示数组（方向 / 更具体 / 完整步骤）；绝不写正确答案
  ErrorFeedback.show = function (levelId, hints) {
    hints = hints || [];
    var st = this._state[levelId] || (this._state[levelId] = _efBlank());
    var idx = Math.min((st.attemptCount || 1) - 1, Math.max(0, hints.length - 1));
    var h = hints[idx] || hints[hints.length - 1] || {};
    st.errorType = h.errorType || st.errorType || '通用错误';
    st.whatWentWrong = h.whatWentWrong || st.whatWentWrong || '';
    st.whyItHappened = h.whyItHappened || st.whyItHappened || '';
    st.repairAction = h.repairAction || st.repairAction || '';
    st.verificationMethod = h.verificationMethod || st.verificationMethod || '';
    st._shownFullSteps = (st.attemptCount >= 3); // 第三次才允许展示完整步骤
    this._renderPanel(levelId);
    return st;
  };

  ErrorFeedback._renderPanel = function (levelId) {
    var st = this._state[levelId];
    if (!st) return;
    var box = document.getElementById('level-content');
    if (!box) { Round3Diagnostics.record('ErrorFeedback._renderPanel', 'level-content 缺失'); return; }
    var old = document.getElementById('r3-err-feedback');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var panel = document.createElement('div');
    panel.id = 'r3-err-feedback';
    panel.className = 'r3-err';
    panel.setAttribute('data-level', levelId);
    panel.innerHTML =
      '<div class="r3-err-head">⚠️ 错误反馈（第 ' + st.attemptCount + ' 次尝试）</div>' +
      '<div class="r3-err-row"><b>错误类型：</b>' + esc(st.errorType) + '</div>' +
      '<div class="r3-err-row"><b>哪里不对：</b>' + esc(st.whatWentWrong) + '</div>' +
      '<div class="r3-err-row"><b>为什么会这样：</b>' + esc(st.whyItHappened) + '</div>' +
      '<div class="r3-err-row"><b>修复动作：</b>' + esc(st.repairAction) + '</div>' +
      '<div class="r3-err-row"><b>验证方法：</b>' + esc(st.verificationMethod) + '</div>' +
      '<div class="r3-err-row"><b>可否重试：</b>' + (st.canRetry ? '可以' : '已给出完整步骤，请按步骤检查') + '</div>';
    box.appendChild(panel);
  };

  /* ------------------------------------------------------------------
   * 3) Round3 第二批关键关卡接入
   *    - 5 个新关：写入 LevelExperienceRegistry 完整元数据
   *    - 4 个已在 Round2 registry 的关：仅增强 interactionSteps / errorHints
   *    - 每关 protectedAnswerFragments：提示绝不泄露完成标准答案
   * ------------------------------------------------------------------ */
  var R3_NEW = {
    'ai_camp_11': {
      templateType: '启蒙营结业模板',
      taskBrief: '把启蒙营里反复练习的四件事串成一张「我学会了什么」清单，作为结业证明',
      why: '启蒙营结束不是终点；把零散认知收拢成清单，之后遇到 AI 才知道该用哪条',
      completionCriteria: [
        '能说清 AI 的回答是「预测下一个词」而不是「理解」',
        '能举出至少一个 AI 会一本正经胡说八道的场景',
        '能说清什么时候必须自己核实、不能盲信',
        '能复述启蒙营教给你的核心自我保护原则'
      ],
      capabilitySummary: '你已完成 AI 启蒙，建立了基础且正确的 AI 认知框架',
      nextReason: '下一站进入终端世界，开始真正动手指挥电脑。',
      splashId: 'J01',
      completionTier: 'normal',
      // 提示只给"回看位置/分析维度/检查顺序/自我提问/验证方法"，绝不写答案
      protectedAnswerFragments: ['AI 不真懂，只是预测', '预测下一个词', '不是理解'],
      interactionSteps: [
        { id: 'recall', label: '复述 AI 的本质' },
        { id: 'example', label: '举一个 AI 会胡说八道的例子' },
        { id: 'verify', label: '说明何时必须自己核实' },
        { id: 'principle', label: '复述核心自我保护原则' }
      ],
      errorHints: [
        { errorType: '认知复述不完整', whatWentWrong: '结业清单里少了关键点', whyItHappened: '可能只记住了零散例子，没串成体系', repairAction: '回看启蒙营开头几关关于"机器如何生成回答"的讲解，列出它和人类认知的三处不同', verificationMethod: '对照脑图：能否分别说出机器做法与人类认知' },
        { errorType: '认知复述不完整', whatWentWrong: '清单缺了底层机制', whyItHappened: '容易把"记住一句话"当成"真正弄懂"', repairAction: '回看"机器如何生成回答"那段演示，用自己的话写一句它为什么不算真正理解', verificationMethod: '能否用一句话解释"预测"与"理解"的区别' },
        { errorType: '认知复述不完整', whatWentWrong: '四个要点仍不完整', whyItHappened: '维度缺失', repairAction: '完整自查步骤：① 机器生成回答的机制 ② 它会胡说八道的场景 ③ 何时必须自己核实 ④ 自我保护原则；逐项对照是否都能讲清', verificationMethod: '四项逐一打勾，缺项补回' }
      ]
    },
    'w1_8': {
      templateType: '终端世界 Boss 模板',
      taskBrief: '在终端里完成一个跨目录的小任务，作为终端世界的毕业 Boss',
      why: '终端是你直接指挥电脑的入口；能独立跑通多步命令，才算真正入门',
      completionCriteria: [
        '能说清每一步命令在做什么',
        '能解释输出为什么符合预期',
        '能把零散命令串成一条可复现的操作链路'
      ],
      capabilitySummary: '你已能用终端完成跨目录的小任务',
      nextReason: '下一站进入「文件与路径」世界，把目录操作练成肌肉记忆。',
      splashId: 'J01',
      completionTier: 'boss',
      protectedAnswerFragments: ['先 pwd 确认当前目录', '相对路径还是绝对路径', '可复现的操作链路'],
      interactionSteps: [
        { id: 'step1', label: '执行第 1 步命令并观察输出' },
        { id: 'step2', label: '在正确目录执行第 2 步' },
        { id: 'step3', label: '串联并验证最终结果' }
      ],
      errorHints: [
        { errorType: '终端链路中断', whatWentWrong: '命令没在预期目录执行', whyItHappened: '可能漏了切换目录或路径拼错', repairAction: '先想清楚"我现在位于哪个目录"，再去决定命令该怎么写', verificationMethod: '用一句话描述当前目录后再继续' },
        { errorType: '终端链路中断', whatWentWrong: '中间某步输出不对', whyItHappened: '命令顺序或参数错了', repairAction: '逐步回放：每执行一条就对照预期输出，错的那条单独重跑', verificationMethod: '逐步核对每条命令的输出' },
        { errorType: '终端链路中断', whatWentWrong: '整条链路仍不通', whyItHappened: '缺了前置步骤', repairAction: '完整动作清单：① 确认所在位置 ② 决定路径写法 ③ 执行核心命令 ④ 用输出验证，顺序不可乱', verificationMethod: '按四步重跑并对照预期' }
      ]
    },
    'w2_6': {
      templateType: '文件与路径世界 Boss 模板',
      taskBrief: '用相对/绝对路径在多个文件夹间搬运与重命名文件，作为文件世界的毕业 Boss',
      why: '路径是程序的「地址系统」；搞错路径，代码就找不到文件',
      completionCriteria: [
        '能区分相对路径与绝对路径',
        '能说清目标文件最终被放到了哪里',
        '能在路径写错时定位并修正'
      ],
      capabilitySummary: '你已掌握文件与路径的核心操作',
      nextReason: '下一站进入「代码执行」世界，开始读懂并运行脚本。',
      splashId: 'J01',
      completionTier: 'boss',
      protectedAnswerFragments: ['相对路径以 / 开头', '绝对路径以 / 开头', '用 pwd 看起点'],
      interactionSteps: [
        { id: 'locate', label: '确认源文件与目标目录' },
        { id: 'move', label: '用正确路径搬运/重命名' },
        { id: 'verify', label: '验证文件落点正确' }
      ],
      errorHints: [
        { errorType: '路径错误', whatWentWrong: '文件没出现在预期位置', whyItHappened: '相对路径的"起点"理解错了', repairAction: '先想清楚"相对谁"：终端的当前目录是相对路径的起点', verificationMethod: '用命令看当前目录并对照起点' },
        { errorType: '路径错误', whatWentWrong: '目标目录不对', whyItHappened: '把一种写法当成了另一种', repairAction: '绝对写法以根符号开头，相对写法不带；分不清时用绝对写法最稳', verificationMethod: '检查路径是否以根符号开头' },
        { errorType: '路径错误', whatWentWrong: '仍落点错误', whyItHappened: '缺少逐步验证', repairAction: '完整步骤：① 看起点 ② 拼出目标绝对写法 ③ 执行移动 ④ 验证落点', verificationMethod: '按四步重做并确认落点' }
      ]
    },
    'w3_6': {
      templateType: '代码执行过程判断模板',
      taskBrief: '给定一段会循环/分支的小脚本，判断「每一轮循环后变量怎么变、最终输出什么」',
      why: '读不懂执行过程，就只能盲信 AI 给的代码；过程判断是验收能力的根基',
      completionCriteria: [
        '能按执行顺序解释变量变化',
        '能判断循环执行了几轮',
        '能说出最终输出为什么成立'
      ],
      capabilitySummary: '你已经能独立判断一段小脚本的执行过程',
      nextReason: '下一关进一步练习「逐行读懂真实代码」（代码阅读能力）。',
      splashId: 'J01',
      completionTier: 'capability',
      protectedAnswerFragments: ['每轮循环后每个变量', '循环条件小于还是小于等于', '最终 print 输出'],
      interactionSteps: [
        { id: 'trace', label: '逐轮追踪变量变化' },
        { id: 'loop', label: '判断循环轮数' },
        { id: 'output', label: '推导最终输出' }
      ],
      errorHints: [
        { errorType: '执行过程判断偏差', whatWentWrong: '变量变化推错了', whyItHappened: '可能跳过了某一轮', repairAction: '拿一张纸，把每一轮后每个变量的值都写下来', verificationMethod: '对照"每轮一行"的变量表' },
        { errorType: '执行过程判断偏差', whatWentWrong: '循环轮数数错了', whyItHappened: '边界条件看错', repairAction: '重点看循环条件：是"小于"还是"小于等于"，差一轮', verificationMethod: '代入起止值手工数轮数' },
        { errorType: '执行过程判断偏差', whatWentWrong: '最终输出仍不对', whyItHappened: '缺了分支判断', repairAction: '完整步骤：① 列每轮变量 ② 确认轮数 ③ 看分支走哪边 ④ 串出最终打印结果', verificationMethod: '按四步重推并对照' }
      ]
    },
    'w5_8': {
      templateType: '程序运行链路 Boss 模板',
      taskBrief: '把「写代码 → 运行 → 看报错 → 修 → 再运行」串成一条稳定链路，作为程序运行世界的毕业 Boss',
      why: '程序不是写完就完事；能在运行链路里稳定定位问题，才是真会写',
      completionCriteria: [
        '能说清代码从哪运行、依赖什么',
        '能在报错时定位是代码还是环境',
        '能修复并验证程序跑通'
      ],
      capabilitySummary: '你已能独立跑通一条「写-运行-修-验证」链路',
      nextReason: '下一站进入「Agent 工坊」，学习给智能体定边界与权限。',
      splashId: 'J01',
      completionTier: 'boss',
      protectedAnswerFragments: ['依赖没装或路径不对', '代码错还是环境错', '再跑验证'],
      interactionSteps: [
        { id: 'run', label: '运行程序并观察' },
        { id: 'locate', label: '在链路中定位问题（代码/环境）' },
        { id: 'fix', label: '修复并重新验证' }
      ],
      errorHints: [
        { errorType: '运行链路卡住', whatWentWrong: '程序跑不起来', whyItHappened: '可能是环境或位置问题', repairAction: '先确认"程序在哪运行、依赖了什么"，再决定补依赖还是改位置', verificationMethod: '列出运行环境与依赖清单' },
        { errorType: '运行链路卡住', whatWentWrong: '报错定位不到', whyItHappened: '把两类问题混为一谈', repairAction: '看报错类型：语法/逻辑问题在程序内，库缺失/版本问题在运行环境', verificationMethod: '按报错类型归类' },
        { errorType: '运行链路卡住', whatWentWrong: '仍未跑通', whyItHappened: '缺系统化复跑', repairAction: '完整步骤：① 跑一次看报错 ② 判断程序内还是运行环境问题 ③ 修复 ④ 复跑确认，循环直到通过', verificationMethod: '按四步复跑并记录每次变化' }
      ]
    }
  };

  var R3_AUG = {
    'w3_13': {
      protectedAnswerFragments: ['从上到下一行一行读', '每个变量在哪被赋值', 'if/for 走向'],
      interactionSteps: [
        { id: 'order', label: '按从上到下顺序读' },
        { id: 'var', label: '追踪每个变量变化' },
        { id: 'branch', label: '判断 if/for 走向' },
        { id: 'final', label: '推导最终输出' }
      ],
      errorHints: [
        { errorType: '读码偏差', whatWentWrong: '执行顺序理解错', whyItHappened: '可能跳读了某行', repairAction: '强制顺序阅读，一行一行来，不跳行', verificationMethod: '用指读方式复述每一行' },
        { errorType: '读码偏差', whatWentWrong: '变量最终值错', whyItHappened: '漏看某次赋值', repairAction: '盯住每个变量"在哪被改、每次循环后变成多少"', verificationMethod: '列变量变化表' },
        { errorType: '读码偏差', whatWentWrong: '仍推不出输出', whyItHappened: '缺分支/循环判断', repairAction: '完整步骤：① 顺序读 ② 追变量 ③ 判分支与循环 ④ 串最终输出', verificationMethod: '按四步重推' }
      ]
    },
    'w4_7': {
      protectedAnswerFragments: ['先完整看清报错', '库版本 Python 版本', '对比两边环境'],
      interactionSteps: [
        { id: 'read', label: '完整看清报错' },
        { id: 'guess', label: '猜可能原因' },
        { id: 'check', label: '按顺序排查环境差异' },
        { id: 'fix', label: '修复并复跑验证' }
      ],
      errorHints: [
        { errorType: '排查无头绪', whatWentWrong: '不知道从哪查', whyItHappened: '没先读报错', repairAction: '第一步永远是先把报错原文完整读一遍，再动手', verificationMethod: '把报错原文贴出来' },
        { errorType: '排查无头绪', whatWentWrong: '猜错方向', whyItHappened: '忽略了环境差异', repairAction: '最常见是依赖/解释器/密钥/位置这几类差异，逐一对比两边', verificationMethod: '列两边差异清单' },
        { errorType: '排查无头绪', whatWentWrong: '仍报错', whyItHappened: '缺固定顺序', repairAction: '完整步骤：① 读报错 ② 列可能原因 ③ 对比环境缩小差异 ④ 对齐后复跑', verificationMethod: '按四步复跑' }
      ]
    },
    'w6_9': {
      protectedAnswerFragments: ['三个场景同版本全过', 'finalPassedAt 写入', 'Sim 真实状态决定'],
      interactionSteps: [
        { id: 'config', label: '配置 Agent 目标/工具/权限' },
        { id: 'normal', label: '跑通 normal 场景' },
        { id: 'missing', label: '跑通 missing-info 场景' },
        { id: 'risk', label: '跑通 high-risk 场景' }
      ],
      errorHints: [
        { errorType: '门禁未通过', whatWentWrong: '三个场景未同版本全过', whyItHappened: '可能只过了部分场景', repairAction: '回到关卡内，确认每个场景都用同一份配置跑通；本反馈不泄露答案，也不绕过门禁', verificationMethod: '逐一确认各场景的通过情况' },
        { errorType: '门禁未通过', whatWentWrong: '场景间配置不一致', whyItHappened: '改了配置没重跑', repairAction: '锁定一份配置快照，三个场景都用它重跑', verificationMethod: '对比配置与当前状态' },
        { errorType: '门禁未通过', whatWentWrong: '仍卡门禁', whyItHappened: '门禁只读，无法绕过', repairAction: '门禁由关卡内部真实状态决定，请回到关卡按真实玩法完成；本反馈不泄露答案也不绕过门禁', verificationMethod: '看关卡内部真实状态' }
      ],
      note: '门禁只读：readGate 仅读取 Sim 真实状态，绝不伪造通过。'
    },
    'w7_7': {
      protectedAnswerFragments: ['workflow 三场景全过', 'interactionPassed 写入', 'WfSim 真实状态决定'],
      interactionSteps: [
        { id: 'seq', label: '配置 workflow_sequence' },
        { id: 'builder', label: '配置 workflow_builder' },
        { id: 'normal', label: '跑通 normal 场景' },
        { id: 'amount', label: '跑通 high-amount 场景' },
        { id: 'toolfail', label: '跑通 tool-fail 场景' }
      ],
      errorHints: [
        { errorType: '门禁未通过', whatWentWrong: '工作流三场景未全过', whyItHappened: '可能漏了某个分支', repairAction: '回到关卡内，确认每个分支场景都用同一份工作流配置跑通；本反馈不泄露答案，也不绕过门禁', verificationMethod: '逐一确认各场景的通过情况' },
        { errorType: '门禁未通过', whatWentWrong: '场景间状态不一致', whyItHappened: '人工改了中间态', repairAction: '用同一份工作流配置跑全部场景，别手动改中间状态', verificationMethod: '对比配置与当前状态' },
        { errorType: '门禁未通过', whatWentWrong: '仍卡门禁', whyItHappened: '门禁只读，无法绕过', repairAction: '门禁由关卡内部真实状态决定；本反馈不泄露答案也不绕过门禁', verificationMethod: '看关卡内部真实状态' }
      ],
      note: '门禁只读：readGate 仅读取 WfSim 真实状态，绝不伪造通过。'
    }
  };

  // 应用：写入新增关 / 增强已有关
  if (typeof LevelExperienceRegistry !== 'undefined') {
    R3_LEVELS.forEach(function (id) {
      if (R3_NEW[id]) {
        LevelExperienceRegistry[id] = R3_NEW[id];
      } else if (R3_AUG[id]) {
        var rep = LevelExperienceRegistry[id];
        if (rep) {
          rep.interactionSteps = R3_AUG[id].interactionSteps;
          rep.errorHints = R3_AUG[id].errorHints;
          rep.protectedAnswerFragments = R3_AUG[id].protectedAnswerFragments;
          if (R3_AUG[id].note) rep.round3Note = R3_AUG[id].note;
        }
      }
    });
  }

  /* ------------------------------------------------------------------
   * 4) Round3Exp —— 把交互进度面板接入关卡内容
   * ------------------------------------------------------------------ */
  var Round3Exp = {};
  Round3Exp.injectProgress = function (id) {
    if (typeof InteractionProgress === 'undefined') return;
    var box = document.getElementById('level-content');
    if (!box) { Round3Diagnostics.record('Round3Exp.injectProgress', 'level-content 缺失'); return; }
    var old = document.getElementById('r3-iprog');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var panel = document.createElement('div');
    panel.id = 'r3-iprog';
    panel.className = 'r3-iprog-panel';
    panel.setAttribute('data-level-ip', id);
    panel.innerHTML = InteractionProgress.render(id) || '';
    box.appendChild(panel);
  };

  // 包裹 Level.render：仅对 R3 关 ensure 交互进度并注入面板
  if (typeof Level !== 'undefined' && Level && typeof Level.render === 'function') {
    var _origRenderR2 = Level.render.bind(Level);
    Level.render = function (id) {
      var r = _origRenderR2(id);
      try {
        if (R3_LEVELS.indexOf(id) >= 0) {
          var rep = (typeof LevelExperienceRegistry !== 'undefined') ? LevelExperienceRegistry[id] : null;
          if (rep) {
            var steps = rep.interactionSteps || (rep.completionCriteria || []).map(function (c, i) { return { id: 'step' + i, label: c }; });
            InteractionProgress.ensure(id, steps); // 不重置既有进度
            Round3Exp.injectProgress(id);
          }
        }
      } catch (e) { Round3Diagnostics.record('Level.render.wrap', e); }
      return r;
    };
  }

  // 包裹 Level.done：真实门禁阻断(仅 W6/W7) + 成功/失败处理 + 异常恢复提交锁
  // 核心修复: 原始引擎 Level.done 的门禁检查被 `typeof Sim!=='undefined'&&Sim.state`
  //          守卫, 当 Sim/WfSim 缺失时门禁被绕过(level 被直接完成); WfSim.state 为 null
  //          时引擎内部 isCurrentRevisionPassed 解引用抛错。此处统一在 _origDoneR2 之前
  //          以 readGate(镜像引擎条件, fail-closed) 二次把关, 门禁未明确通过则阻止提交。
  if (typeof Level !== 'undefined' && Level && typeof Level.done === 'function') {
    var _origDoneR2 = Level.done.bind(Level);
    Level.done = function () {
      var id = this.current;
      var rep = (typeof LevelExperienceRegistry !== 'undefined') ? LevelExperienceRegistry[id] : null;
      var isR3 = !!(rep && R3_LEVELS.indexOf(id) >= 0);

      // 前置: 保留已完成进度(避免每次提交清空), 并刷新门禁/重算/面板
      try {
        if (isR3) {
          var steps = rep.interactionSteps || [];
          InteractionProgress.ensure(id, steps);
          InteractionProgress.sync(id);
        }
      } catch (e) { Round3Diagnostics.record('Level.done.pre', e); }

      // ── 真实门禁阻断(仅 W6/W7): 门禁未明确通过 → 阻止进入原始完成流程 ──
      if (isR3 && (id === 'w6_9' || id === 'w7_7')) {
        var gateState = InteractionProgress.getState(id);
        var gate = gateState && gateState.gate;
        if (!gate || gate.passed !== true) {
          this._completing = false;
          InteractionProgress.fail(
            id,
            null,
            gate && gate.status === 'error'
              ? '门禁状态读取失败，请重新进入关卡后重试'
              : '当前门禁尚未通过'
          );
          ErrorFeedback.recordAttempt(id);
          if (rep && rep.errorHints) ErrorFeedback.show(id, rep.errorHints);
          if (typeof Game !== 'undefined' && Game && typeof Game.toast === 'function') {
            Game.toast(
              gate && gate.status === 'error'
                ? '门禁状态异常，已阻止提交'
                : '请先完成当前关卡的全部真实门禁'
            );
          }
          return false;
        }
      }

      // ── 仅当门禁明确满足时才进入原始完成流程, 并捕获异常恢复提交锁 ──
      var engineResult;
      try {
        engineResult = _origDoneR2.apply(this, arguments);
      } catch (e) {
        this._completing = false;
        Round3Diagnostics.record('Level.done.engine', e);
        if (isR3) {
          InteractionProgress.fail(id, null, '提交过程出现异常');
          ErrorFeedback.recordAttempt(id);
          if (rep && rep.errorHints) ErrorFeedback.show(id, rep.errorHints);
        }
        return false;
      }

      // ── 事后处理: 成功→标记剩余步骤完成并清错误反馈; 失败→记录尝试并展示错误反馈 ──
      try {
        if (isR3) {
          if (this._completing) {
            // 成功：将剩余步骤标记完成，清除旧失败原因与错误反馈（不重置已完成的步骤）
            (rep.interactionSteps || []).forEach(function (s) { InteractionProgress.complete(id, s.id); });
            InteractionProgress.clearFailure(id);
            InteractionProgress._refreshGate(id);
            ErrorFeedback.clear(id);
          } else {
            // 失败尝试：记录并展示渐进式错误反馈（不泄露答案、不绕过 gate）
            ErrorFeedback.recordAttempt(id);
            if (rep && rep.errorHints) ErrorFeedback.show(id, rep.errorHints);
          }
          InteractionProgress._refreshGate(id);
        }
      } catch (e) { Round3Diagnostics.record('Level.done.post', e); }
      return engineResult;
    };
  }

  /* ---- 暴露到全局，供测试访问 ---- */
  window.InteractionProgress = InteractionProgress;
  window.ErrorFeedback = ErrorFeedback;
  window.Round3Levels = R3_LEVELS;
  window.Round3Diagnostics = Round3Diagnostics;

  /* ---- 注入样式（自包含，不依赖既有 class） ---- */
  (function injectCSS() {
    try {
      var s = document.createElement('style');
      s.textContent =
        '.r3-iprog-panel{border:2px dashed #2a7;background:#f3fffa;border-radius:12px;padding:12px 14px;margin-bottom:14px;box-shadow:0 2px 0 rgba(0,0,0,.06)}' +
        '.r3-iprog{font-size:13px;line-height:1.7}' +
        '.r3-ip-head{font-weight:900;color:#1f6b4a;margin-bottom:8px}' +
        '.r3-ip-row{padding:3px 0}' +
        '.r3-ip-steps{margin:4px 0 4px 18px;padding:0}' +
        '.r3-ip-step.current{font-weight:800;color:#1f6b4a}' +
        '.r3-ip-step.done{color:#888}' +
        '.r3-err{border:2px solid #c0392b;background:#fff5f4;border-radius:12px;padding:12px 14px;margin:14px 0;box-shadow:0 2px 0 rgba(0,0,0,.06)}' +
        '.r3-err-head{font-weight:900;color:#c0392b;margin-bottom:8px}' +
        '.r3-err-row{padding:3px 0;line-height:1.7}';
      if (document.head) document.head.appendChild(s);
    } catch (e) { Round3Diagnostics.record('injectCSS', e); }
  })();
})();
