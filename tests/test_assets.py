#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资源完整性审计(v5 转发器)
旧版用正则猜测资源路径——已被 assets/asset_manifest.json 清单体系取代
（brief 第六节: 不能再只通过正则表达式猜测路径）。
资源审计由 tests/test_asset_manifest.py 全权负责。
本文件保留旧入口名, 直接转发。
"""
import subprocess
import sys
from pathlib import Path

target = Path(__file__).resolve().parent / "test_asset_manifest.py"
sys.exit(subprocess.run([sys.executable, str(target)]).returncode)
