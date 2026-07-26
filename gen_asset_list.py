# -*- coding: utf-8 -*-
from docx import Document

doc = Document()
doc.add_heading('Agent 新手村 v1.0 · 素材需求清单（25 关更新版）', 0)
p = doc.add_paragraph()
p.add_run('关卡数：25 关（AI 启蒙营 11 + W1 黑窗口村 8 + W2 代码森林 6）\n').bold = True
p.add_run('图例：✅ 已有   🔴 急缺   🟡 P1 待做   🟢 我用代码搞定（不用你做）\n')
p.add_run('穹枝 · 13120666401')

doc.add_heading('一、状态总览', level=1)
t = doc.add_table(rows=1, cols=4); t.style = 'Light Grid Accent 1'
h = t.rows[0].cells
h[0].text, h[1].text, h[2].text, h[3].text = '模块', '需要数量', '状态', '说明'
for r in [
 ('A 培培','7–8','✅ 已有','A01–A08'),
 ('B 区域背景','6','✅ 已有','B01–B06（开放区用 B01/B03/B05）'),
 ('C 节点头像','25','✅ C01–C19 / 🔴 缺 C20–C25','每关 1 张'),
 ('D Boss 头像','3','✅ 已有','D01–D03'),
 ('E 认证插图','3','🟡 缺','E01–E03，通关认证卡面'),
 ('F 图标','—','🟢 我 SVG','锁/星/导航，不用做'),
 ('G 完成插图','25','🟡 全缺（P1，最后）','每关"啊哈"配图'),
 ('H 小黑','8','✅ 已有','H01–H08'),
 ('I 装饰','6','✅ I01–04 / 🟢 I05 / 🟡 I06','I05 虚线我 CSS 做'),
 ('J 启动/Loading','3','🟡 缺 J01','启动主图'),
]:
    c = t.add_row().cells
    for i, v in enumerate(r): c[i].text = v

doc.add_heading('二、🔴 现在最急：新增 6 关节点头像 C20–C25', level=1)
doc.add_paragraph('风格：延续 AI 启蒙营那批「几何 / 星云 / 抽象认知」风，黑白手绘针管笔 + 牛皮纸底；尺寸 512×512；透明底（PNG）。')
t2 = doc.add_table(rows=1, cols=3); t2.style = 'Light Grid Accent 1'
h2 = t2.rows[0].cells
h2[0].text, h2[1].text, h2[2].text = '编号', '对应关卡', '画什么（建议）'
for r in [
 ('C20','大模型「你天天听的 AI 都是啥」','几个发光大脑连成星群'),
 ('C21','多模态「AI 十八般武艺」','一个核心分出 文字/图/声/影 四条光束'),
 ('C22','知识保质期','沙漏 / 带日历的褪色书本'),
 ('C23','AI 报错','温和的感叹号 / 断开又重连的线（别吓人）'),
 ('C24','隐私安全','锁 + 盾牌'),
 ('C25','投喂资料','文档 / 卷宗流进一个大脑'),
]:
    c = t2.add_row().cells
    for i, v in enumerate(r): c[i].text = v

doc.add_heading('三、🟡 P1（得空做）', level=1)
doc.add_paragraph('• E01–E03 认证插图（1200×800）：AI 认知入门 / 终端操作员 / 逻辑入门，三张认证卡面')
doc.add_paragraph('• J01 启动主图（1080×1920）：培培 + 小黑，启动页大图')
doc.add_paragraph('• G01–G25 完成插图（800×600）：每关"啊哈"配图，共 25 张，量大放最后')

doc.add_heading('四、🟢 我用代码搞定（不用你生）', level=1)
doc.add_paragraph('导航图标、锁、星星（3 态）、虚线分隔、按钮、进度条、节点圆环 —— 全部 SVG / CSS。')

doc.add_heading('五、命名规范 & 存放', level=1)
doc.add_paragraph('文件名：编号.png（如 C20.png / E01.png / J01.png）')
doc.add_paragraph('存放：E:\\agent新手村\\assets\\ 下对应子目录 —— nodes（C）/ cert（E）/ splash（J）/ done（G）...')
doc.add_paragraph('存好后刷新页面即自动显示，无需改代码。')

out = r'E:\agent新手村\素材清单_v1_25关版.docx'
doc.save(out)
print('DONE ->', out)
