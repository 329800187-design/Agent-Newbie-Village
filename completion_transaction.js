/* =====================================================================
 * R1.2 Round4-P0 — 完成事务一致性组件 (CompletionTransaction)
 *
 * 目标（仅解决技术债，不扩展关卡 / 不迁移 74 关 / 不修改 LevelData /
 *      课程哈希 / 门禁业务规则 / Round3 fail-closed 门禁）：
 *   1) 提交前状态快照（最小精确子集，覆盖本轮审计的全部权威字段）；
 *   2) 明确的事务边界（阶段 A 校验 → B 权威写入 → C 展示）；
 *   3) 唯一成功提交点（所有权威内存写入 + State.save 成功 + 重读一致后）；
 *   4) 提交前（阶段 B）异常完整回滚（内存 + 持久化一致）；
 *   5) 提交后（阶段 C）展示异常不回滚，标记 post_commit_error；
 *   6) 可诊断、可复测的故障注入机制（默认关闭，仅测试显式注册生效）。
 *
 * 依赖（均通过 window 访问，缺失时安全降级，不阻断正常流程）：
 *   - Level / LevelData / State / Game / Cert / WorldMap / Artifact /
 *     LearningLog / _refreshUnlockedFlags / getLevelMeta / getNextCoreLevel
 *   - Round3Diagnostics（诊断记录，禁止空 catch）
 *   - InteractionProgress / ErrorFeedback（Round3 门禁展示，仅 W6/W7）
 *
 * 本文件由 apply_round4.py 注入到 round3-dev HTML 的 </body> 之前。
 * 它假设引擎 Level.done 已被重排为 _commitCompletion(id)（阶段 B，无展示）
 * 与 _showCompletion(meta)（阶段 C，仅展示），由本文件的 Level.done
 * 包装统一编排：门禁 → 快照 → 提交 → 唯一成功提交点 → 展示。
 * ===================================================================== */
