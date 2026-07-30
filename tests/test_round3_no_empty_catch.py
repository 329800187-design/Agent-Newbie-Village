# -*- coding: utf-8 -*-
"""test_round3_no_empty_catch.py — R1.2 Round3-R1 静态守门:
   对 round3_features.js 做静态扫描, 确认:
     * 不存在空 catch (catch(e){} / catch (e) {} / 仅注释的空 catch)
     * 所有 catch 必须调用 Round3Diagnostics.record
     * 所有 catch 不得降级为"无门禁"(catch 体不得含 '无门禁')
     * Round3Diagnostics 已定义并暴露到 window
     * InteractionProgress 含 sync / updatePanel / ensure 方法
   不依赖运行环境/浏览器, 纯静态检查。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(ROOT, '..', 'round3_features.js'))


def main():
    with open(SRC, encoding='utf-8') as f:
        src = f.read()

    problems = []

    # 1) 禁止空 catch (含仅注释的空 catch)
    empty_brace = re.findall(r'catch\s*\([^)]*\)\s*\{\s*\}', src)
    empty_comment = re.findall(r'catch\s*\([^)]*\)\s*\{\s*/\*.*?\*/\s*\}', src, re.S)
    if empty_brace or empty_comment:
        problems.append('发现空 catch: ' + str(empty_brace + empty_comment))

    # 2) 所有 catch 必须记录诊断, 且不得降级为"无门禁"
    catches = re.findall(r'catch\s*\(([^)]*)\)\s*\{(.*?)\}', src, re.S)
    for var, body in catches:
        if 'Round3Diagnostics.record' not in body:
            problems.append('catch 块未记录诊断: ' + body.strip()[:100])
        if '无门禁' in body:
            problems.append('catch 块降级为"无门禁": ' + body.strip()[:100])

    # 3) W6/W7 门禁缺失分支不得降级为"无门禁"/passed:null (fail-closed 守门)
    #    提取 readGate 函数体, 统计其中"无门禁（普通关卡）"/"passed: null"出现次数:
    #    合法的末尾兜底(用于非门禁关卡)只应出现 1 次; 若 >1 说明 W6/W7 缺失分支仍降级。
    rg = src.find('function readGate(levelId)')
    if rg < 0:
        problems.append('未找到 readGate 函数')
    else:
        ob = src.find('{', rg)
        depth = 0
        end = ob
        for i in range(ob, len(src)):
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break
        body = src[ob:end + 1]
        if body.count("无门禁（普通关卡）") > 1:
            problems.append('W6/W7 门禁缺失时仍降级为无门禁')
        if body.count('passed: null') > 1:
            problems.append('W6/W7 门禁缺失分支仍为 passed: null')
        # 6 个门禁缺失处理模式必须覆盖 (门禁对象不存在 / 状态不存在, W6 与 W7 各一对)
        required = [
            "typeof Sim === 'undefined'",
            "!Sim",
            "!Sim.state",
            "typeof WfSim === 'undefined'",
            "!WfSim",
            "!WfSim.state",
        ]
        for p in required:
            if p not in body:
                problems.append('readGate 缺少门禁缺失处理分支: ' + p)

    # 4) Round3Diagnostics 定义且暴露
    if 'var Round3Diagnostics' not in src:
        problems.append('未定义 Round3Diagnostics')
    if 'window.Round3Diagnostics = Round3Diagnostics' not in src:
        problems.append('未暴露 window.Round3Diagnostics')

    # 5) InteractionProgress 必须含 sync / updatePanel / ensure / currentLabel / clearFailure
    for m in ['sync = function', 'updatePanel = function', 'ensure = function',
              'currentLabel = function', 'clearFailure = function']:
        if m not in src:
            problems.append('InteractionProgress 缺少方法: ' + m)

    # 6) Level.done 包装器守门(真实门禁阻断 + 异常恢复提交锁)
    done_idx = src.find('Level.done = function')
    if done_idx < 0:
        problems.append('未找到 Level.done 包装器')
    else:
        ob = src.find('{', done_idx)
        depth = 0
        end = ob
        for i in range(ob, len(src)):
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break
        wrapper = src[ob:end + 1]
        # 6a) 门禁检查位于 _origDoneR2.apply 之前
        gate_check = wrapper.find("id === 'w6_9' || id === 'w7_7'")
        apply_idx = wrapper.find('_origDoneR2.apply')
        if gate_check < 0:
            problems.append('Level.done 包装器缺少 W6/W7 门禁检查')
        elif apply_idx < 0:
            problems.append('Level.done 包装器缺少 _origDoneR2.apply')
        elif gate_check > apply_idx:
            problems.append('门禁检查不在 _origDoneR2.apply 之前')
        # 6b) gate.passed !== true 时 return false
        if 'gate.passed !== true' not in wrapper:
            problems.append('Level.done 包装器未检查 gate.passed !== true')
        if wrapper.count('return false') < 1:
            problems.append('Level.done 包装器缺少 return false 阻断')
        # 6c) _origDoneR2.apply 位于 try/catch 内
        pre_try = wrapper.rfind('try {', 0, apply_idx)
        catch_idx = wrapper.find('catch (e)', pre_try)
        if pre_try < 0 or catch_idx < 0:
            problems.append('Level.done 包装器未用 try/catch 包裹 _origDoneR2.apply')
        elif catch_idx < apply_idx:
            problems.append('_origDoneR2.apply 未被 try/catch 包裹')
        else:
            # 6d) 该 catch 内恢复 this._completing=false 且记录 Level.done.engine
            cb = wrapper.find('{', catch_idx)
            depth = 0
            cend = cb
            for i in range(cb, len(wrapper)):
                if wrapper[i] == '{':
                    depth += 1
                elif wrapper[i] == '}':
                    depth -= 1
                    if depth == 0:
                        cend = i
                        break
            catch_body = wrapper[cb:cend + 1]
            if 'this._completing = false' not in catch_body:
                problems.append('Level.done 引擎 catch 未恢复 this._completing=false')
            if "Round3Diagnostics.record('Level.done.engine', e)" not in catch_body:
                problems.append('Level.done 引擎 catch 未调用 Round3Diagnostics.record')

    if problems:
        for p in problems:
            print('[FAIL]', p)
        sys.exit(1)
    print('OK: round3_features.js 无空 catch; 所有 catch 记录诊断且未降级为无门禁; '
          'Round3Diagnostics 已定义并暴露; InteractionProgress 含 sync/updatePanel/ensure/'
          'currentLabel/clearFailure; readGate 门禁缺失分支 fail-closed; '
          'Level.done 包装器门禁检查位于 _origDoneR2.apply 之前、gate.passed!==true 时 '
          'return、_origDoneR2.apply 受 try/catch 包裹且 catch 恢复 this._completing=false 并记录诊断')
    sys.exit(0)


if __name__ == '__main__':
    main()
