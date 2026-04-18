from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


TITLE = "BiliBili弹幕Claw 使用手册"

CONTENT = """
1. 软件简介
BiliBili弹幕Claw 是一个用于直播间弹幕监听与自动回复的桌面工具。
主要能力：监听指定直播间弹幕、关键词/正则匹配、调用大模型自动生成回复、自动发送回复弹幕、手动发送弹幕、停止监听前发送自定义告别文案、直播间断开时大模型自动断开。

2. 安装与启动
1) 运行安装包：BiliBili弹幕Claw Setup 0.1.0.exe
2) 安装完成后启动程序
3) 首次启动建议按顺序配置：直播间 -> 关键词 -> 大模型 -> 弹幕

3. 页面说明
3.1 直播间
- 点击“弹出B站登录页”，扫码后自动写入 SESSDATA / bili_jct（buvid3 可选）
- 也可手动粘贴整段 Cookie 并识别
- 输入房间号后点击“开始监听”
- 点击“停止监听”可断开
- 支持“断开前发送告别弹幕”：可开关并自定义文案

3.2 关键词
- 支持关键词与正则规则
- 可启用/禁用、控制大小写

3.3 大模型
- 选择供应商和模型（默认 MiniMax M2.5 Free）
- 填写 API Key
- 先“保存供应商配置”，再点击“开始连接”
- 直播间断开时，大模型会自动断开

3.4 弹幕（监控页）
- 源弹幕：全部接收弹幕
- 匹配弹幕：命中规则弹幕（显示为“用户名: 内容”）
- 发送弹幕：查看发送记录和手动发送

4. 推荐使用流程
1) 在“直播间”完成登录
2) 在“关键词”设置匹配规则
3) 在“大模型”保存配置并连接
4) 回“直播间”开始监听
5) 在“弹幕”页观察匹配与发送

5. 常见问题
Q1 开始监听超时/失败：检查房间号、Cookie，必要时重新扫码登录。
Q2 模型连接失败：检查 API Key、模型与 endpoint 是否匹配。
Q3 中文乱码：当前版本已加入 UTF-8 处理与非法字符清洗，若仍异常请查看 debug.log。

6. 使用注意事项
- 请遵守平台规范，避免高频刷屏
- 建议设置合理发送间隔并定期清理关键词规则
""".strip()


def wrap_text(line: str, max_chars: int = 44):
    if not line:
        return [""]
    out = []
    cur = ""
    for ch in line:
        cur += ch
        if len(cur) >= max_chars:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out_path = root / "BiliBili弹幕Claw使用手册.pdf"

    # Windows 中文字体（微软雅黑）
    font_path = Path(r"C:\Windows\Fonts\msyh.ttc")
    pdfmetrics.registerFont(TTFont("MSYH", str(font_path)))

    c = canvas.Canvas(str(out_path), pagesize=A4)
    width, height = A4

    left = 18 * mm
    top = height - 20 * mm
    bottom = 18 * mm
    line_h = 7 * mm

    c.setFont("MSYH", 18)
    c.drawString(left, top, TITLE)

    y = top - 12 * mm
    c.setFont("MSYH", 11)

    for raw in CONTENT.splitlines():
        for line in wrap_text(raw, 44):
            if y < bottom:
                c.showPage()
                c.setFont("MSYH", 11)
                y = height - 20 * mm
            c.drawString(left, y, line)
            y -= line_h

    c.save()
    print(str(out_path))


if __name__ == "__main__":
    main()