(function () {
  'use strict';

  var R3D = (typeof Round3Diagnostics !== 'undefined' && Round3Diagnostics)
    ? Round3Diagnostics
    : { record: function () {}, clear: function () {} };

  /* ------------------------------------------------------------------
   * 深拷贝：支持 undefined / 布尔 / 数字 / 字符串 / 数组 / 纯对象 / Date；
   *        遇到 function、DOM、含 toJSON 的不可序列化对象 → 明确抛错并阻止提交。
   * ------------------------------------------------------------------ */
  function deepClone(v) {
    if (v === null) return null;
    if (v === undefined) return undefined;
    var t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string') return v;
    if (t === 'function') throw new Error('CompletionTransaction: 不可序列化值(function)，阻止提交');
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(deepClone(v[i]));
      return a;
    }
    if (t === 'object') {
      if (typeof v.toJSON === 'function') {
        // 仅 Date 合法；其它含 toJSON 的对象视为不可序列化
        if (!(v instanceof Date)) {
          throw new Error('CompletionTransaction: 不可序列化值(toJSON)，阻止提交');
        }
        return new Date(v.getTime());
      }
      var o = {};
      var keys = Object.keys(v);
      for (var k = 0; k < keys.length; k++) o[keys[k]] = deepClone(v[keys[k]]);
      return o;
    }
    throw new Error('CompletionTransaction: 无法克隆类型 ' + t + '，阻止提交');
  }

  /* ------------------------------------------------------------------
   * 计算下一核心关（用于快照确定受影响字段）
   * ------------------------------------------------------------------ */
  function nextCoreOf(levelId) {
    try {
      var meta = (typeof getLevelMeta === 'function') ? getLevelMeta(levelId) : null;
      var isCore = !!(meta && meta.type === 'core');
      if (!isCore || typeof getNextCoreLevel !== 'function') return null;
      return getNextCoreLevel(levelId);
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------
   * CompletionTransaction — 完成事务状态机
   * ------------------------------------------------------------------ */
  var states = {}; // levelId -> state 对象

  function blankState(levelId) {
    return {
      levelId: levelId,
      phase: 'idle',
      startedAt: null,
      committedAt: null,
      rolledBackAt: null,
      status: 'idle',          // idle | committed | rendering | rolled_back | post_commit_error | rollback_persist_failed
      commitPointReached: false,
      rollbackReason: null,
      snapshotFields: null,
      restoredFields: null,
      snapshot: null
    };
  }

  var CompletionTransaction = {
    begin: function (levelId) {
      var st = blankState(levelId);
      st.phase = 'validating';
      st.startedAt = Date.now();
      states[levelId] = st;
      return st;
    },

    snapshot: function (levelId) {
      var st = states[levelId] || (states[levelId] = blankState(levelId));
      if (!st.startedAt) st.startedAt = Date.now();
      st.phase = 'mutating';

      var snap;
      try {
        var next = nextCoreOf(levelId);
        snap = {
          currentLevelState: deepClone(State.levels[levelId]),
          affectedNextLevelState: (next && State.levels[next]) ? deepClone(State.levels[next]) : null,
          affectedGlobalFields: {
            currentLevel: State.currentLevel,
            totalStars: State.totalStars,
            xp: State.xp,
            achievements: State.achievements.slice()
          },
          persistedSave: (typeof localStorage !== 'undefined')
            ? localStorage.getItem('agent_village_d')
            : null
        };
      } catch (e) {
        // 不可序列化值 → 明确失败并阻止提交
        st.phase = 'rolled_back';
        st.status = 'rolled_back';
        st.rollbackReason = String(e && e.message || e);
        R3D.record('CompletionTransaction.snapshot', e);
        throw new Error('快照失败（不可序列化），阻止提交: ' + (e && e.message || e));
      }

      st.snapshot = snap;
      st.snapshotFields = ['currentLevelState', 'affectedNextLevelState', 'affectedGlobalFields', 'persistedSave'];
      return snap;
    },

    commit: function (levelId) {
      var st = states[levelId];
      if (!st) return false;
      if (st.commitPointReached) return true; // 幂等

      // 1) 持久化内容必须存在
      var persisted = (typeof localStorage !== 'undefined') ? localStorage.getItem('agent_village_d') : null;
      if (!persisted) { this.rollback(levelId, new Error('commit: 持久化内容缺失')); return false; }

      // 2) 重读一致性（内存 ↔ 持久化）
      var d;
      try { d = JSON.parse(persisted); } catch (e) { this.rollback(levelId, new Error('commit: 持久化解析失败')); return false; }
      if (!d || !d.levels || !d.levels[levelId]) { this.rollback(levelId, new Error('commit: 重读 levels 缺失')); return false; }
      if (d.levels[levelId].completed !== State.levels[levelId].completed) {
        this.rollback(levelId, new Error('commit: 重读 completed 不一致')); return false;
      }
      if (d.currentLevel !== State.currentLevel) {
        this.rollback(levelId, new Error('commit: 重读 currentLevel 不一致')); return false;
      }
      if (d.totalStars !== State.totalStars || d.xp !== State.xp) {
        this.rollback(levelId, new Error('commit: 重读 统计不一致')); return false;
      }
      var next = nextCoreOf(levelId);
      if (next && d.levels[next] && d.levels[next].unlocked !== State.levels[next].unlocked) {
        this.rollback(levelId, new Error('commit: 重读 下一关 unlocked 不一致')); return false;
      }
      if (JSON.stringify(d.achievements || []) !== JSON.stringify(State.achievements)) {
        this.rollback(levelId, new Error('commit: 重读 achievements 不一致')); return false;
      }

      // 3) 唯一成功提交点
      st.commitPointReached = true;
      st.committedAt = Date.now();
      st.phase = 'committed';
      st.status = 'committed';
      return true;
    },

    rollback: function (levelId, error) {
      var st = states[levelId];
      if (!st) { R3D.record('CompletionTransaction.rollback', error); return; }
      if (!st.snapshot) {
        st.phase = 'rolled_back';
        st.status = 'rolled_back';
        st.rollbackReason = String(error && error.message || error);
        st.rolledBackAt = Date.now();
        R3D.record('CompletionTransaction.rollback', error);
        return;
      }

      var snap = st.snapshot;
      var restored = {};
      try {
        if (snap.currentLevelState) {
          State.levels[levelId] = deepClone(snap.currentLevelState);
          restored.currentLevelState = true;
        }
        var next = nextCoreOf(levelId);
        if (snap.affectedNextLevelState && next && State.levels[next]) {
          State.levels[next] = deepClone(snap.affectedNextLevelState);
          restored.affectedNextLevelState = true;
        }
        if (snap.affectedGlobalFields) {
          State.currentLevel = snap.affectedGlobalFields.currentLevel;
          State.totalStars = snap.affectedGlobalFields.totalStars;
          State.xp = snap.affectedGlobalFields.xp;
          State.achievements = snap.affectedGlobalFields.achievements.slice();
          restored.affectedGlobalFields = true;
        }
        // 持久化回滚（重写旧存档字符串）
        if (typeof localStorage !== 'undefined' && snap.persistedSave !== undefined) {
          try {
            localStorage.setItem('agent_village_d', snap.persistedSave);
          } catch (e2) {
            st.status = 'rollback_persist_failed';
            st.phase = 'rolled_back';
            st.rollbackReason = String(error && error.message || error);
            st.restoredFields = restored;
            st.rolledBackAt = Date.now();
            R3D.record('CompletionTransaction.rollback.persist', e2);
            return; // 双重持久化失败：禁止继续提交，提示重载
          }
        }
        if (typeof _refreshUnlockedFlags === 'function') _refreshUnlockedFlags();
      } catch (e) {
        R3D.record('CompletionTransaction.rollback', e);
      }

      st.restoredFields = restored;
      st.phase = 'rolled_back';
      st.status = (st.status === 'rollback_persist_failed') ? 'rollback_persist_failed' : 'rolled_back';
      st.rollbackReason = String(error && error.message || error);
      st.rolledBackAt = Date.now();
      R3D.record('CompletionTransaction.rollback', error);
    },

    finish: function (levelId) {
      var st = states[levelId];
      if (!st) return;
      if (st.commitPointReached) { st.phase = 'committed'; st.status = 'committed'; }
    },

    markPostCommitError: function (levelId, error) {
      var st = states[levelId];
      if (!st) {
        st = states[levelId] = blankState(levelId);
      }
      // 阶段 C 异常：不回滚已提交事务；仅记录诊断 + 标记状态
      st.status = 'post_commit_error';
      st.phase = 'rendering';
      st.rollbackReason = String(error && error.message || error);
      R3D.record('CompletionTransaction.post_commit_error', error);
    },

    getState: function (levelId) {
      var st = states[levelId];
      if (!st) return null;
      return {
        levelId: st.levelId,
        phase: st.phase,
        startedAt: st.startedAt,
        committedAt: st.committedAt,
        rolledBackAt: st.rolledBackAt,
        status: st.status,
        commitPointReached: st.commitPointReached,
        rollbackReason: st.rollbackReason,
        snapshotFields: st.snapshotFields,
        restoredFields: st.restoredFields
      };
    },

    reset: function (levelId) {
      if (levelId) delete states[levelId];
      else states = {};
    }
  };

  /* ------------------------------------------------------------------
   * CompletionTransactionFaults — 故障注入（默认全部关闭）
   *   * 仅当测试显式 arm() 时生效；生产 / 正常流程绝不自动注入。
   *   * TEST_MODE=false 时不得自动注入（arm 由测试显式调用，测试在 TEST_MODE
   *     无关的独立页面上下文运行，不影响交付件 TEST_MODE）。
   *   * 清理后不残留全局状态（clearAll 还原被 patch 的函数）。
   *   * 支持注入点：before_snapshot / after_snapshot / before_completed_write /
   *     after_completed_write / after_completed_at_write / after_next_unlock /
   *     before_save / during_save / after_save / before_commit_point /
   *     after_commit_point / during_completion_ui / during_toast
   * ------------------------------------------------------------------ */
  var cleanupList = [];
  var Faults = {
    _armed: {},
    arm: function (point, opts) {
      var o = { mode: 'throw', once: true, fired: false };
      if (opts) { if (opts.mode) o.mode = opts.mode; if (opts.once !== undefined) o.once = opts.once; }
      this._armed[point] = o;
      // during_save：直接 patch State.save 抛错（最贴近“保存中异常”）
      if (point === 'during_save' && typeof State !== 'undefined' && typeof State.save === 'function') {
        var orig = State.save;
        State.save = function () { throw new Error('CompletionTransactionFaults: injected during_save'); };
        cleanupList.push(function () { State.save = orig; });
      }
    },
    disarm: function (point) {
      if (point) delete this._armed[point];
      else this._armed = {};
    },
    isArmed: function (point) { return !!this._armed[point]; },
    fire: function (point) {
      var f = this._armed[point];
      if (!f) return;
      if (f.once && f.fired) return;
      f.fired = true;
      if (f.mode === 'throw') throw new Error('CompletionTransactionFaults: injected at ' + point);
      if (f.mode === 'corrupt') {
        // after_save：保存成功后故意破坏持久化，使重读不一致 → 触发回滚
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem('agent_village_d', '{"corrupted":true,"levels":{}}');
        } catch (e) { R3D.record('CompletionTransactionFaults.corrupt', e); }
      }
    },
    clearAll: function () {
      this._armed = {};
      cleanupList.forEach(function (fn) { try { fn(); } catch (e) { R3D.record('CompletionTransactionFaults.cleanup', e); } });
      cleanupList = [];
    }
  };

  /* ------------------------------------------------------------------
   * Level.done 重编排（Round3 fail-closed 门禁完整保留；阶段 B/C 分离）
   * ------------------------------------------------------------------ */
  if (typeof Level !== 'undefined' && Level && typeof Level._commitCompletion === 'function') {
    var _commit = Level._commitCompletion.bind(Level);
    var _show = Level._showCompletion.bind(Level);
    var IP = (typeof InteractionProgress !== 'undefined') ? InteractionProgress : null;
    var EF = (typeof ErrorFeedback !== 'undefined') ? ErrorFeedback : null;

    Level.done = function () {
      var id = this.current;
      var lvl = (typeof LevelData !== 'undefined') ? LevelData[id] : null;
      var rep = (typeof LevelExperienceRegistry !== 'undefined') ? LevelExperienceRegistry[id] : null;
      var isR3 = !!(rep && (typeof Round3Levels !== 'undefined') && Round3Levels.indexOf(id) >= 0);

      // ── 阶段 A：门禁（复刻 Round3 fail-closed；仅 W6/W7 有门禁）──
      try {
        if (IP && isR3) { IP.ensure(id, rep.interactionSteps || []); IP.sync(id); }
      } catch (e) { R3D.record('r4.gate.sync', e); }

      if (id === 'w6_9' || id === 'w7_7') {
        var gs = (IP && IP.getState) ? IP.getState(id) : null;
        var g = gs && gs.gate;
        if (!g || g.passed !== true) {
          this._completing = false;
          if (IP && IP.fail) { try { IP.fail(id, null, g && g.status === 'error' ? '门禁状态读取失败，请重新进入关卡后重试' : '当前门禁尚未通过'); } catch (e) { R3D.record('r4.gate.fail', e); } }
          if (EF) { try { EF.recordAttempt(id); if (rep && rep.errorHints) EF.show(id, rep.errorHints); } catch (e) { R3D.record('r4.gate.ef', e); } }
          if (typeof Game !== 'undefined' && Game && Game.toast) {
            Game.toast(g && g.status === 'error' ? '门禁状态异常，已阻止提交' : '请先完成当前关卡的全部真实门禁');
          }
          return false;
        }
      }

      // ── 幂等：已完成关再次调用，直接返回，不重复计数 / 不重复弹窗 ──
      if (State.levels[id] && State.levels[id].completed === true) {
        this._completing = false;
        return true;
      }

      // ── 事务开始 + 提交前快照（阶段 A→B 边界）──
      CompletionTransaction.begin(id);
      Faults.fire('before_snapshot');
      var snap = CompletionTransaction.snapshot(id);
      Faults.fire('after_snapshot');
      if (!snap) {
        this._completing = false;
        return false;
      }

      // ── 阶段 B + 唯一成功提交点（提交点之前异常 → 完整回滚）──
      var meta = null;
      try {
        // ── 阶段 B：权威状态事务（含引擎原生门禁 + 全部权威写入 + 持久化）──
        meta = _commit(id);
        if (!meta) {
          // 阶段 B 未提交（引擎门禁未过或内部失败）→ 完整回滚
          CompletionTransaction.rollback(id, new Error('阶段B未提交(引擎门禁或内部失败)'));
          return false;
        }
        // ── 唯一成功提交点：重读一致性校验 ──
        Faults.fire('before_commit_point');
        var committed = CompletionTransaction.commit(id);
        if (!committed) {
          // commit 内部已回滚
          return false;
        }
      } catch (e) {
        // ── 阶段 B / 提交点之前任意异常 → 完整回滚（内存 + 持久化一致）──
        CompletionTransaction.rollback(id, e);
        R3D.record('r4.commit', e);
        return false;
      } finally {
        // 所有出口恢复提交锁，绝不遗留
        this._completing = false;
      }

      // ── 阶段 C：提交点之后（展示 + 后续处理）。异常不回滚，仅标记 post_commit_error ──
      // 提交点之后已是"已提交事务"，任何故障都不得撤销已完成事实。
      try {
        Faults.fire('after_commit_point');
        // ── 阶段 C：展示（异常不回滚）──
        try { _show(meta); }
        catch (e) { CompletionTransaction.markPostCommitError(id, e); }
        // ── Round3 成功后续处理（复刻 round3 wrapper 成功分支）──
        try {
          if (IP && isR3) {
            (rep.interactionSteps || []).forEach(function (s) { try { IP.complete(id, s.id); } catch (e) { R3D.record('r4.post.ip_complete', e); } });
            if (IP.clearFailure) IP.clearFailure(id);
            if (IP._refreshGate) IP._refreshGate(id);
            if (EF && EF.clear) EF.clear(id);
          }
        } catch (e) { R3D.record('r4.post.success', e); }
        return true;
      } catch (e2) {
        // 提交点之后异常：不回滚已提交事务，仅记录诊断 + 标记状态
        CompletionTransaction.markPostCommitError(id, e2);
        return true;
      }
    };
  }

  /* ---- 暴露到全局，供测试访问 ---- */
  window.CompletionTransaction = CompletionTransaction;
  window.CompletionTransactionFaults = Faults;
})();
