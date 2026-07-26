#!/usr/bin/env python3
"""R1.2-alpha1 独立审阅包 — 一键验证脚本"""
import os, sys, json, hashlib, subprocess, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ERRORS = []

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(65536)
            if not chunk: break
            h.update(chunk)
    return h.hexdigest()

def check(msg, condition):
    if not condition:
        ERRORS.append(f"FAIL: {msg}")
        print(f"  \u274c {msg}")
    else:
        print(f"  \u2705 {msg}")

print("=" * 60)
print("R1.2-alpha1 独立审阅包验证")
print("=" * 60)

# 1. File existence
print("\n1. 文件完整性")
files_to_check = [
    "baseline/R1.1_当前权威版.html",
    "baseline/Agent新手村_R1.2-dev.html",
    "baseline/Agent新手村_R1.2-alpha1.html",
    "baseline/Agent新手村_R1.2-round2-dev.html",
    "scripts/build_release.py",
    "scripts/leveldata_hash.js",
    "validators/_leveldata_hash_baseline.json",
    "validators/R1.1_LevelValidator.json",
    "evidence/R1.2_ALPHA1_SHA256SUMS.txt",
    "evidence/R1.2_ALPHA1_MANIFEST.txt",
    "evidence/R1.2_ALPHA1_SIGNOFF.md",
    "reports/R1.2_VISUAL_REVIEW_ROUND1_FINAL.md",
    "reports/R1.2_VISUAL_ISSUES_ROUND1_FINAL.json",
]
for f in files_to_check:
    exists = (ROOT / f).exists()
    check(f, exists)

# 2. SHA256 consistency
print("\n2. SHA256 校验")
h1 = sha256(ROOT / "baseline/R1.1_当前权威版.html")
h_dev = sha256(ROOT / "baseline/Agent新手村_R1.2-dev.html")
h_alpha = sha256(ROOT / "baseline/Agent新手村_R1.2-alpha1.html")
h_r2 = sha256(ROOT / "baseline/Agent新手村_R1.2-round2-dev.html")
r1_1_expected = "6a5204e5de03db07b43858ed24b0d00c6476d2411f1d9e41a16f8ff63b188b82"

print(f"  R1.1:       {h1}")
print(f"  R1.2-dev:   {h_dev}")
print(f"  Alpha1:     {h_alpha}")
print(f"  Round2-dev: {h_r2}")

check(f"R1.1 SHA256 匹配基线", h1 == r1_1_expected)
check(f"R1.2-dev = Alpha1 逐字节一致", h_dev == h_alpha)
check(f"Alpha1 = Round2-dev 逐字节一致", h_alpha == h_r2)
check(f"R1.1 != R1.2 (未改动)", h1 != h_dev)

# 3. SHA256SUMS file check
print("\n3. SHA256SUMS 文件校验")
sums_file = ROOT / "evidence/R1.2_ALPHA1_SHA256SUMS.txt"
if sums_file.exists():
    content = sums_file.read_text(encoding='utf-8')
    for line in content.split('\n'):
        if 'Agent新手村_R1.2-alpha1.html' in line and not line.startswith('#'):
            recorded_hash = line.strip().split()[0]
            check(f"SHA256SUMS 记录的哈希与文件一致", recorded_hash == h_alpha)
            print(f"  记录: {recorded_hash}")
            break

# 4. LevelData verification
print("\n4. LevelData 验证")
js_script = ROOT / "scripts/leveldata_hash.js"
for label, html_path in [
    ("R1.1", ROOT / "baseline/R1.1_当前权威版.html"),
    ("R1.2-dev", ROOT / "baseline/Agent新手村_R1.2-dev.html"),
    ("Alpha1", ROOT / "baseline/Agent新手村_R1.2-alpha1.html"),
    ("Round2-dev", ROOT / "baseline/Agent新手村_R1.2-round2-dev.html"),
]:
    try:
        result = subprocess.run(
            ["node", str(js_script), str(html_path)],
            capture_output=True, text=True, timeout=30, cwd=str(ROOT)
        )
        data = json.loads(result.stdout)
        expected_hash = "56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895"
        ok = (data['levels'] == 74 and data['core'] == 70 and 
              data['optional'] == 4 and data['worlds'] == 8 and 
              data['leveldata_worlds_sha256'] == expected_hash)
        check(f"{label}: levels={data['levels']} core={data['core']} opt={data['optional']} worlds={data['worlds']} hash=OK", ok)
    except Exception as e:
        ERRORS.append(f"FAIL: {label} hash verification error: {e}")
        print(f"  \u274c {label}: {e}")

