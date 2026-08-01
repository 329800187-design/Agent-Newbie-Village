# -*- coding: utf-8 -*-
"""apply_round4.py — 由 Round3 派生 round4-p0，注入 R1.2 Round4-P0 完成事务一致性。

用法:
    python apply_round4.py [OUT_PATH]
      OUT_PATH 省略时写入提交的 Agent新手村_R1.2-round4-p0.html (交付件)。
      验收/CI 用临时路径调用两次以比对 SHA256 一致性 (不污染交付件)。

派生关系:
    输入 = Agent新手村_R1.2-round3-dev.html (Round3 交付件, 固定)
    注入 = completion_transaction.js (R1.2 Round4-P0 完成事务组件)
    输出 = Agent新手村_R1.2-round4-p0.html

关键重排（仅移动执行顺序，不修改字段语义 / LevelData / 课程哈希 / 门禁规则）:
    将原始引擎 Level.done() 中的「权威状态写入 + 持久化」(阶段 B) 与
    「toast + setTimeout 展示」(阶段 C) 重排为两个独立方法:
        _commitCompletion(id)  —— 阶段 B：门禁(引擎原生) + 权威写入 + State.save，无展示；返回 meta 或 false
        _showCompletion(meta)  —— 阶段 C：toast + Cert/WorldMap/startLevel 导航，异常不回滚
        done()                 —— 向后兼容薄包装：commit 成功则 show
    真实编排（门禁 → 快照 → 提交 → 唯一成功提交点 → 展示）由注入的
    completion_transaction.js 中的新 Level.done 完成，并保留 Round3 fail-closed 门禁。

不变量:
    * 不修改 Alpha2 冻结文件 / Round2-R2 交付件 / Round3-R3 核心门禁规则 /
      LevelData / 课程哈希 / 课程内容。
    * 注入位置固定为「文档末尾最后一个 </body> 之前」，与 apply_round2/round3 一致。
    * 溯源注释仅含运行前可确定的值 (输入 SHA / 注入位置 / fixture 哈希)，
      两次构建完全一致 → 不影响输出 SHA 一致性。
"""
import hashlib
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
INPUT = os.path.join(BASE, "Agent新手村_R1.2-round3-dev.html")
FEATURES = os.path.join(BASE, "completion_transaction.js")
DEFAULT_OUT = os.path.join(BASE, "Agent新手村_R1.2-round4-p0.html")
FIXTURES = os.path.join(BASE, "tests", "fixtures", "assets")
MANIFEST = os.path.join(BASE, "R1.2_Round4_build_manifest.txt")


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def fixture_manifest_hash():
    if not os.path.isdir(FIXTURES):
        return "none"
    rows = []
    for root, _, files in os.walk(FIXTURES):
        for fn in files:
            if fn.endswith(".png"):
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, FIXTURES)
                rows.append((rel, sha256_file(fp)))
    rows.sort()
    h = hashlib.sha256()
    for rel, s in rows:
        h.update((rel + ":" + s + "\n").encode("utf-8"))
    return h.hexdigest()


