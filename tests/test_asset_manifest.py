# -*- coding: utf-8 -*-
"""tests/test_asset_manifest.py — 资源清单结构与全量校验
用法: python tests/test_asset_manifest.py
"""
import json
import os
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import build_release as br  # noqa: E402

P, F = 0, 0
def check(cond, msg):
    global P, F
    tag = "[PASS]" if cond else "[FAIL]"
    print(f"  {tag} {msg}")
    if cond: P += 1
    else: F += 1

mf_path = BASE / "assets" / "asset_manifest.json"
check(mf_path.exists(), "assets/asset_manifest.json 存在")
mf = json.loads(mf_path.read_text(encoding="utf-8"))
assets = mf["assets"]

# 1. 结构
check(mf["statusEnum"] == ["final", "placeholder", "candidate", "deprecated"], "statusEnum 四值")
check(set(mf["zipPolicy"]["skeleton"]) == {"final", "placeholder"}, "zipPolicy.skeleton = final+placeholder")
check(set(mf["zipPolicy"]["release"]) == {"final"}, "zipPolicy.release = final")
need_keys = {"path", "role", "status", "required", "world", "levelId", "expectedAspect"}
bad_keys = [a["path"] for a in assets if not need_keys.issubset(a.keys())]
check(len(bad_keys) == 0, f"每条含必备字段 (缺字段: {bad_keys[:3] or '无'})")
check(all(a["status"] in mf["statusEnum"] for a in assets), "status 全部合法")

# 2. 覆盖范围: brief 第六节点名的全部资源类别
roles_dirs = ["splash", "onboard", "peipei", "kuro", "nodes", "done", "bg", "boss", "cert", "ui"]
for d in roles_dirs:
    n = sum(1 for a in assets if a["path"].startswith(f"assets/{d}/"))
    check(n > 0, f"覆盖 assets/{d}/ ({n} 条)")

# 3. K01-K03 / J02 专项
for k in ["K01", "K02", "K03"]:
    e = next((a for a in assets if a["path"] == f"assets/onboard/{k}.png"), None)
    check(e is not None and e["required"] and e["status"] == "placeholder", f"{k}: required + placeholder")
j02 = next((a for a in assets if a["path"] == "assets/splash/J02.png"), None)
check(j02 is not None and j02["status"] == "final", "J02.png 唯一规范文件 status=final")
check(not (BASE / "assets" / "splash" / "J02_1.png").exists(), "J02_1 已移出 assets/splash/")
cand_dir = BASE / "assets_candidates" / "splash"
n_cand = len(list(cand_dir.glob("J02_*.png"))) if cand_dir.exists() else 0
check(n_cand == 6, f"assets_candidates/splash/ 含 6 个 J02 候选 ({n_cand})")
listed_j02x = [a["path"] for a in assets if "J02_" in a["path"]]
check(len(listed_j02x) == 0, f"manifest 不含 J02_x 候选 ({listed_j02x or '无'})")

# 4. 全量交叉校验 (走 build_release 的权威校验逻辑, SystemExit=失败)
text_n = (BASE / "Agent新手村_当前版.html").read_text(encoding="utf-8").replace("\r\n", "\n")
try:
    data = br.node_extract_data(text_n)
    br.verify_manifest(text_n, data["dynamicRefs"])
    check(True, "build_release.verify_manifest 全量校验通过 (存在/非零/大小写/解码/宽高/重复/漏项)")
except SystemExit:
    check(False, "build_release.verify_manifest 全量校验失败")

# 5. 课程数据哈希与基线一致
baseline = json.loads((BASE / "_leveldata_hash_baseline.json").read_text(encoding="utf-8"))
check(data["curriculumHash"] == baseline["leveldata_worlds_sha256"],
      f"课程数据哈希与基线一致 ({data['curriculumHash'][:16]}...)")

print(f"\n== test_asset_manifest: {P} pass / {F} fail — {'ALL PASS' if F == 0 else str(F) + ' FAILED'} ==")
sys.exit(0 if F == 0 else 1)
