"""统一 User-Agent 与请求头管理。

所有 HTTP 请求共用同一个 UA 字符串，避免各模块各自硬编码导致指纹不一致。
UA 内容模拟当前 Chrome 稳定版（Windows 11），与 B 站主流用户群的浏览器指纹一致。

使用方式：
    from ua import CHROME_UA, SEND_API_HEADERS, DOWNLOAD_HEADERS

    # 弹幕发送等需要完整请求头的场景
    headers = {**SEND_API_HEADERS, "Referer": f"https://live.bilibili.com/{room_id}"}

    # 头像下载等简单场景
    headers = {**DOWNLOAD_HEADERS}
"""

# Chrome 148 on Windows 11
CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/148.0.0.0 Safari/537.36"
)

# 弹幕发送 API 专用 headers（完整请求头集合）
# Content-Type: POST 表单标准
# Referer / Origin: B 站风控校验必需，必须与直播间 URL 一致
SEND_API_HEADERS = {
    "User-Agent": CHROME_UA,
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer": "https://live.bilibili.com/",
    "Origin": "https://live.bilibili.com",
}

# 通用下载 headers（头像、图片等 GET 请求）
DOWNLOAD_HEADERS = {
    "User-Agent": CHROME_UA,
    "Referer": "https://www.bilibili.com/",
}