# 5. JS syntax (using process.argv for safe path passing)
print("\n5. JavaScript 语法")
for label, html_path in [
    ("R1.1", ROOT / "baseline/R1.1_当前权威版.html"),
    ("Alpha1", ROOT / "baseline/Agent新手村_R1.2-alpha1.html"),
    ("Round2-dev", ROOT / "baseline/Agent新手村_R1.2-round2-dev.html"),
]:
    try:
        js_code = "const fs=require('fs');const h=fs.readFileSync(process.argv[1],'utf8');const m=h.match(/<script>([\\s\\S]*?)<\\/script>/);if(m)new Function(m[1]);else process.exit(1);console.log('OK')"
        result = subprocess.run(
            ["node", "-e", js_code, str(html_path)],
            capture_output=True, text=True, timeout=30, cwd=str(ROOT)
        )
        ok = result.returncode == 0 and 'OK' in result.stdout
        check(f"{label} JS syntax", ok)
        if not ok:
            print(f"    stderr: {result.stderr[:200]}")
    except Exception as e:
        check(f"{label} JS syntax", False)
        print(f"    error: {e}")

# 6. TEST_MODE check
print("\n6. TEST_MODE 检查")
for label, html_path in [
    ("Alpha1", ROOT / "baseline/Agent新手村_R1.2-alpha1.html"),
]:
    try:
        content = html_path.read_text(encoding='utf-8')
        # Look for TEST_MODE assignments - the primary declaration is TEST_MODE=false
        has_false = 'TEST_MODE=false' in content
        # Check that TEST_MODE is not set to true by default
        # The pattern: var TEST_MODE=false;
        test_decl = re.findall(r'var\s+TEST_MODE\s*=\s*(true|false)', content)
        check(f"{label} TEST_MODE 声明为 false", len(test_decl) > 0 and all(v == 'false' for v in test_decl))
        print(f"    TEST_MODE declarations: {test_decl}")
    except Exception as e:
        check(f"{label} TEST_MODE", False)
        print(f"    error: {e}")

# 7. LevelValidator check
print("\n7. LevelValidator 基线")
validator = ROOT / "validators/R1.1_LevelValidator.json"
if validator.exists():
    data = json.loads(validator.read_text(encoding='utf-8'))
    check(f"totalLevels=74", data['summary']['totalLevels'] == 74)
    check(f"coreCount=70", data['summary']['coreCount'] == 70)
    check(f"optionalCount=4", data['summary']['optionalCount'] == 4)
    check(f"worldCount=8", data['summary']['worldCount'] == 8)

# 8. Reports consistency
print("\n8. 审阅报告一致性")
issues_json = ROOT / "reports/R1.2_VISUAL_ISSUES_ROUND1_FINAL.json"
if issues_json.exists():
    data = json.loads(issues_json.read_text(encoding='utf-8'))
    check(f"decision=PASS", data['decision'] == 'PASS')
    check(f"blocking_issues=0", data['blocking_issues'] == 0)
    check(f"fail=0", data['fail'] == 0)
    for issue in data['issues']:
        if issue['id'] == 'ISSUE-R1-001':
            check(f"ISSUE-R1-001 CLOSED_HUMAN_VERIFIED", issue['status'] == 'CLOSED_HUMAN_VERIFIED')
        elif issue['id'] == 'ISSUE-R1-002':
            check(f"ISSUE-R1-002 CLOSED_HUMAN_VERIFIED", issue['status'] == 'CLOSED_HUMAN_VERIFIED')
        elif issue['id'] == 'ISSUE-R1-003':
            check(f"ISSUE-R1-003 DEFERRED_PLANNED", issue['status'] == 'DEFERRED_PLANNED')

# 9. Binary identical check (cmp)
print("\n9. 逐字节二进制比较")
import subprocess as _sp
for a_name, b_name in [
    ("R1.2-dev vs Alpha1", ("baseline/Agent新手村_R1.2-dev.html", "baseline/Agent新手村_R1.2-alpha1.html")),
    ("Alpha1 vs Round2-dev", ("baseline/Agent新手村_R1.2-alpha1.html", "baseline/Agent新手村_R1.2-round2-dev.html")),
]:
    a_path = ROOT / a_name.split(" vs ")[0].replace("R1.2-dev", "Agent新手村_R1.2-dev.html").replace("Alpha1", "Agent新手村_R1.2-alpha1.html")
    # simpler: just compare hashes already computed
    pass  # already covered in section 2

# Summary
print("\n" + "=" * 60)
if ERRORS:
    print(f"\u274c {len(ERRORS)} 项验证失败:")
    for e in ERRORS:
        print(f"  {e}")
    sys.exit(1)
else:
    print("\u2705 全部验证通过 - R1.2-alpha1 冻结包完整有效")
    sys.exit(0)
