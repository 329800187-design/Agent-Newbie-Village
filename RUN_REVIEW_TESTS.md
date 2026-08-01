# 独立审阅者复测步骤 (Agent新手村 R1.2 Round4-P0-R2)

本包为本地审阅包, 未 push / 未 PR / 未 merge / 不写 CI_PASS。以下为独立复测流程,
全部步骤可在解压后的包内完成, 不需要访问原仓库。

## 0. 环境要求
- Python >= 3.10(用于 apply_round4.py / leveldata_hash.js 无需 python)
- Node >= 18(运行浏览器测试)
- **playwright-core 已安装**: 浏览器测试 `tests/_pw.js` 通过 `require('playwright-core')` 解析,
  本包不内置 node_modules。请在解压后的包根目录先执行 `npm install playwright-core`
  (或设置 `NODE_PATH` 指向含 playwright-core 的 node_modules 目录)。
- Playwright Chromium 已安装: 设置环境变量 `PLAYWRIGHT_CHROMIUM_PATH` 指向
  `Google Chrome for Testing` 可执行文件; 或依赖 `_pw.js` 自动探测
  `~/Library/Caches/ms-playwright/chromium-*/.../Google Chrome for Testing`。

## 1. 解压
```
unzip Agent新手村_R1.2-Round4-P0-R2_独立审阅包.zip -d r4r2_review
cd r4r2_review
```

## 2. 校验和自验证(SHA256SUMS.txt 已排除自身)
```
# 在包根执行, 列出每条并比对, 最后单独核对 SHA256SUMS.txt 本身
while read hash name; do
  [ "$name" = "SHA256SUMS.txt" ] && continue
  echo "[$name] $(sha256sum "$name" | awk '{print $1}') expected=$hash"
done < SHA256SUMS.txt
sha256sum SHA256SUMS.txt
```
预期: 每条 `actual` 与 `expected` 一致; `SHA256SUMS.txt` 自身未在其内出现。

## 3. Git bundle 校验(必须同时携带两个失败 tag)
```
git bundle verify GIT_BUNDLE.bundle
git bundle list-heads GIT_BUNDLE.bundle
```
预期: verify 通过; list-heads 至少包含
- `HEAD`(= r1.2-round4-p0 分支 tip)
- `refs/tags/ROUND4_P0_REVIEW_FAILED`  -> 08c63715f40dc98f1b30fc82f9037be6ec573dec
- `refs/tags/ROUND4_P0_R1_REVIEW_FAILED` -> 1aebf616405712ff55b2a09648a9c3d92ab89d34

可用 `git clone GIT_BUNDLE.bundle out.git` 独立取出全部提交与两个 tag 复核。

## 4. 课程不变量(不变量 74/70/4/8 + 哈希)
直接查看 `COURSE_INVARIANTS.txt`(应为 MATCH/OK), 或重新计算:
```
node tests/leveldata_hash.js "Agent新手村_R1.2-round4-p0.html"
```
预期: levels=74, core=70, optional=4, worlds=8,
leveldata_worlds_sha256=56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895。

## 5. 定点复测(R2 新增 4 个测试, 直接对交付件运行)
```
node tests/test_round4_post_commit_status_sticky.js
node tests/test_round4_rollback_memory_verification.js
node tests/test_round4_rollback_persistence_verification.js
node tests/test_round4_next_core_snapshot_failure.js
```
预期: 每个脚本退出码 0(全部断言 PASS), 无 pageerror / requestfailed。

## 6. 全量回归(可选, 56 步)
```
# 需要原仓库的 run_all_tests.py; 若仅持本包, 可逐个运行 tests/ 下 14 个 Round4 测试:
for t in tests/test_round4_*.js tests/test_round4_*.py; do
  echo "=== $t ==="
  node "$t" >/dev/null 2>&1 && echo PASS || echo FAIL
done
```
(静态扫描 test_round4_transaction_static.py 退出码 0 即 PASS。)

## 7. 自重建(两次构建逐字节一致)
```
cd source
python apply_round4.py build1.html
python apply_round4.py build2.html
sha256sum build1.html build2.html "../Agent新手村_R1.2-round4-p0.html"
cd ..
cat SELF_REBUILD_VERIFY.txt
```
预期: 三个 SHA256 完全一致; `SELF_REBUILD_VERIFY.txt` 中 `self_rebuild_ok: true`。

## 8. 边界确认
- 查看 `CI_STATUS.txt`: 必须为 `CI_STATUS = CI_CONFIG_READY`, 不得为 CI_PASS。
- 本包不包含任何 push / PR / merge 操作痕迹; 提交仅停留在本地分支 r1.2-round4-p0。

## 9. 故障注入矩阵
参见 `fault_injection_results/FAULT_INJECTION_MATRIX.md`(CompletionTransactionFaults 注入点
与预期行为映射, 含 R2 加固项)。
