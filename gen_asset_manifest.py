# -*- coding: utf-8 -*-
"""gen_asset_manifest.py — 生成 assets/asset_manifest.json（资源清单权威源）

分类依据（机械可复核）:
- required=true: 运行时引用（HTML 字面引用 + LevelData/WORLDS 动态生成，经 Node VM 提取）
- status=placeholder: 骨架占位素材（C26-C70 / G26-G70 / B07,09,11,13,15 / D04-D08 / E04-E08 / K01-K03）
  —— 对应 v1.0 发布审计时的 106 项缺失素材的批量补齐生成物 + 本轮入村占位图
- status=final: 真实素材（C01-C25 / G01-G25 / B01,03,05 / D01-D03 / E01-E03 / J01 / J02 / A07 / H01）
- status=candidate: 磁盘存在但运行时未引用（A01-06,A08 / H02-H08 / B02,04,06 / I01-I06 / J03）
  —— 不进入任何用户 ZIP，贴皮阶段决定去留
用法: python gen_asset_manifest.py  （在项目根运行；需先跑 tests/export_asset_map.js）
"""
import os, json, subprocess, sys
from math import gcd
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
AD = os.path.join(BASE, "assets")

# ---- 1. Node VM 提取运行时引用 ----
map_path = os.path.join(os.environ.get("TEMP", "/tmp"), "_asset_map_gen.json")
r = subprocess.run(["node", os.path.join(BASE, "tests", "export_asset_map.js"),
                    os.path.join(BASE, "Agent新手村_当前版.html"), map_path],
                   capture_output=True, text=True, timeout=60)
if r.returncode != 0:
    print("Node 提取失败:", r.stderr[-300:]); sys.exit(1)
amap = json.load(open(map_path, encoding="utf-8"))

levels = amap["levels"]; worlds = amap["worlds"]

# a 编号 -> 关卡 id 列表
a2lv = {}
for lv in levels:
    a2lv.setdefault(lv["a"], []).append(lv["id"])

# 运行时引用全集 required: path -> (role, world, levelId)
req = {}
for lv in levels:
    a = lv["a"]
    lvids = ";".join(a2lv[a])
    req[f"assets/nodes/C{a}.png"] = ("level_node", lv["world"], lvids)
    req[f"assets/done/G{a}.png"] = ("level_done", lv["world"], lvids)
for wk, w in worlds.items():
    req[f"assets/bg/{w['bg']}.png"] = ("world_bg", wk, "")
    req[f"assets/boss/{w['boss']}.png"] = ("world_boss", wk, "")
    req[f"assets/cert/{w['certTag']}.png"] = ("world_cert", wk, "")
for p_ in amap["staticRefs"]:
    if p_.startswith("assets/onboard/"):
        req[p_] = ("onboard_illustration", "", "")
    elif p_.startswith("assets/splash/"):
        req[p_] = ("splash", "", "")
    elif p_.startswith("assets/peipei/"):
        req[p_] = ("mascot_peipei", "", "")
    elif p_.startswith("assets/kuro/"):
        req[p_] = ("mascot_kuro", "", "")

# ---- 2. placeholder 名单（机械） ----
PLACEHOLDER = set()
for i in range(26, 71):
    PLACEHOLDER.add(f"assets/nodes/C{i:02d}.png")
    PLACEHOLDER.add(f"assets/done/G{i:02d}.png")
for b in ["B07", "B09", "B11", "B13", "B15"]:
    PLACEHOLDER.add(f"assets/bg/{b}.png")
for d in ["D04", "D05", "D06", "D07", "D08"]:
    PLACEHOLDER.add(f"assets/boss/{d}.png")
for e in ["E04", "E05", "E06", "E07", "E08"]:
    PLACEHOLDER.add(f"assets/cert/{e}.png")
for k in ["K01", "K02", "K03"]:
    PLACEHOLDER.add(f"assets/onboard/{k}.png")

ROLE_BY_DIR = {"nodes": "level_node", "done": "level_done", "bg": "world_bg",
               "boss": "world_boss", "cert": "world_cert", "peipei": "mascot_peipei",
               "kuro": "mascot_kuro", "splash": "splash", "onboard": "onboard_illustration",
               "ui": "ui_reserve"}

def aspect_str(w, h):
    g = gcd(w, h)
    a, b = w // g, h // g
    if a > 40 or b > 40:  # 不规则比例, 保留两位小数比值
        return f"free({w/h:.2f})"
    return f"{a}:{b}"

# ---- 3. 全盘扫描 assets/ ----
entries = []
seen_paths = set()
for sub in sorted(os.listdir(AD)):
    sp = os.path.join(AD, sub)
    if not os.path.isdir(sp):
        continue
    for fn in sorted(os.listdir(sp)):
        rel = f"assets/{sub}/{fn}"
        fp = os.path.join(sp, fn)
        if not fn.lower().endswith(".png"):
            continue
        with Image.open(fp) as im:
            w, h = im.size
        is_req = rel in req
        role = req[rel][0] if is_req else ROLE_BY_DIR.get(sub, "unknown")
        if rel in PLACEHOLDER:
            status = "placeholder"
        elif is_req:
            status = "final"
        else:
            status = "candidate"
        # 特例: J02 = brief 指定的唯一 splash 规范预留文件, 保留在用户包
        if rel == "assets/splash/J02.png":
            status, role = "final", "splash_reserved"
        e = {
            "path": rel,
            "role": role,
            "status": status,
            "required": bool(is_req),
            "world": req[rel][1] if is_req else "",
            "levelId": req[rel][2] if is_req else "",
            "expectedAspect": aspect_str(w, h),
        }
        if rel == "assets/splash/J02.png":
            e["notes"] = "splash 唯一规范预留文件（brief 第九节）；候选版本 J02_1~6 已移至 assets_candidates/splash/"
        if status == "placeholder":
            e["notes"] = e.get("notes", "") or "骨架占位素材，正式美术同名替换后改 status=final"
        if status == "candidate":
            e["notes"] = "运行时未引用；不进入用户 ZIP；贴皮阶段决定接入或废弃"
        entries.append(e)
        seen_paths.add(rel)

# required 引用但磁盘没有的文件也要列出来（构建时报缺失）
for rel, (role, wk, lvids) in sorted(req.items()):
    if rel not in seen_paths:
        entries.append({"path": rel, "role": role, "status": "placeholder",
                        "required": True, "world": wk, "levelId": lvids,
                        "expectedAspect": "", "notes": "缺失! 引用存在但文件不存在"})

entries.sort(key=lambda x: x["path"])
manifest = {
    "manifestVersion": 1,
    "project": "Agent新手村 v1.0 骨架",
    "statusEnum": ["final", "placeholder", "candidate", "deprecated"],
    "zipPolicy": {"skeleton": ["final", "placeholder"], "release": ["final"]},
    "aspectTolerance": 0.05,
    "assets": entries,
}
out = os.path.join(AD, "asset_manifest.json")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
    f.write("\n")

from collections import Counter
c = Counter(e["status"] for e in entries)
rq = sum(1 for e in entries if e["required"])
print(f"OK {out}")
print(f"  条目: {len(entries)}  required: {rq}")
print(f"  final={c['final']} placeholder={c['placeholder']} candidate={c['candidate']} deprecated={c.get('deprecated',0)}")
