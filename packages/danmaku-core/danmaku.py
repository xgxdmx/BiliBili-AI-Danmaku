"""
Bilibili Danmaku Entry Point - 单文件入口
自动根据参数决定运行 receiver 还是 sender
用法:
  python danmaku.py receiver    # 运行弹幕接收
  python danmaku.py sender      # 运行弹幕发送
  python danmaku.py send        # 发送单条弹幕 (需要额外参数)
"""
import sys
import asyncio

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python danmaku.py [receiver|sender|send]")
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
        args = parser.parse_args()
        result = asyncio.run(send_danmaku(args.room, args.message, args.sessdata, args.bili_jct, args.color))
        print(result)
    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)
