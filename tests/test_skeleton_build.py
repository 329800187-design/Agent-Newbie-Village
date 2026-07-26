# -*- coding: utf-8 -*-
"""tests/test_skeleton_build.py — 骨架构建端到端测试
断言: --skeleton 退出码 0 / 骨架 ZIP 生成 / 报告含素材状态计数 / ZIP 内容合规
用法: python tests/test_skeleton_build.py
"""
import json
import subprocess
import sys
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
ZIP = BASE / "Agent新手村_v1.0_骨架预览版.zip"

P, F = 0, 0
def check(cond, msg):
    global P, F
    print(f"  {'[PASS]' if cond else '[FAIL]'} {msg}")
    if cond: P += 1
    else: F += 1

r = subprocess.run([sys.executable, str(BASE / "build_release.py"), "--skeleton"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace",
                   cwd=str(BASE), timeout=900)
check(r.returncode == 0, f"--skeleton 退出码 0 (实际 {r.returncode})")
out = r.stdout or ""
check("骨架构建成功" in out, "报告宣布骨架构建成功")
check("正式发布" not in out.replace("非正式发布", ""), "报告未错误宣布正式发布")
for kw in ["final=", "placeholder=", "candidate="]:
    check(kw in out, f"报告含 {kw} 计数")
check(ZIP.exists() and ZIP.stat().st_size > 0, f"骨架 ZIP 存在且非零 ({ZIP.stat().st_size if ZIP.exists() else 0:,}B)")

# ZIP 内容合规
mf = json.loads((BASE / "assets" / "asset_manifest.json").read_text(encoding="utf-8"))
allow = set(mf["zipPolicy"]["skeleton"])
status_by_path = {a["path"]: a["status"] for a in mf["assets"]}
required_paths = {a["path"] for a in mf["assets"] if a["required"]}
with zipfile.ZipFile(ZIP) as zf:
    names = set(zf.namelist())
    check("Agent新手村.html" in names, "ZIP 含 Agent新手村.html")
    for extra in ["README_使用说明.txt", "CHANGELOG_v1.0.txt", "assets/asset_manifest.json", "checksums_internal.sha256"]:
        check(extra in names, f"ZIP 含 {extra}")
    asset_names = {n for n in names if n.startswith("assets/") and n.endswith(".png")}
    bad_status = [n for n in asset_names if status_by_path.get(n) not in allow]
    check(len(bad_status) == 0, f"ZIP 内素材全部为 final/placeholder (违规: {bad_status[:5] or '无'})")
    miss_req = sorted(required_paths - names)
    check(len(miss_req) == 0, f"required 资源全部入包 (缺: {miss_req[:5] or '无'})")
    cand_in = [n for n in names if "assets_candidates" in n or "J02_" in n]
    check(len(cand_in) == 0, f"候选素材未混入 ({cand_in[:5] or '无'})")
    # 发布候选内容: TEST_MODE=false
    html = zf.read("Agent新手村.html").decode("utf-8")
    check("var TEST_MODE=false;" in html, "包内 HTML TEST_MODE=false")
    check("骨架预览版" in zf.read("README_使用说明.txt").decode("utf-8"), "包内 README 声明骨架预览版")
    # checksums_internal 覆盖并正确
    import hashlib
    lines = zf.read("checksums_internal.sha256").decode("utf-8").strip().split("\n")
    listed = {ln.split("  ", 1)[1]: ln.split("  ", 1)[0] for ln in lines}
    sample_ok = True
    for n in ["Agent新手村.html", "README_使用说明.txt", "assets/asset_manifest.json"]:
        if hashlib.sha256(zf.read(n)).hexdigest() != listed.get(n):
            sample_ok = False
    check(sample_ok, "checksums_internal.sha256 抽样校验一致")
    check(set(listed.keys()) == names - {"checksums_internal.sha256"}, "checksums_internal 覆盖 ZIP 内全部其他文件")

print(f"\n== test_skeleton_build: {P} pass / {F} fail — {'ALL PASS' if F == 0 else str(F) + ' FAILED'} ==")
sys.exit(0 if F == 0 else 1)
