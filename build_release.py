#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Agent新手村 构建脚本 v5 — 两级构建闸门（骨架 / 正式发布）

用法:
    python build_release.py --skeleton   骨架构建 → Agent新手村_v1.0_骨架预览版.zip
    python build_release.py --release    正式发布构建 → Agent新手村_v1.0.zip
                                         (placeholder=0 且 candidate=0 才允许)

原则:
- 以 Agent新手村_当前版.html 为唯一权威源；只校验+生成，不修改任何课程/引擎代码。
- 相对路径: BASE_DIR = 脚本所在目录，可在任意目录复跑。
- 任何 check() 失败 → 退出非零。没有 WARN 降级。
- 资源以 assets/asset_manifest.json 为唯一权威清单，不再用正则猜测路径。
- ZIP 确定性: 条目排序 + 固定时间戳 → 两轮构建哈希一致。
"""
import os
import re
import sys
import json
import shutil
import hashlib
import zipfile
import subprocess
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SRC_FILE = "Agent新手村_当前版.html"
DEV_FILE = "Agent新手村_开发测试版.html"
REL_FILE = "Agent新手村_v1.0_发布候选版.html"
MANIFEST_FILE = BASE_DIR / "assets" / "asset_manifest.json"
SKELETON_ZIP = "Agent新手村_v1.0_骨架预览版.zip"
RELEASE_ZIP = "Agent新手村_v1.0.zip"
ZIP_DATE = (2026, 1, 1, 0, 0, 0)  # 固定时间戳保证 ZIP 幂等

VALID_STATUS = {"final", "placeholder", "candidate", "deprecated"}


def usage():
    print(__doc__)
    sys.exit(2)


if "--release" in sys.argv:
    MODE = "release"
elif "--skeleton" in sys.argv:
    MODE = "skeleton"
else:
    print("[提示] 未指定构建模式。当前阶段只允许骨架构建，默认 --skeleton。")
    MODE = "skeleton"


def fail(msg):
    print(f"\n[FAIL] {msg}")
    sys.exit(1)


def ok(msg):
    print(f"  [OK] {msg}")


def check(cond, msg):
    """任何模式下失败都必须退出非零（brief 第八节）。"""
    if not cond:
        fail(msg)
    ok(msg)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


# ═══════════════════ Node 数据提取 ═══════════════════

def node_extract_data(text_n):
    """Node VM 提取 LevelData/WORLDS 统计 + 课程数据哈希 + 运行时资源引用全集。"""
    m = re.search(r"<script>(.*?)</script>", text_n, re.DOTALL)
    if not m:
        fail("未找到 <script> 块")
    js_block = m.group(1)
    game_pos = js_block.find("var Game={")
    if game_pos < 0:
        fail("未找到 var Game={ 分界点")
    data_block = js_block[:game_pos]

    tmpdir = Path(tempfile.gettempdir())
    game_js = tmpdir / "_av_data_v5.js"
    extract_js = tmpdir / "_av_extract_v5.js"
    game_js.write_text(data_block, encoding="utf-8")

    extractor = (
        "const fs=require('fs');const vm=require('vm');const crypto=require('crypto');\n"
        "const src=fs.readFileSync(" + json.dumps(str(game_js)) + ",'utf-8');\n"
        "const ctx={document:{getElementById:()=>null,createElement:()=>({style:{},classList:{add:()=>{}},addEventListener:()=>{},appendChild:()=>{}}),body:{appendChild:()=>{}},querySelectorAll:()=>[],addEventListener:()=>{}},\n"
        "localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},location:{reload:()=>{}},setTimeout:()=>{},setInterval:()=>{},clearTimeout:()=>{},console:{log:()=>{},warn:()=>{},error:()=>{}}};\n"
        "vm.createContext(ctx);try{vm.runInContext(src,ctx);}catch(e){}\n"
        "const LD=ctx.LevelData||{};const W=ctx.WORLDS||{};\n"
        "const vals=Object.values(LD).filter(x=>x&&typeof x==='object');\n"
        "const levels=[];for(const[id,lv]of Object.entries(LD)){levels.push({id,world:lv.world,a:lv.a,boss:!!lv.boss,type:lv.type,optional:!!lv.optional});}\n"
        "const refs=new Set();\n"
        "for(const lv of levels){if(lv.a){refs.add('assets/nodes/C'+lv.a+'.png');refs.add('assets/done/G'+lv.a+'.png');}}\n"
        "for(const wk of Object.keys(W)){const w=W[wk];refs.add('assets/bg/'+w.bg+'.png');refs.add('assets/boss/'+w.boss+'.png');refs.add('assets/cert/'+w.cert.tag+'.png');}\n"
        "const allLC=levels.filter(l=>{const x=LD[l.id];const flow=x.content&&x.content.flow;return Array.isArray(flow)&&flow.some(s=>s.lessonCycle);}).map(l=>l.id);\n"
        "const payload=JSON.stringify({LevelData:LD,WORLDS:W});\n"
        "console.log(JSON.stringify({total:Object.keys(LD).length,core:vals.filter(x=>x.type==='core').length,\n"
        "optional:vals.filter(x=>x.optional===true).length,worlds:Object.keys(W).length,\n"
        "bossCount:levels.filter(l=>l.boss).length,lessonCycleLevels:allLC,\n"
        "c07Title:LD['w1_2']?LD['w1_2'].title:null,c08Title:LD['w1_3']?LD['w1_3'].title:null,\n"
        "dynamicRefs:[...refs].sort(),curriculumHash:crypto.createHash('sha256').update(payload,'utf-8').digest('hex')}));\n"
    )
    extract_js.write_text(extractor, encoding="utf-8")
    r = subprocess.run(["node", str(extract_js)], capture_output=True, text=True, timeout=60)
    game_js.unlink(missing_ok=True)
    extract_js.unlink(missing_ok=True)
    if r.returncode != 0:
        fail(f"Node提取失败: {r.stderr.strip()[-300:]}")
    try:
        return json.loads(r.stdout.strip())
    except json.JSONDecodeError:
        fail(f"Node输出非JSON: {r.stdout[:200]}")


def html_static_refs(text_n):
    """HTML 字面 assets 引用 + Onboard._illu 动态 K 图。"""
    refs = set()
    for mm in re.finditer(r"assets/[A-Za-z0-9_/.]+\.png", text_n):
        refs.add(mm.group(0))
    if "_illu(tag){return slot('assets/onboard/'+tag+'.png'" in text_n:
        for k in ("K01", "K02", "K03"):
            if f"_illu('{k}')" in text_n:
                refs.add(f"assets/onboard/{k}.png")
    # 排除模板注释里的通配样例（assets/nodes/C 等不带编号的半路径已被正则的 .png 后缀过滤）
    return refs


# ═══════════════════ manifest 校验 ═══════════════════

def png_size(path):
    """纯 stdlib 读 PNG 宽高（IHDR）。"""
    with open(path, "rb") as f:
        head = f.read(26)
    if len(head) < 26 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    w = int.from_bytes(head[16:20], "big")
    h = int.from_bytes(head[20:24], "big")
    return (w, h)


def decode_check(path):
    """图片可解码校验：优先 PIL 完整解码，缺 PIL 时退回 PNG 结构校验。"""
    try:
        from PIL import Image
    except ImportError:
        return png_size(path) is not None
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            im.load()
        return True
    except Exception:
        return False


def parse_aspect(s):
    if not s:
        return None
    m = re.match(r"^(\d+):(\d+)$", s)
    if m:
        return int(m.group(1)) / int(m.group(2))
    m = re.match(r"^free\(([\d.]+)\)$", s)
    if m:
        return float(m.group(1))
    return None


def verify_manifest(text_n, dynamic_refs):
    print("\n  --- 资源清单校验 (assets/asset_manifest.json) ---")
    check(MANIFEST_FILE.exists(), "asset_manifest.json 存在")
    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    assets = manifest.get("assets", [])
    check(len(assets) > 0, f"manifest 条目非空 ({len(assets)} 条)")

    # 1. path 无重复
    paths = [a["path"] for a in assets]
    dupes = {p for p in paths if paths.count(p) > 1}
    check(len(dupes) == 0, f"manifest 无重复 path (重复: {sorted(dupes) if dupes else '无'})")

    # 2. status 枚举合法
    bad_status = [a["path"] for a in assets if a.get("status") not in VALID_STATUS]
    check(len(bad_status) == 0, f"status 枚举合法 (非法: {bad_status[:5] if bad_status else '无'})")

    # 3. 大小写精确比对表（Windows 文件系统大小写不敏感，必须列目录核对）
    disk_exact = set()
    assets_dir = BASE_DIR / "assets"
    for root, dirs, files in os.walk(assets_dir):
        for fn in files:
            rel = os.path.relpath(os.path.join(root, fn), BASE_DIR).replace("\\", "/")
            disk_exact.add(rel)

    # 4. required 文件: 存在 / 非零 / 大小写 / 可解码 / 宽高比
    missing, zero, case_err, decode_err, aspect_err = [], [], [], [], []
    tol = float(manifest.get("aspectTolerance", 0.05))
    for a in assets:
        rel = a["path"]
        fp = BASE_DIR / rel
        required = a.get("required", False)
        status = a.get("status")
        if not fp.exists():
            if required:
                missing.append(rel)
            continue
        if rel not in disk_exact:
            case_err.append(rel)
        if required or status in ("final", "placeholder"):
            if fp.stat().st_size == 0:
                zero.append(rel)
                continue
            if not decode_check(fp):
                decode_err.append(rel)
                continue
            exp = parse_aspect(a.get("expectedAspect", ""))
            size = png_size(fp)
            if exp and size:
                w, h = size
                if h == 0 or abs((w / h) - exp) / exp > tol:
                    aspect_err.append(f"{rel} (期望 {a['expectedAspect']}, 实际 {w}x{h})")

    check(len(missing) == 0, f"required 资源全部存在 (缺失 {len(missing)}: {missing[:5] if missing else '无'})")
    check(len(zero) == 0, f"零字节资源=0 (违规: {zero[:5] if zero else '无'})")
    check(len(case_err) == 0, f"路径大小写完全一致 (违规: {case_err[:5] if case_err else '无'})")
    check(len(decode_err) == 0, f"图片全部可解码 (违规: {decode_err[:5] if decode_err else '无'})")
    check(len(aspect_err) == 0, f"宽高符合类型要求 (违规: {aspect_err[:3] if aspect_err else '无'})")

    # 5. HTML/引擎实际引用 ⊆ manifest
    runtime_refs = html_static_refs(text_n) | set(dynamic_refs)
    manifest_paths = set(paths)
    unlisted = sorted(runtime_refs - manifest_paths)
    check(len(unlisted) == 0, f"运行时引用全部收录于 manifest (漏项 {len(unlisted)}: {unlisted[:5] if unlisted else '无'})")

    # 6. manifest required 与运行时引用一致性（manifest 不虚标 required）
    manifest_required = {a["path"] for a in assets if a.get("required")}
    over_required = sorted(manifest_required - runtime_refs)
    check(len(over_required) == 0, f"manifest required 均为真实运行时引用 (虚标: {over_required[:5] if over_required else '无'})")

    from collections import Counter
    cnt = Counter(a["status"] for a in assets)
    print(f"  [统计] final={cnt.get('final',0)} placeholder={cnt.get('placeholder',0)} "
          f"candidate={cnt.get('candidate',0)} deprecated={cnt.get('deprecated',0)} / required={len(manifest_required)}")
    return manifest, cnt


# ═══════════════════ ZIP 打包（确定性） ═══════════════════

def build_zip(zip_path, file_pairs):
    """file_pairs: [(绝对路径 或 bytes, zip内路径)]; 排序 + 固定时间戳 + 流式写入 → 幂等且低内存。"""
    tmp = str(zip_path) + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for src, arc in sorted(file_pairs, key=lambda x: x[1]):
            zi = zipfile.ZipInfo(arc, date_time=ZIP_DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            zi.create_system = 0
            if isinstance(src, bytes):
                zf.writestr(zi, src)
            else:
                with zf.open(zi, "w") as dst, open(src, "rb") as s:
                    shutil.copyfileobj(s, dst, 1 << 16)
    shutil.move(tmp, zip_path)
    return sha256_file(zip_path)


# ═══════════════════ 主流程 ═══════════════════

def main():
    print("=" * 62)
    print(f"Agent新手村 构建脚本 v5 [{'骨架构建 --skeleton' if MODE == 'skeleton' else '正式发布构建 --release'}]")
    print(f"BASE_DIR = {BASE_DIR}")
    print("=" * 62)

    src_path = BASE_DIR / SRC_FILE
    if not src_path.exists():
        fail(f"权威源不存在: {src_path}")
    text = src_path.read_text(encoding="utf-8")
    text_n = text.replace("\r\n", "\n")
    print(f"\n[0] 权威源: {SRC_FILE} ({len(text.encode('utf-8')):,}B)")

    # ── 1. 源标记 ──
    TM_DECL = r"var TEST_MODE\s*=\s*(?:true|false)\s*;"
    decls = re.findall(TM_DECL, text_n)
    check(len(decls) == 1, f"var TEST_MODE 声明唯一命中 ({len(decls)})")
    # R1.1 门禁：当前版 TEST_MODE 必须为 false
    check("false" in decls[0], "权威源 TEST_MODE=false (硬门禁: true 时构建退出非零)")
    check(re.search(r"BUILD_TAG\s*[:=]\s*['\"]当前版['\"]", text_n) is not None, "BUILD_TAG='当前版'")

    # ── 2. node --check ──
    m = re.search(r"<script>(.*?)</script>", text_n, re.DOTALL)
    if not m:
        fail("未找到 <script> 块")
    js_path = Path(tempfile.gettempdir()) / "_av_build_v5.js"
    js_path.write_text(m.group(1), encoding="utf-8")
    r = subprocess.run(["node", "--check", str(js_path)], capture_output=True, text=True, timeout=30)
    check(r.returncode == 0, f"node --check: {'PASS' if r.returncode == 0 else r.stderr.strip()[:200]}")
    js_path.unlink(missing_ok=True)

    # ── 3. 课程结构（冻结核心） ──
    data = node_extract_data(text_n)
    check(data["total"] == 74, f"LevelData 74 关 ({data['total']})")
    check(data["core"] == 70, f"core 70 ({data['core']})")
    check(data["optional"] == 4, f"optional 4 ({data['optional']})")
    check(data["worlds"] == 8, f"WORLDS 8 世界 ({data['worlds']})")
    check(data["bossCount"] == 8, f"boss 8 ({data['bossCount']})")
    check(len(data["lessonCycleLevels"]) == 2, f"lessonCycle 仅 C07/C08 试点 ({data['lessonCycleLevels']})")
    check(data["c07Title"] == "看看周围", f"C07 标题 ({data['c07Title']})")
    check(data["c08Title"] == "去别的地方", f"C08 标题 ({data['c08Title']})")
    print(f"  [课程哈希] {data['curriculumHash']}")

    # ── 4. 关键函数 / 引擎对象 ──
    for fn in ["isLevelUnlocked", "_realUnlocked", "getWorldCoreLevels",
               "getNextCoreLevel", "isWorldComplete", "getLockedReason",
               "_checkFlowGate", "finalPassedAt", "buildFinalRecord",
               "defaultLearnerProfile", "normalizeLearnerProfile",
               "recommendLearningTrack", "computeAssessmentScores",
               "_trackTrialUnlockOk", "migrateSaveData", "hasAnyLevelProgress",
               "resetLevelScroll", "lcProbe", "lcReinforce"]:
        check(fn in text_n, f"关键函数 {fn}")
    for obj in ["Sim={", "WfSim={", "LearningTracks={", "Onboard={",
                "TrackPanel={", "TrackUI={", "AssessmentQuestions=[",
                "lessonCycle:{probe:"]:
        check(obj in text_n, f"引擎对象 {obj}")

    # ── 5. 阶段一 / P1 冻结项 ──
    check("SCHEMA_VERSION=3" in text_n, "SCHEMA_VERSION=3")
    check("if(typeof TEST_MODE!=='undefined'&&TEST_MODE){\nTestPanel={" in text_n, "TestPanel 在 TEST_MODE 守卫内")
    check("skip(){if(typeof TEST_MODE==='undefined'||!TEST_MODE)" in text_n, "Level.skip TEST_MODE 守卫")
    check("d.role='learner';" in text_n, "normalizeLearnerProfile 强制 role")
    check("var WORLD_TRIALS_ENABLED=false;" in text_n, "WORLD_TRIALS_ENABLED=false")
    check("_trackTrialUnlockOk(id){if(!WORLD_TRIALS_ENABLED)return false;" in text_n, "_trackTrialUnlockOk 入口闸门")
    check("_completing" in text_n, "_completing 防重复")
    check("goNext(id)" in text_n and "backMap()" in text_n, "Cert.goNext/backMap")
    check('class="opts lc-probe-opts"' in text_n, "lc-probe-opts")
    check(".opt.selected{background:var(--c-current)" in text_n, ".opt.selected CSS")

    # ── 6. 第五轮新增冻结项 ──
    check("var WorkflowTemplates={" in text_n, "WorkflowTemplates 存在")
    check("var Artifact={" in text_n, "Artifact 存在")
    check("var Export={" in text_n, "Export 存在")
    check("var LearningLog={" in text_n, "LearningLog 存在")
    check("var LevelValidator={" in text_n, "LevelValidator 存在")
    # R1.1: Artifact.saveLevel 替代 saveAll
    check("Artifact.saveLevel" in text_n, "Artifact.saveLevel 存在")
    check("Artifact.saveAll();State.save()" not in text_n, "done() 不再调用 Artifact.saveAll")
    check("LearningLog.clear()" in text_n, "设置页含学习记录清除")
    check("completionGate" in text_n, "_checkFlowGate 支持 completionGate")
    # P0-03: 禁止 masteryRequired 布尔值
    check("masteryRequired:true" not in text_n, "无 masteryRequired:true 布尔值")
    check("masteryRequired:[{levelId:" in text_n, "masteryRequired 为数组格式")
    check("{ai_camp:1,w1:2,w2:3}" not in text_n, "InfoCard 无 Boss 标签硬编码")
    check("slot(BOSS_ASSET[lvl.world],WORLDS[lvl.world].boss)" in text_n, "Boss 标签统一读 WORLDS[world].boss")
    check("pickMode(m){if(m==='youth'){Game.toast(" in text_n, "青少模式 pickMode 守卫")
    check("ob-card ob-card-disabled" in text_n, "青少卡禁用样式")
    check("即将开放" in text_n, "青少「即将开放」文案")
    check("if(tid==='foundation'){Game.toast(" in text_n, "confirmTrack foundation 守卫")
    check("tid='beginner';/* 骨架期硬约束" in text_n, "confirmTrack 只进入 beginner")
    check("p.ageMode=(s.mode==='youth')?'standard':s.mode" in text_n, "ageMode 不写入 youth")
    check("if(to==='foundation'){Game.toast(" in text_n, "switchTrack foundation 守卫")
    check("世界试炼开发中" in text_n, "「世界试炼开发中」口径")
    check("世界试炼即将开放" not in text_n, "无旧口径残留")
    for k in ("K01", "K02", "K03"):
        check(f"_illu('{k}')" in text_n, f"入村插画接口 {k}")
    check("ageMode:'standard'" in text_n, "ageMode schema 字段保留")
    check("unlockedByAssessment" in text_n and "passedWorldTrials" in text_n, "试炼预留字段保留")

    # ── 7. 假功能守卫 ──
    check('<input type="checkbox" checked> 动画效果' not in text_n, "无动画假开关")
    check("重置全部进度" in text_n, "设置页重置按钮保留")
    check(len(re.findall(r'https?://[^\s"\'<>]+\.(?:js|css|woff2?|ttf)', text_n)) == 0, "无外部CDN依赖")

    # ── 8. 资源清单校验 ──
    manifest, status_cnt = verify_manifest(text_n, data["dynamicRefs"])

    # ── 9. 发布闸门 ──
    print(f"\n  --- {'骨架' if MODE == 'skeleton' else '正式发布'}闸门 ---")
    n_ph = status_cnt.get("placeholder", 0)
    n_cd = status_cnt.get("candidate", 0)
    if MODE == "release":
        check(n_ph == 0, f"release 闸门: placeholder 必须为 0 (当前 {n_ph})")
        check(n_cd == 0, f"release 闸门: candidate 必须为 0 (当前 {n_cd})")
    else:
        ok(f"skeleton 闸门: 允许 placeholder ({n_ph} 个), candidate 不进用户包 ({n_cd} 个)")

    # ── 10. 生成三版本 ──
    # R1.1 口径:
    #   当前版 TEST_MODE=false (权威源)
    #   开发测试版 TEST_MODE=true
    #   发布候选版 TEST_MODE=false
    dev_text = text_n.replace("BUILD_TAG='当前版'", "BUILD_TAG='开发测试版'")
    dev_text, dev_tm_count = re.subn(TM_DECL, "var TEST_MODE=true;", dev_text)
    check(dev_tm_count == 1, f"开发版 TEST_MODE 声明替换唯一命中 ({dev_tm_count})")
    check("var TEST_MODE=true;" in dev_text, "开发版 TEST_MODE=true")

    rel_text = text_n.replace("BUILD_TAG='当前版'", "BUILD_TAG='发布候选版'")
    # 发布候选版 TEST_MODE 保持 false (当前版已是 false)

    def norm(s):
        s, c = re.subn(TM_DECL, "var TM;", s)
        if c < 1:
            fail(f"归一化 TEST_MODE 命中 {c} 处")
        for tag in ("当前版", "开发测试版", "发布候选版"):
            s = s.replace(f"BUILD_TAG='{tag}'", "BT")
        return s

    check(norm(text_n) == norm(dev_text), "当前版 vs 开发测试版 归一化一致")
    check(norm(text_n) == norm(rel_text), "当前版 vs 发布候选版 归一化一致")

    # ── 6.5 R1.1 新增工程收口校验 ──
    check("interactionId:'scenario_normal'" in text_n, "W6 scenarios 含 interactionId")
    check("interactionId:'scenario_high_amount'" in text_n, "W7 scenarios 含 interactionId")
    check("builderIndex" in text_n, "builderIndex 替代 bsIdx")
    check("bsIdx" not in text_n, "bsIdx 已彻底移除")
    check("markInteractionPassed('agent_builder'" in text_n or "markInteractionPassed(interactionId,true)" in text_n, "显式 markInteractionPassed agent_builder")
    check("this._interactionId='workflow_builder'" in text_n, "WfSim.init workflow_builder")
    check("agent_village_artifacts" in text_n, "reset 含 agent_village_artifacts")
    check("agent_village_learning_log" in text_n, "reset 含 agent_village_learning_log")
    # W6 Boss 答案泄露检测
    w6_seg = text_n[text_n.find("'w6_9':{"):text_n.find("'w7_1':{", text_n.find("'w6_9':{"))]
    check("✓" not in w6_seg and "✗" not in w6_seg and "△" not in w6_seg, "W6 Boss 无答案符号泄露")
    # 设置页三按钮
    check("查看学习记录" in text_n, "设置页含查看学习记录")
    check("清除学习记录" in text_n, "设置页含清除学习记录")
    check(
        "showReport(){" in text_n or "showReport:function" in text_n,
        "LearningLog.showReport 已实现"
    )

    def atomic_write(path, content):
        tmp = str(path) + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        shutil.move(tmp, path)

    atomic_write(src_path, text_n)
    atomic_write(BASE_DIR / DEV_FILE, dev_text)
    atomic_write(BASE_DIR / REL_FILE, rel_text)

    # ── 11. 用户 ZIP 打包 ──
    zip_status = set(manifest["zipPolicy"]["skeleton" if MODE == "skeleton" else "release"])
    included, excluded = [], []
    for a in manifest["assets"]:
        fp = BASE_DIR / a["path"]
        if a["status"] in zip_status and fp.exists():
            included.append((str(fp), a["path"]))
        else:
            excluded.append(a["path"])

    readme = BASE_DIR / "README_使用说明.txt"
    changelog = BASE_DIR / "CHANGELOG_v1.0.txt"
    check(readme.exists(), "README_使用说明.txt 存在")
    check(changelog.exists(), "CHANGELOG_v1.0.txt 存在")
    if MODE == "skeleton":
        check("骨架预览版" in readme.read_text(encoding="utf-8"), "README 已声明骨架预览版")

    pairs = [(str(readme), "README_使用说明.txt"),
             (str(changelog), "CHANGELOG_v1.0.txt"),
             (str(MANIFEST_FILE), "assets/asset_manifest.json")]
    pairs += included
    pairs.append((rel_text.encode("utf-8"), "Agent新手村.html"))

    # 内部校验文件 checksums_internal.sha256（对 ZIP 内文件的解压后校验）
    internal_lines = []
    for src, arc in sorted(pairs, key=lambda x: x[1]):
        data_b = src if isinstance(src, bytes) else Path(src).read_bytes()
        internal_lines.append(f"{hashlib.sha256(data_b).hexdigest()}  {arc}")
    internal_txt = "\n".join(internal_lines) + "\n"
    pairs.append((internal_txt.encode("utf-8"), "checksums_internal.sha256"))

    zip_name = SKELETON_ZIP if MODE == "skeleton" else RELEASE_ZIP
    zip_path = BASE_DIR / zip_name
    zip_sha = build_zip(zip_path, pairs)
    ok(f"用户包: {zip_name} ({zip_path.stat().st_size:,}B, {len(pairs)} 条目)")
    ok(f"candidate/deprecated 已排除 {len(excluded)} 项不进用户包")

    # ── 12. SHA256 汇总 ──
    print("\n  --- SHA256 ---")
    shas = {}
    for label, p in [("当前版", src_path), ("开发测试版", BASE_DIR / DEV_FILE),
                     ("发布候选版", BASE_DIR / REL_FILE), (zip_name, zip_path)]:
        shas[label] = sha256_file(p)
        print(f"  {label}: {shas[label]}")
    print(f"  课程数据: {data['curriculumHash']}")

    print("\n" + "=" * 62)
    if MODE == "skeleton":
        print("✅ 骨架构建成功 — Agent新手村 v1.0 功能骨架（非正式发布）")
        print(f"  素材: final={status_cnt.get('final',0)} / placeholder={status_cnt.get('placeholder',0)} / "
              f"candidate={status_cnt.get('candidate',0)}(未打包) / deprecated={status_cnt.get('deprecated',0)}(未打包)")
    else:
        print("✅ 正式发布构建成功 — placeholder=0, candidate=0")
    print(f"  关卡: {data['total']} / {data['core']}core / {data['optional']}optional / {data['worlds']}世界")
    print("=" * 62)
    return shas


if __name__ == "__main__":
    main()