# 引擎 Level.done 的「阶段 B / 阶段 C 重排」替换块。
# 保留原始逻辑字符级一致，仅插入 fault 钩子 (_r4fire) 并拆分展示。
REFACTOR_BLOCK = """  _r4fire: function (p) { if (typeof CompletionTransactionFaults !== 'undefined' && CompletionTransactionFaults.fire) CompletionTransactionFaults.fire(p); },
  _commitCompletion: function (id) {
    if (this._completing) return false; this._completing = true;
    var lvl = LevelData[id], st = State.levels[id];
    if (id === 'w6_9' && typeof Sim !== 'undefined' && Sim.state) { var sc = Sim.state; if (sc.configStatus !== 'submitted' || !Sim.isCurrentRevisionPassed() || JSON.stringify(Sim.getConfig()) !== JSON.stringify(sc.configSnapshot)) { this._completing = false; Game.toast('当前配置尚未完成三场景验收'); return false; } }
    if (id === 'w7_7') { var wfOk = typeof WfSim !== 'undefined' && WfSim.state && WfSim.state.configStatus === 'submitted' && WfSim.isCurrentRevisionPassed() && JSON.stringify(WfSim.getConfig()) === JSON.stringify(WfSim.state.configSnapshot) && this.interactionPassed.workflow_sequence === true && this.interactionPassed.workflow_builder === true; if (!wfOk) { this._completing = false; Game.toast('请先完成工作流排序、配置和三场景验收'); return false; } }
    var stars = Math.max(1, 3 - this.hintN); var _first = !st.completed; var _old = st.stars || 0;
    this._r4fire('before_completed_write');
    st.completed = true;
    this._r4fire('after_completed_write');
    if (stars > _old) { State.totalStars += (stars - _old); st.stars = stars; }
    if (_first) { State.xp += lvl.xp; }
    this._r4fire('after_completed_at_write');
    var _meta = getLevelMeta(id); var _isCore = _meta && _meta.type === 'core'; var _nextCore = null; if (_isCore) { _nextCore = getNextCoreLevel(id); }
    if (_nextCore && State.levels[_nextCore]) { State.levels[_nextCore].unlocked = true; if (_first) State.currentLevel = _nextCore; }
    this._r4fire('after_next_unlock');
    if (typeof _refreshUnlockedFlags === 'function') _refreshUnlockedFlags();
    var rc = false; if (lvl.achievement && State.achievements.indexOf(lvl.achievement) < 0) { State.achievements.push(lvl.achievement); rc = true; }
    // 阶段 B 仅做权威内存写入 + State.save + 提交钩子；完成侧作用（clearDraft /
    // learningLog / artifact / starBurst）已统一移至 completion_transaction.js 的
    // runPostCommitSideEffects，仅在 commitPointReached 之后执行，故此处不再执行，
    // 以避免「阶段 B 回滚后侧作用仍残留」的缺陷。
    var _payload = { decisions: JSON.parse(JSON.stringify(Level.builderState || {})), testResults: {} };
    if (id === 'w6_9' && typeof Sim !== 'undefined' && Sim.state) { _payload.testResults = { scenarioResults: JSON.parse(JSON.stringify(Sim.state.passed || {})), configSnapshot: JSON.parse(JSON.stringify(Sim.state.configSnapshot || {})), revision: Sim.state.configRevision || 0, finalPassedAt: Sim.state.finalPassedAt || null }; }
    if (id === 'w7_7' && typeof WfSim !== 'undefined' && WfSim.state) { _payload.testResults = { scenarioResults: JSON.parse(JSON.stringify(WfSim.state.passed || {})), configSnapshot: JSON.parse(JSON.stringify(WfSim.state.configSnapshot || {})), revision: WfSim.state.configRevision || 0, finalPassedAt: WfSim.state.finalPassedAt || null }; }
    this._r4fire('before_save');
    try {
      var _sv = State.save();
      if (_sv === false) throw new Error('State.save returned false');
    } catch (e) {
      this._completing = false;
      throw e;
    }
    this._r4fire('after_save');
    this._completing = false;
    // 返回 meta（含 _payload 供提交点之后 runPostCommitSideEffects 使用）；不在此执行侧作用。
    return { id: id, lvl: lvl, _isCore: _isCore, _nextCore: _nextCore, _first: _first, stars: stars, _old: _old, _payload: _payload };
  },
  _showCompletion: function (meta) {
    if (!meta) return;
    var id = meta.id, lvl = meta.lvl, _isCore = meta._isCore, _nextCore = meta._nextCore, _first = meta._first, stars = meta.stars, _old = meta._old;
    var self = this;
    try {
      this._r4fire('during_toast');
      Game.toast(_first ? ('+' + lvl.xp + ' XP · ' + stars + '⭐') : (stars > _old ? ('刷新纪录 ' + stars + '⭐ · XP不重复计') : '已通关过 · 不重复计分'));
    } catch (e) {
      if (typeof CompletionTransaction !== 'undefined' && CompletionTransaction.markPostCommitError) CompletionTransaction.markPostCommitError(id, e);
      return;
    }
    setTimeout(function () {
      try {
        self._r4fire('during_completion_ui');
        self._completing = false;
        if (lvl.boss && lvl.achievement) { Cert.show(lvl.achievement, _nextCore); if (typeof CompletionTransaction !== 'undefined' && CompletionTransaction.finish) CompletionTransaction.finish(id); return; }
        if (_isCore && _nextCore && _realUnlocked(_nextCore)) {
          State.currentLevel = _nextCore; State.save(); WorldMap.refresh(); Game.startLevel(_nextCore);
        } else { WorldMap.refresh(); Game.backToMap(); }
        if (typeof CompletionTransaction !== 'undefined' && CompletionTransaction.finish) CompletionTransaction.finish(id);
      } catch (e) {
        if (typeof CompletionTransaction !== 'undefined' && CompletionTransaction.markPostCommitError) CompletionTransaction.markPostCommitError(id, e);
      }
    }, 1400);
  },
  done: function () { var m = this._commitCompletion(this.current); if (m) this._showCompletion(m); }
"""


