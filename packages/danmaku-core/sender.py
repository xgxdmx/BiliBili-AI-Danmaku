"""
Bilibili Danmaku Sender - 发送弹幕到B站直播间
独立模块，可被导入或命令行调用
"""
import asyncio
import aiohttp
import json
import os
import sys
import io
import time
from typing import Optional

# 强制使用 UTF-8 编码
os.environ["PYTHONUTF8"] = "1"

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True, write_through=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", line_buffering=True, write_through=True)


def sanitize_utf8_text(value: str) -> str:
    """将文本规范化为可安全编码为 UTF-8 的字符串（替换非法代理字符）。"""
    text = value if isinstance(value, str) else str(value)
    return text.encode("utf-8", errors="replace").decode("utf-8", errors="replace")


class BilibiliSender:
    """发送弹幕到B站直播间"""

    SEND_API = "https://api.live.bilibili.com/msg/send"

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def send(
        self,
        room_id: int,
        msg: str,
        sessdata: str,
        bili_jct: str,
        color: int = 16777215,
        mode: int = 1,
    ) -> dict:
        """
        发送弹幕

        Args:
            room_id: 直播间房间号
            msg: 弹幕内容
            sessdata: Cookie 中的 SESSDATA
            bili_jct: Cookie 中的 bili_jct (CSRF token)
            color: 弹幕颜色 (默认白色 16777215)
            mode: 弹幕模式 (1=滚动, 4=底部, 5=顶部)

        Returns:
            {"status": "sent", "msg": msg, "timestamp": ts}
        """
        msg = sanitize_utf8_text(msg)

        if not room_id or not msg:
            raise ValueError("room_id and msg are required")
        if not sessdata or not bili_jct:
            raise ValueError("sessdata and bili_jct are required for sending danmaku")

        session = await self._get_session()
        payload = {
            "msg": msg,
            "roomid": int(room_id),
            "csrf": bili_jct,
            "csrf_token": bili_jct,
            "color": color,
            "mode": mode,
            "rnd": int(time.time()),
            "bubble": 0,
            "fontsize": 25,
            "msg_type": 1,
        }
        cookies = {"SESSDATA": sessdata, "bili_jct": bili_jct}
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": f"https://live.bilibili.com/{room_id}",
        }

        async with session.post(self.SEND_API, data=payload, cookies=cookies, headers=headers) as resp:
            text = await resp.text()
            try:
                result = json.loads(text)
            except json.JSONDecodeError:
                raise RuntimeError(f"B站API错误: 响应无法解析 - {text[:120]}")
            if result.get("code") != 0:
                error_msg = result.get("message", "Unknown error")
                raise RuntimeError(f"B站API错误: {error_msg}")
            return {
                "status": "sent",
                "msg": msg,
                "timestamp": int(time.time() * 1000),
            }

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


async def send_danmaku(
    room_id: int,
    msg: str,
    sessdata: str,
    bili_jct: str,
    color: int = 16777215,
    mode: int = 1,
) -> dict:
    """便捷函数：发送单条弹幕"""
    sender = BilibiliSender()
    try:
        return await sender.send(room_id, msg, sessdata, bili_jct, color, mode)
    finally:
        await sender.close()


# ─── CLI ───────────────────────────────────────────────────

def parse_args():
    """解析命令行参数"""
    import argparse

    parser = argparse.ArgumentParser(description="发送弹幕到B站直播间")
    parser.add_argument("room", type=int, help="直播间房间号")
    parser.add_argument("message", type=str, help="弹幕内容")
    parser.add_argument("--sessdata", "-s", required=True, help="SESSDATA cookie")
    parser.add_argument("--bili-jct", "-b", required=True, help="bili_jct cookie (CSRF)")
    parser.add_argument(
        "--color", "-c", type=int, default=16777215, help="弹幕颜色 (默认白色)"
    )
    parser.add_argument(
        "--mode",
        "-m",
        type=int,
        default=1,
        choices=[1, 4, 5],
        help="弹幕模式: 1=滚动, 4=底部, 5=顶部",
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    try:
        result = await send_danmaku(
            room_id=args.room,
            msg=args.message,
            sessdata=args.sessdata,
            bili_jct=args.bili_jct,
            color=args.color,
            mode=args.mode,
        )
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
