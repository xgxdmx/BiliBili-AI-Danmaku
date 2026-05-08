"""
Bilibili Danmaku Entry Point - 单文件入口
自动根据参数决定运行 receiver 还是 sender
用法:
  python danmaku.py receiver    # 运行弹幕接收
  python danmaku.py sender      # 运行弹幕发送
  python danmaku.py send        # 发送单条弹幕 (需要额外参数)
  python danmaku.py anchor      # 查询直播间主播信息 (需要 room_id)
  python danmaku.py warmup      # 预载关键模块，降低首次连接冷启动开销
"""
import sys
import asyncio
import json
from dataclasses import asdict

# Windows 打包态下，确保 stdout 以 UTF-8 输出，避免中文 JSON 被主进程按 utf-8 解析时乱码。
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python danmaku.py [receiver|sender|send|anchor|warmup]")
        sys.exit(1)

    mode = sys.argv[1].lower()

    if mode == "receiver":
        from receiver import main as receiver_main
        asyncio.run(receiver_main())
    elif mode == "sender":
        from sender import main as sender_main
        asyncio.run(sender_main())
    elif mode == "send":
        from sender import send_danmaku
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("room", type=int)
        parser.add_argument("message")
        parser.add_argument("--sessdata", "-s", required=True)
        parser.add_argument("--bili-jct", "-b", required=True)
        parser.add_argument("--color", "-c", type=int, default=16777215)
        # 仅解析 mode 之后的参数，避免把 "send" 自身当作位置参数
        args = parser.parse_args(sys.argv[2:])
        result = asyncio.run(send_danmaku(args.room, args.message, args.sessdata, args.bili_jct, args.color))
        print(result)
    elif mode == "anchor":
        from bilibili_core_api import fetch_anchor_profile
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument("room_id", type=int)
        # 仅解析 mode 之后的参数，避免把 "anchor" 自身当作 room_id
        args = parser.parse_args(sys.argv[2:])

        sessdata = None
        bili_jct = None
        buvid3 = None
        try:
            payload = (sys.stdin.read() or "").strip()
            if payload:
                parsed = json.loads(payload)
                if isinstance(parsed, dict):
                    sessdata = parsed.get("sessdata")
                    bili_jct = parsed.get("biliJct")
                    buvid3 = parsed.get("buvid3")
        except Exception:
            # 兼容无 stdin / 非 JSON 场景
            pass

        profile = asyncio.run(fetch_anchor_profile(
            args.room_id,
            sessdata=sessdata,
            bili_jct=bili_jct,
            buvid3=buvid3,
        ))
        print(json.dumps(asdict(profile), ensure_ascii=False))
    elif mode == "warmup" or mode == "__opencode_warmup__":
        # 预载关键链路依赖，尽量把首次连接的 import/初始化成本前置。
        # 注意：这里不建立真实连接，仅做模块装载与事件循环冷启动。
        # 关键点：不要 import receiver/sender 入口模块（其顶层有 stdio/JSON-RPC 副作用），
        # 否则会在 warmup 场景触发不必要的 stdout/stderr 行为。
        import aiohttp  # noqa: F401
        import blivedm  # noqa: F401
        import bilibili_api  # noqa: F401
        import bilibili_core_api  # noqa: F401

        async def _warmup() -> None:
            """执行轻量预热任务。

            思路：通过一次极短事件循环调度，让 asyncio/依赖模块完成冷启动初始化，
            不触发真实网络连接与 JSON-RPC 副作用。
            """
            await asyncio.sleep(0.05)

        asyncio.run(_warmup())
        print("ok")
    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)
