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
   * 递归深比较（提交点重读一致性校验；覆盖 directive §一 全部持久化字段）
   *   - 以期望对象 a 的键为准；a 中值为 undefined 的键视为非必填（与 JSON 序列化一致）
   *   - actual 含 a 没有的键 → 不一致（如被删除的关卡记录）
   * ------------------------------------------------------------------ */
  function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    var ta = typeof a, tb = typeof b;
    if (ta !== tb) return false;
    if (ta === 'number' && isNaN(a) && isNaN(b)) return true;
    if (ta === 'object') {
      if (a instanceof Array) {
        if (!(b instanceof Array) || a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
      }
      var ka = Object.keys(a), kb = Object.keys(b);
      for (var k = 0; k < ka.length; k++) {
        var key = ka[k];
        if (a[key] === undefined) continue; // JSON 序列化会丢弃 undefined，不要求 actual 含该键
        if (!deepEqual(a[key], b[key])) return false;
      }
      for (var j = 0; j < kb.length; j++) {
        if (ka.indexOf(kb[j]) < 0) return false; // actual 多出的键 → 不一致
      }
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------
   * 根据 State.save() 的真实结构生成规范化期望对象
   *   schemaVersion / currentLevel / levels(全部) / xp / totalStars /
   *   achievements / peipeiFound / learnerProfile
   * ------------------------------------------------------------------ */
  function buildExpectedPersistedState() {
    var sv = (typeof SCHEMA_VERSION !== 'undefined') ? SCHEMA_VERSION : 3;
    return {
      schemaVersion: sv,
      currentLevel: State.currentLevel,
      levels: deepClone(State.levels),
      xp: State.xp,
      totalStars: State.totalStars,
      achievements: deepClone(State.achievements),
      peipeiFound: State.peipeiFound,
      learnerProfile: deepClone(State.learnerProfile)
    };
  }

  /* ------------------------------------------------------------------
   * 回滚验证辅助(§二/§三/§六): 递归深比较完整内存状态 + 持久化重读一致性 +
   *   诊断哈希(仅诊断, 不独占比较, 不记录完整用户存档内容)。
   * ------------------------------------------------------------------ */
  function dhash(x) {
    // FNV-1a 32-bit, 输出 8 位 hex; 仅用于诊断摘要
    try {
      var s = (typeof x === 'string') ? x : JSON.stringify(x);
      if (s === undefined || s === null) s = 'null';
      var h = 0x811c9dc5;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return ('0000000' + h.toString(16)).slice(-8);
    } catch (e) { return 'HASH_ERR'; }
  }

  // 递归深比较恢复后的完整内存状态(§二): 当前关完整状态 / 下一关完整状态 /
  // State.currentLevel / State.totalStars / State.xp / State.achievements
  // 注: unlocked 为派生字段, 由 _refreshUnlockedFlags 在回滚中确定性重算, 不纳入深比较
  //     (否则重算后的 unlocked 会与快照中捕获的 unlocked 不一致, 误报内存回滚失败)。
  function stripUnlocked(o) {
    if (!o || typeof o !== 'object') return o;
    var c = deepClone(o);
    delete c.unlocked;
    return c;
  }
  function verifyMemoryAgainstSnapshot(levelId, snap) {
    try {
      if (!deepEqual(stripUnlocked(State.levels[levelId]), stripUnlocked(snap.currentLevelState))) return false;
      var next = nextCoreOf(levelId);
      if (snap.affectedNextLevelState) {
        if (!next || !State.levels[next]) return false;
        if (!deepEqual(stripUnlocked(State.levels[next]), stripUnlocked(snap.affectedNextLevelState))) return false;
      }
      if (State.currentLevel !== snap.affectedGlobalFields.currentLevel) return false;
      if (State.totalStars !== snap.affectedGlobalFields.totalStars) return false;
      if (State.xp !== snap.affectedGlobalFields.xp) return false;
      if (!deepEqual(State.achievements, snap.affectedGlobalFields.achievements)) return false;
      return true;
    } catch (e) {
      R3D.record('CompletionTransaction.verifyMemory', e);
      return false;
    }
  }

  // 持久化写后重读一致性(§三): 存在则 actual===persistedSave; 不存在则 actual===null
  function verifyPersistenceRestored(snap) {
    if (typeof localStorage === 'undefined') return false;
    var actual = localStorage.getItem('agent_village_d');
    if (!snap.persistedSaveExists) {
      return actual === null;
    }
    return actual === snap.persistedSave;
  }

  // §二/§四: 派生解锁状态诊断(仅哈希 + 不匹配 ID, 不记录完整用户存档)
  function buildDerivedVerification(snap) {
    var expected = (snap && snap.derivedUnlockedState) ? snap.derivedUnlockedState : {};
    var actual = captureDerivedUnlockedState();
    var mismatchedIds = [];
    Object.keys(expected).forEach(function (id) {
      if (!!actual[id] !== !!expected[id]) mismatchedIds.push(id);
    });
    Object.keys(actual).forEach(function (id) {
      if (!(id in expected) && !!actual[id]) mismatchedIds.push(id);
    });
    return {
      expectedHash: dhash(expected),
      actualHash: dhash(actual),
      mismatchedIds: mismatchedIds
    };
  }

  // §二: 捕获全量派生 unlocked 基线(遍历 LevelData, 不限于当前关或下一核心关)
  function captureDerivedUnlockedState() {
    var out = {};
    var ids = (typeof LevelData !== 'undefined' && LevelData) ? Object.keys(LevelData) : [];
    ids.forEach(function (id) {
      out[id] = !!(State.levels[id] && State.levels[id].unlocked);
    });
    return out;
  }

  // §三: 派生状态必须经结果验证(刷新后完整 unlocked map 与快照深比较)
  function verifyDerivedUnlockedState(snap) {
    if (!snap || !snap.derivedUnlockedState) return false;
    var actual = captureDerivedUnlockedState();
    return deepEqual(actual, snap.derivedUnlockedState);
  }

  // 仅诊断用的不可变证据(§六): 记录预期/实际哈希, 不记录完整存档内容
  function buildRollbackVerification(levelId, snap) {
    var next = nextCoreOf(levelId);
    var memExpected = {
      currentLevelState: snap.currentLevelState,
      affectedNextLevelState: snap.affectedNextLevelState,
      affectedGlobalFields: snap.affectedGlobalFields
    };
    var memActual = {
      currentLevelState: State.levels[levelId],
      affectedNextLevelState: (next && State.levels[next]) ? State.levels[next] : null,
      affectedGlobalFields: {
        currentLevel: State.currentLevel,
        totalStars: State.totalStars,
        xp: State.xp,
        achievements: State.achievements
      }
    };
    var actualPersist = (typeof localStorage !== 'undefined') ? (localStorage.getItem('agent_village_d') || '') : '';
    var dv = buildDerivedVerification(snap);
    return {
      memoryExpectedHash: dhash(memExpected),
      memoryActualHash: dhash(memActual),
      persistenceExpectedHash: dhash(snap.persistedSave || ''),
      persistenceActualHash: dhash(actualPersist),
      derivedExpectedHash: dv.expectedHash,
      derivedActualHash: dv.actualHash,
      derivedMismatchedLevelIds: dv.mismatchedIds
    };
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
    } catch (e) {
      // §五: 无法确定下一核心关 → 上抛, 不得静默吞异常(否则会创建缺下一关信息的快照)
      R3D.record('CompletionTransaction.nextCoreOf', e);
      throw e;
    }
  }

  /* ------------------------------------------------------------------
   * CompletionTransaction — 完成事务状态机
   * ------------------------------------------------------------------ */
  var states = {}; // levelId -> state 对象
  // §五: 独立于普通事务状态的"生产安全锁"; 出现 rollback_failed / rollback_persist_failed 时写入,
  //      阻止该关后续提交重试; reset() 不得清除; clearSubmissionBlockForTest() 仅供测试。
  var unsafeLevels = {};

  function blankState(levelId) {
    return {
      levelId: levelId,
      phase: 'idle',
      startedAt: null,
      committedAt: null,
      rolledBackAt: null,
      status: 'idle',          // idle | committed | rolled_back | post_commit_error | rollback_failed | rollback_persist_failed
      commitPointReached: false,
      rollbackReason: null,
      snapshotFields: null,
      restoredFields: null,
      rollbackVerification: null,   // §六: {memoryExpectedHash, memoryActualHash, persistenceExpectedHash, persistenceActualHash}
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
        var lsExists = (typeof localStorage !== 'undefined');
        var rawSave = lsExists ? localStorage.getItem('agent_village_d') : null;
        snap = {
          currentLevelState: deepClone(State.levels[levelId]),
          affectedNextLevelState: (next && State.levels[next]) ? deepClone(State.levels[next]) : null,
          affectedGlobalFields: {
            currentLevel: State.currentLevel,
            totalStars: State.totalStars,
            xp: State.xp,
            achievements: State.achievements.slice()
          },
          persistedSave: rawSave,
          persistedSaveExists: rawSave !== null,
          derivedUnlockedState: captureDerivedUnlockedState()
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
      st.snapshotFields = ['currentLevelState', 'affectedNextLevelState', 'affectedGlobalFields', 'persistedSave', 'derivedUnlockedState'];
      return snap;
    },

    commit: function (levelId) {
      var st = states[levelId];
      if (!st) return false;
      if (st.commitPointReached) return true; // 幂等

      // 1) 持久化内容必须存在
      var persisted = (typeof localStorage !== 'undefined') ? localStorage.getItem('agent_village_d') : null;
      if (!persisted) { this.rollback(levelId, new Error('commit: 持久化内容缺失')); return false; }

      // 2) 重读一致性（内存权威状态 ↔ 持久化，递归深比较完整结构）
      var actual;
      try { actual = JSON.parse(persisted); } catch (e) { this.rollback(levelId, new Error('commit: 持久化解析失败')); return false; }
      var expected;
      try { expected = buildExpectedPersistedState(); }
      catch (e) { this.rollback(levelId, new Error('commit: 期望状态构造失败: ' + (e && e.message || e))); return false; }
      if (!deepEqual(actual, expected)) {
        // 任一字段缺失或不一致（当前关 completed/stars/其它、下一关记录存在性或 unlocked、
        // 全部 levels 记录、currentLevel/xp/totalStars/achievements/peipeiFound/learnerProfile/schemaVersion）
        this.rollback(levelId, new Error('commit: 重读持久化与内存权威状态不一致（完整结构深比较失败）'));
        return false;
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
      var result = { memoryRestored: false, persistenceRestored: false, derivedStateRefreshed: false, success: false };
      if (!st) {
        R3D.record('CompletionTransaction.rollback', error);
        return result;
      }
      if (!st.snapshot) {
        st.phase = 'rolled_back';
        st.status = 'rolled_back';
        st.rollbackReason = String(error && error.message || error);
        st.rolledBackAt = Date.now();
        R3D.record('CompletionTransaction.rollback', error);
        result.memoryRestored = true; result.persistenceRestored = true; result.derivedStateRefreshed = true; result.success = true;
        return result;
      }

      var snap = st.snapshot;

      // 直接内存恢复(闭包捕获 levelId / snap)
      function restoreCurrentLevel() {
        if (snap.currentLevelState) State.levels[levelId] = deepClone(snap.currentLevelState);
      }
      function restoreNextLevel() {
        var nx = nextCoreOf(levelId);
        if (snap.affectedNextLevelState && nx && State.levels[nx]) {
          State.levels[nx] = deepClone(snap.affectedNextLevelState);
        }
      }
      function restoreGlobalFields() {
        State.currentLevel = snap.affectedGlobalFields.currentLevel;
        State.totalStars = snap.affectedGlobalFields.totalStars;
        State.xp = snap.affectedGlobalFields.xp;
        State.achievements = snap.affectedGlobalFields.achievements.slice();
      }
      function refreshDerivedState() {
        if (typeof _refreshUnlockedFlags === 'function') _refreshUnlockedFlags();
      }

      // ── 顺序(§四): 1)恢复直接内存 2)_refreshUnlockedFlags 3)验证完整内存 4)恢复持久化 5)重读验证持久化 ──
      // §二: 禁止提前置 memoryRestored=true; 仅当 verifyMemoryAgainstSnapshot 通过才置位
      var memoryOk = false;
      try {
        restoreCurrentLevel();
        restoreNextLevel();
        restoreGlobalFields();
        // 2) 派生状态刷新(§三: _refreshUnlockedFlags 后必须与快照深比较, 一致才 derivedStateRefreshed=true)
        try {
          if (typeof _refreshUnlockedFlags === 'function') _refreshUnlockedFlags();
          result.derivedStateRefreshed = verifyDerivedUnlockedState(snap);
          if (!result.derivedStateRefreshed) {
            // 派生静默失败: 记录 expected/actual 哈希 + 不匹配 ID(不记录完整存档)
            var dv0 = buildDerivedVerification(snap);
            R3D.record('CompletionTransaction.rollback.derived_verify',
              'expected=' + dv0.expectedHash + ' actual=' + dv0.actualHash +
              ' mismatched=' + (dv0.mismatchedIds.join(',') || '(none)'));
          }
        } catch (e3) {
          result.derivedStateRefreshed = false;
          R3D.record('CompletionTransaction.rollback.derived', e3);
        }
        // 3) 验证恢复后的完整内存状态(递归深比较)
        memoryOk = verifyMemoryAgainstSnapshot(levelId, snap);
      } catch (e) {
        memoryOk = false;
        R3D.record('CompletionTransaction.rollback.memory', e);
      }
      result.memoryRestored = memoryOk;

      // ── 4) 恢复持久化 ──
      try {
        if (typeof localStorage !== 'undefined') {
          if (snap.persistedSaveExists) {
            localStorage.setItem('agent_village_d', snap.persistedSave);
          } else {
            // 故障前不存在 → 故障后仍不存在（绝不写入字符串 "null"）
            localStorage.removeItem('agent_village_d');
          }
        }
        // ── 5) 重读验证持久化(§三): 写后必须能重读出一致内容, 否则视为恢复失败 ──
        var persistOk = verifyPersistenceRestored(snap);
        if (!persistOk) {
          // diagnostics 记录 expected/actual 摘要(不记录完整存档内容)
          var actualRaw = (typeof localStorage !== 'undefined') ? localStorage.getItem('agent_village_d') : null;
          R3D.record('CompletionTransaction.rollback.persist_verify',
            'expectedExists=' + snap.persistedSaveExists +
            ' expectedLen=' + (snap.persistedSave || '').length +
            ' actualExists=' + (actualRaw !== null) +
            ' actualLen=' + (actualRaw || '').length);
        }
        result.persistenceRestored = persistOk;
      } catch (e2) {
        result.persistenceRestored = false;
        R3D.record('CompletionTransaction.rollback.persist', e2);
      }

      // ── §六 诊断哈希(仅诊断, 不独占比较, 不记录完整用户存档内容) ──
      try { st.rollbackVerification = buildRollbackVerification(levelId, snap); }
      catch (e4) { st.rollbackVerification = null; R3D.record('CompletionTransaction.rollback.verification', e4); }

      // ── 终态判定: 内存/持久化/派生任一失败 → 不得标记普通 rolled_back ──
      if (result.memoryRestored && result.persistenceRestored && result.derivedStateRefreshed) {
        st.status = 'rolled_back';
      } else if (!result.persistenceRestored) {
        st.status = 'rollback_persist_failed';
      } else {
        st.status = 'rollback_failed';
      }
      // §五: 内存/持久化回滚失败 → 写入独立 unsafe 提交锁, 阻止该关后续重复提交重试
      if (st.status === 'rollback_failed' || st.status === 'rollback_persist_failed') {
        unsafeLevels[levelId] = { blocked: true, reason: st.status, createdAt: Date.now() };
      }
      st.phase = 'rolled_back';
      st.rollbackReason = String(error && error.message || error);
      st.restoredFields = { memory: result.memoryRestored, persistence: result.persistenceRestored, derived: result.derivedStateRefreshed };
      st.rolledBackAt = Date.now();
      // §四: 只能依据最终状态验证, 不得依据"某一步执行过"判定成功
      result.success = result.memoryRestored && result.persistenceRestored && result.derivedStateRefreshed;
      if (!result.success) {
        // 提示用户重新加载
        if (typeof Game !== 'undefined' && Game && Game.toast) {
          try { Game.toast('提交回滚失败，请重新加载页面以恢复存档'); }
          catch (e) { R3D.record('CompletionTransaction.rollback.toast_fail', e); }
        }
      }
      R3D.record('CompletionTransaction.rollback', error);
      return result;
    },

    abortBeforeMutation: function (levelId, error) {
      // 快照阶段（事务开始 → 提交前）失败的统一终态：明确失败，不残留 validating/idle
      var st = states[levelId] || (states[levelId] = blankState(levelId));
      st.phase = 'mutating';
      st.status = 'preflight_failed';
      st.rollbackReason = String(error && error.message || error);
      st.rolledBackAt = Date.now();
      R3D.record('CompletionTransaction.abortBeforeMutation', error);
      return false;
    },

    finish: function (levelId) {
      var st = states[levelId];
      if (!st) return false;
      if (!st.commitPointReached) return false;
      // §一: post_commit_error 是粘性终态 —— 已提交但后续动作失败, 不得覆盖错误事实
      if (st.status === 'post_commit_error') {
        st.phase = 'post_commit_error';
        return true;
      }
      st.phase = 'committed';
      st.status = 'committed';
      return true;
    },

    markPostCommitError: function (levelId, error) {
      var st = states[levelId];
      if (!st) {
        st = states[levelId] = blankState(levelId);
      }
      // §一: 阶段 C 异常 → 不回滚已提交事务; 仅记录诊断 + 标记粘性终态(不得用 rendering)
      st.status = 'post_commit_error';
      st.phase = 'post_commit_error';
      st.rollbackReason = String(error && error.message || error);
      R3D.record('CompletionTransaction.post_commit_error', error);
    },

    getState: function (levelId) {
      var st = states[levelId];
      if (!st) return null;
      // §二/§六: 返回深拷贝, 外部修改不得污染内部事务状态(尤其 rollbackVerification 哈希证据)
      return deepClone({
        levelId: st.levelId,
        phase: st.phase,
        startedAt: st.startedAt,
        committedAt: st.committedAt,
        rolledBackAt: st.rolledBackAt,
        status: st.status,
        commitPointReached: st.commitPointReached,
        rollbackReason: st.rollbackReason,
        snapshotFields: st.snapshotFields,
        restoredFields: st.restoredFields,
        rollbackVerification: st.rollbackVerification   // §六: 不可变证据(预期/实际哈希)
      });
    },

    reset: function (levelId) {
      // §六: reset 仅清理普通事务状态, 不得清除 unsafeLevels 生产安全锁
      if (levelId) delete states[levelId];
      else states = {};
    },

    // §五: 查询某关是否被安全锁阻止提交
    isSubmissionBlocked: function (levelId) {
      var b = unsafeLevels[levelId];
      return !!(b && b.blocked);
    },

    // §五: 读取安全锁详情(深拷贝, 防止外部污染)
    getSubmissionBlock: function (levelId) {
      var b = unsafeLevels[levelId];
      return b ? deepClone(b) : null;
    },

    // §六: 仅供测试显式调用, 生产流程 / TEST_MODE=false 绝不自动调用
    clearSubmissionBlockForTest: function (levelId) {
      if (levelId) delete unsafeLevels[levelId];
      else unsafeLevels = {};
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
      if (opts) {
        if (opts.mode) o.mode = opts.mode;
        if (opts.once !== undefined) o.once = opts.once;
        if (typeof opts.patch === 'function') o.patch = opts.patch;
      }
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
        // after_save：保存成功后破坏持久化，使重读不一致 → 触发回滚
        try {
          if (typeof localStorage !== 'undefined') {
            if (typeof f.patch === 'function') {
              // 定向破坏：读取当前持久化 → 应用 patch（注入特定字段不一致/缺失）→ 写回
              var cur = localStorage.getItem('agent_village_d');
              var obj = cur ? JSON.parse(cur) : {};
              f.patch(obj);
              localStorage.setItem('agent_village_d', JSON.stringify(obj));
            } else {
              localStorage.setItem('agent_village_d', '{"corrupted":true,"levels":{}}');
            }
          }
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
   * 提交点之后的完成侧作用（独立于展示；任一失败不回滚主事务，继续其它）
   *   - clearDraft / learningLog / artifact / starBurst 均不得在阶段 B 内执行
   *   - 阶段 B 回滚后绝不会运行到这里（侧作用只在 commitPointReached 之后）
   * ------------------------------------------------------------------ */
  function safePostCommit(levelId, scope, fn) {
    try {
      fn();
    } catch (e) {
      // 单项失败：不回滚已提交事务，仅标记粘性 post_commit_error 并继续其它相互独立动作
      var st = states[levelId];
      if (st) { st.status = 'post_commit_error'; st.phase = 'post_commit_error'; }
      R3D.record('CompletionTransaction.post_commit.' + scope, e);
    }
  }
  function runPostCommitSideEffects(levelId, meta) {
    if (!meta) return;
    var id = levelId;
    // 清理 W6/W7 草稿（仅对应关卡）
    safePostCommit(id, 'clearDraft', function () {
      if (id === 'w6_9' && typeof Sim !== 'undefined' && Sim && Sim.clearDraft) Sim.clearDraft();
      if (id === 'w7_7' && typeof WfSim !== 'undefined' && WfSim && WfSim.clearDraft) WfSim.clearDraft();
    });
    // 学习日志（level_complete）
    safePostCommit(id, 'learningLog', function () {
      if (typeof LearningLog !== 'undefined' && LearningLog && LearningLog.log) LearningLog.log('level_complete', id, '', 1, false, true);
    });
    // 通关产物
    safePostCommit(id, 'artifact', function () {
      if (typeof Artifact !== 'undefined' && Artifact && Artifact.saveLevel && meta._payload) Artifact.saveLevel(id, meta._payload);
    });
    // 视觉特效
    safePostCommit(id, 'starBurst', function () {
      if (typeof Game !== 'undefined' && Game && Game.starBurst) Game.starBurst();
    });
  }

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

      // ── §五: 提交前拦截 — 若上一次事务失败未恢复(rollback_failed / rollback_persist_failed),
      //        安全锁阻止该关任何提交重试, 必须重新加载页面(begin/snapshot/权威写入前)。
      if (CompletionTransaction.isSubmissionBlocked(id)) {
        this._completing = false;
        R3D.record('CompletionTransaction.submission_blocked', new Error('检测到未恢复的事务失败，必须重新加载页面'));
        if (typeof Game !== 'undefined' && Game && Game.toast) {
          try { Game.toast('上一次提交未完整恢复，请重新加载页面后再试'); }
          catch (e) { R3D.record('CompletionTransaction.submission_blocked.toast', e); }
        }
        return false;
      }

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

      // ── 事务开始 + 提交前快照（阶段 A→B 边界；统一捕获，失败进入 preflight_failed 终态）──
      var snap;
      try {
        CompletionTransaction.begin(id);
        Faults.fire('before_snapshot');
        snap = CompletionTransaction.snapshot(id);
        Faults.fire('after_snapshot');
      } catch (e) {
        CompletionTransaction.abortBeforeMutation(id, e);
        this._completing = false;
        return false;
      }
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

      // ── 阶段 C：提交点之后（提交点 = 不可回退边界）。异常不回滚，仅标记 post_commit_error ──
      // 提交点之后已是"已提交事务"，任何故障都不得撤销已完成事实。
      try {
        Faults.fire('after_commit_point');
        // ── 完成侧作用（独立于展示，提交点之后执行；任一失败不回滚主事务）──
        // runPostCommitSideEffects 内部每个动作已各自 safePostCommit 捕获, 本身不抛;
        // 若意外抛错则交由本阶段外层 catch 标记 post_commit_error, 仍不回滚已提交事务。
        runPostCommitSideEffects(id, meta);
        // ── 阶段 C：展示（异常不回滚）──
        try { _show(meta); }
        catch (e) { CompletionTransaction.markPostCommitError(id, e); }
        // ── Round3 成功后续处理（复刻 round3 wrapper 成功分支）──
        try {
          if (IP && isR3) {
            // §八: Round3 成功后续处理统一走 post-commit 安全包装(任一失败 → 粘性 post_commit_error, 不回滚, 其余继续)
            (rep.interactionSteps || []).forEach(function (s) {
              safePostCommit(id, 'round3.ip_complete.' + s.id, function () { IP.complete(id, s.id); });
            });
            safePostCommit(id, 'round3.clearFailure', function () { if (IP.clearFailure) IP.clearFailure(id); });
            safePostCommit(id, 'round3.refreshGate', function () { if (IP._refreshGate) IP._refreshGate(id); });
            safePostCommit(id, 'round3.errorFeedbackClear', function () { if (EF && EF.clear) EF.clear(id); });
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
