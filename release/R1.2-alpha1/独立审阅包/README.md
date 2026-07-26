# Agent新手村 R1.2-alpha1 独立审阅包

## 生成信息

| 项目 | 值 |
|------|-----|
| 生成日期 | 2026-07-25 |
| 证据修正日期 | 2026-07-26 |
| 冻结版本 | R1.2-alpha1 |
| 基线来源 | E:\agent新手村\source\Agent新手村_R1.2-dev.html |

## 包的性质

> 本包是**冻结完整性验证包**，用于验证 R1.1、R1.2-dev、R1.2-alpha1 和 R1.2-round2-dev 的一致性、课程哈希与冻结证据。
> 本包不包含完整 assets 资源树，因此**不提供独立构建复现**；完整构建复现应使用工程源码包。

## 截图状态

> 人工视觉检查已经完成（2026-07-25，真实浏览器 + 鼠标），但本批未保存截图证据。
> screenshots 目录为预留目录，不代表包内已经包含截图。

## 目录说明

```
独立审阅包/
├── README.md                              ← 本文件
├── verify_package.py                      ← 一键验证脚本
├── baseline/                              ← 四个版本 HTML（核心）
│   ├── R1.1_当前权威版.html               ← R1.1 基线（不可变）
│   ├── Agent新手村_R1.2-dev.html          ← R1.2 首批开发版
│   ├── Agent新手村_R1.2-alpha1.html       ← 冻结版
│   └── Agent新手村_R1.2-round2-dev.html   ← 第二批起点
├── scripts/                               ← 构建与哈希工具
│   ├── build_release.py
│   └── leveldata_hash.js
├── validators/                            ← 验证基线
│   ├── _leveldata_hash_baseline.json      ← R1.1 原始基线（不可修改）
│   ├── R1.1_LevelValidator.json           ← R1.1 旧版验证器输出
│   └── R1.2_LevelValidator.json           ← R1.2 当前工具验证器输出
├── evidence/                              ← 冻结证据
│   ├── R1.2_ALPHA1_SHA256SUMS.txt
│   ├── R1.2_ALPHA1_REVIEW_PACKAGE_SHA256SUMS.txt
│   ├── R1.2_ALPHA1_MANIFEST.txt
│   ├── R1.2_ALPHA1_SIGNOFF.md
│   ├── R1.2_ALPHA1_TEST_SUMMARY.md
│   └── R1.2_ALPHA1_KNOWN_GAPS.md
├── reports/                               ← 审阅报告
│   ├── R1.2_VISUAL_REVIEW_ROUND1_FINAL.md
│   └── R1.2_VISUAL_ISSUES_ROUND1_FINAL.json
└── screenshots/                           ← 预留目录（本批未保存截图）
```

## 构建复现说明

> **本包为冻结验证包**，用于冻结完整性验证和证据追溯，不提供独立构建复现。
>
> `scripts/build_release.py` 无法直接运行，因为缺少：
> - `scripts/Agent新手村_当前版.html`（源文件）
> - `scripts/assets/asset_manifest.json`（素材清单）
> - 完整 assets 文件
>
> 构建复现请使用完整工程源码包（`source/` 目录 + 完整 assets）。

## Issue 追溯

| Issue | 描述 | 状态 |
|-------|------|------|
| ISSUE-R1-001 | 路线推荐弹窗"进入零基础成长线"按钮自动化点击问题 | CLOSED_HUMAN_VERIFIED |
| ISSUE-R1-002 | 关卡内答题按钮自动化点击问题 | CLOSED_HUMAN_VERIFIED |
| ISSUE-R1-003 | 完成弹窗未分级 | DEFERRED_PLANNED |

## 验证方法

### 快速验证（推荐）
```bash
cd 独立审阅包/
python verify_package.py
```

### 手工逐项验证
```bash
# 1. SHA256 一致性
sha256sum baseline/*.html

# 2. 逐字节比较
cmp baseline/Agent新手村_R1.2-dev.html baseline/Agent新手村_R1.2-alpha1.html
cmp baseline/Agent新手村_R1.2-alpha1.html baseline/Agent新手村_R1.2-round2-dev.html

# 3. 课程哈希
node scripts/leveldata_hash.js baseline/Agent新手村_R1.2-alpha1.html

# 4. JS 语法
node -e "const fs=require('fs'); const h=fs.readFileSync('baseline/Agent新手村_R1.2-alpha1.html','utf8'); const m=h.match(/<script>([\\s\\S]*?)<\\/script>/); if(m) new Function(m[1]); console.log('OK')"

# 5. 全包 SHA256SUMS 校验
sha256sum -c evidence/R1.2_ALPHA1_REVIEW_PACKAGE_SHA256SUMS.txt
```

## 预期结果

| 检查项 | 预期值 |
|--------|--------|
| R1.1 SHA256 | `6a5204e5de03db07b43858ed24b0d00c6476d2411f1d9e41a16f8ff63b188b82` |
| R1.2-dev/alpha1/round2 SHA256 | `4eb33a5b609842e1a07325dd68dc8c295101aba047df085fbab83a552b1e0f1d` |
| 三份 R1.2 HTML | 逐字节一致 |
| R1.1 ≠ R1.2 | 不一致（R1.2 有视觉令牌） |
| 课程哈希 | `56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895` |
| levels | 74 |
| core | 70 |
| optional | 4 |
| worlds | 8 |
| payload_chars（leveldata_hash.js） | 182171 |
| payload_chars 口径 | auxiliary_only（不作为冻结失败条件） |
| TEST_MODE | false |
| JS syntax | OK |
| ISSUE-R1-001 | CLOSED_HUMAN_VERIFIED |
| ISSUE-R1-002 | CLOSED_HUMAN_VERIFIED |
| ISSUE-R1-003 | DEFERRED_PLANNED |