def refactor_engine_done(html):
    """将引擎 Level.done(){...} 重排为 _commitCompletion / _showCompletion / done。"""
    marker = "done(){if(this._completing)return;this._completing=true;"
    m = html.find(marker)
    if m < 0:
        raise RuntimeError("未在 HTML 中找到原始引擎 done(){...} 标记，无法重排")
    # 定位 done() 的起始 '{'（即 marker 中的 '{'）
    brace = html.index("{", m)
    depth = 0
    i = brace
    n = len(html)
    while i < n:
        c = html[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i  # 方法级闭合 '}'
                break
        i += 1
    else:
        raise RuntimeError("括号匹配失败，无法定位 done() 结束位置")
    # html[m : end+1] 即原 done 方法；替换为重排块
    return html[:m] + REFACTOR_BLOCK + html[end + 1 :]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    in_sha = sha256_file(INPUT)

    with open(FEATURES, "r", encoding="utf-8") as f:
        feat = f.read()
    with open(INPUT, "r", encoding="utf-8") as f:
        html = f.read()

    # 1) 重排引擎 done
    html = refactor_engine_done(html)

    # 2) 注入 completion_transaction.js（与 round2/round3 一致的注入位置）
    script_block = "\n<script>\n" + feat + "\n</script>\n"
    idx = html.rfind("</body>")
    if idx >= 0:
        html2 = html[:idx] + script_block + html[idx:]
    else:
        idx2 = html.rfind("</html>")
        if idx2 >= 0:
            html2 = html[:idx2] + script_block + html[idx2:]
        else:
            html2 = html + script_block
            idx = len(html)

    fx_hash = fixture_manifest_hash()
    prov = "<!-- Round4-P0 build: input=%s; injectionPos=%d; fixtures=%s -->\n" % (in_sha, idx, fx_hash)
    html2 = prov + html2

    with open(out, "w", encoding="utf-8") as f:
        f.write(html2)
    out_sha = sha256_file(out)

    try:
        with open(MANIFEST, "w", encoding="utf-8") as f:
            f.write("round3_input_sha256: %s\n" % in_sha)
            f.write("round4_output_sha256: %s\n" % out_sha)
            f.write("injection_position: %d\n" % idx)
            f.write("fixture_manifest_sha256: %s\n" % fx_hash)
            f.write("output_file: %s\n" % os.path.basename(out))
    except Exception as e:
        print("[WARN] manifest 写入失败: %s" % e)

    print("wrote", out, "( %d chars )" % len(html2))
    print("round3_input_sha256  =", in_sha)
    print("round4_output_sha256 =", out_sha)
    print("injection_position    =", idx)
    print("fixture_manifest_sha256 =", fx_hash)
    return 0


if __name__ == "__main__":
    sys.exit(main())
