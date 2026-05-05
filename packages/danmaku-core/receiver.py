"""
Bilibili Danmaku Core - JSON-RPC Server
基于 blivedm 的B站弹幕监听服务，通过 stdio JSON-RPC 与 Node 通信
"""
import sys
import json
import asyncio
import os
import io
import signal
import queue
import threading
import inspect
import time
from typing import Any, Callable, Optional

# 强制使用 UTF-8 编码
os.environ["PYTHONUTF8"] = "1"

if sys.platform == "win32":
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace", line_buffering=True)
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", write_through=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", write_through=True)

# Note: Windows 上的 stdin 读取使用线程处理

try:
    import aiohttp
    from blivedm import BLiveClient
    # 输出启动确认
    print(json.dumps({"jsonrpc": "2.0", "method": "system.ready", "params": {"pid": os.getpid()}}))
except ImportError:
    print(json.dumps({
        "jsonrpc": "2.0",
        "method": "system.error",
        "params": {"message": "Missing dependencies. Run: pip install blivedm aiohttp"}
    }), flush=True)
    sys.exit(1)


def log_stderr(message: str):
    """轻量日志：仅输出到 stderr，避免污染 JSON-RPC stdout。"""
    try:
        sys.stderr.write(message + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def sanitize_utf8_text(value: Any) -> str:
    """将文本规范化为可安全编码为 UTF-8 的字符串（替换非法代理字符）。"""
    text = value if isinstance(value, str) else str(value)
    return text.encode("utf-8", errors="replace").decode("utf-8", errors="replace")


# ─── JSON-RPC Protocol ─────────────────────────────────────

class JsonRpcServer:
    """基于 stdio 的 JSON-RPC 2.0 服务器。

    设计要点：
    1) stdout 只能输出 JSON-RPC 数据，避免被普通日志污染；
       因此调试日志统一走 stderr（见 log_stderr）。
    2) Windows 下 stdin.readline() 与 asyncio 兼容性较差，
       采用“读取线程 + 队列 + 主协程消费”的模型。
    3) 仅处理两类 JSON-RPC 消息：
       - Request/Notification（带 method）
       - Response（带 id/result 或 id/error）
    """

    def __init__(self):
        self._methods: dict[str, Callable] = {}
        self._running = False

    def register_method(self, name: str, handler: Callable):
        self._methods[name] = handler

    async def send_notification(self, method: str, params: dict | None = None):
        notification: dict = {"jsonrpc": "2.0", "method": method}
        if params:
            notification["params"] = params
        sys.stdout.write(json.dumps(notification) + "\n")
        sys.stdout.flush()

    async def send_response(self, id_: str, result: Any = None, error: dict | None = None):
        response: dict = {"jsonrpc": "2.0", "id": id_}
        if error:
            response["error"] = error
        else:
            response["result"] = result
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    async def _read_loop(self):
        """从 stdin 逐行读取 JSON-RPC 请求（线程读取 + 异步消费）。

        为什么不用纯 asyncio 读 stdin：
        - 在 Windows 打包/控制台环境下，异步读取 stdin 经常出现阻塞或事件循环兼容问题。
        - 这里用后台线程稳定读取，再由协程非阻塞消费队列，可靠性更高。
        """
        # 创建一个队列用于线程间通信
        q: queue.Queue[str] = queue.Queue()

        def read_stdin():
            """在单独线程中读取 stdin"""
            while self._running:
                try:
                    line = sys.stdin.readline()
                    if not line:
                        break
                    stripped = line.strip()
                    if stripped:
                        q.put_nowait(stripped)
                except Exception as e:
                    log_stderr(f"[STDIN] Error: {e}")
                    break

        # 启动读取线程
        reader_thread = threading.Thread(target=read_stdin, daemon=True)
        reader_thread.start()

        # 在主循环中处理
        while self._running:
            try:
                # 非阻塞检查队列
                data = q.get_nowait()
                await self._handle_message(data)
            except queue.Empty:
                await asyncio.sleep(0.1)
            except Exception as e:
                await self.send_notification("system.error", {"message": f"Read error: {e}"})

    async def _handle_message(self, raw: str):
        # 1) 原始文本 -> JSON。
        #    失败时直接发送 system.error，避免抛异常中断读取循环。
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError as e:
            await self.send_notification("system.error", {"message": f"Invalid JSON: {e}"})
            return

        method = msg.get("method")
        msg_id = msg.get("id")
        params = msg.get("params", {})

        # 2) 没有 method 的消息不是请求/通知，直接忽略。
        if not method:
            return

        handler = self._methods.get(method)
        # 3) method 未注册：
        #    - 如果带 id（即 request），按 JSON-RPC 规范返回 -32601。
        #    - 如果不带 id（即 notification），静默忽略。
        if not handler:
            if msg_id:
                await self.send_response(msg_id, error={"code": -32601, "message": f"Method not found: {method}"})
            return

        try:
            # 4) 兼容同步/异步 handler：
            #    - 异步函数 await 执行
            #    - 同步函数直接调用
            result = await handler(params) if inspect.iscoroutinefunction(handler) else handler(params)
            if msg_id:
                await self.send_response(msg_id, result=result)
        except Exception as e:
            # 5) 处理异常统一返回 -32603（内部错误）
            if msg_id:
                await self.send_response(msg_id, error={"code": -32603, "message": str(e)})

    async def start(self):
        self._running = True
        await self.send_notification("connection.connected", {"pid": __import__("os").getpid()})
        await self._read_loop()

    async def stop(self):
        self._running = False


# ─── Bilibili Danmaku Client ────────────────────────────────

class BilibiliDanmakuClient:
    """基于 blivedm 的B站弹幕客户端"""

    def __init__(self, rpc: JsonRpcServer):
        self.rpc = rpc
        self._client: Optional[BLiveClient] = None
        self._room_id: Optional[int] = None
        self._credentials: dict = {}
        self._connected = False
        self._session: Optional[aiohttp.ClientSession] = None

    async def start(self, params: dict) -> dict:
        """启动监听。

        输入：
        - roomId: 直播间房间号（必填）
        - credentials: 包含 sessdata/biliJct/buvid3 的字典（可选但建议提供）

        流程：
        1) 解析房间号与凭证；
        2) 创建带 Cookie 的 aiohttp session（若有凭证）；
        3) 初始化 BLiveClient 并注册 handler；
        4) 启动 client 并回发 connection.connected；
        5) 失败时规范化错误并回发 connection.error。
        """
        room_id = params.get("roomId")
        if not room_id:
            raise ValueError("roomId is required")

        self._room_id = int(room_id)
        self._credentials = params.get("credentials", {})

        if self._client:
            await self.stop({})

        sessdata = self._credentials.get("sessdata", "")
        bili_jct = self._credentials.get("biliJct", "")
        buvid3 = self._credentials.get("buvid3", "")

        # 构建 Cookie 头
        cookies = {}
        if sessdata:
            cookies["SESSDATA"] = sessdata
        if bili_jct:
            cookies["bili_jct"] = bili_jct
        if buvid3:
            cookies["buvid3"] = buvid3

        # 创建带 cookie 的 session
        if cookies:
            import aiohttp
            self._session = aiohttp.ClientSession(cookies=cookies)

        self._client = BLiveClient(
            room_id=self._room_id,
            session=self._session,
        )

        handler = _DanmakuHandler(self)
        self._client.set_handler(handler)

        try:
            # 新版本 blivedm 使用同步 start()
            self._client.start()
            self._connected = True
            await self.rpc.send_notification("connection.connected", {
                "roomId": self._room_id,
                "status": "connected",
            })
            return {"status": "started", "roomId": self._room_id}
        except Exception as e:
            self._connected = False
            error_msg = str(e)
            # 提供更友好的错误提示
            if "init_room() failed" in error_msg or "InitError" in error_msg:
                if "-352" in error_msg or "message=-352" in error_msg:
                    error_msg = "直播间未开播或不存在，请确认房间号是否正确，或等待开播后重试"
                elif "-101" in error_msg:
                    error_msg = "Cookie 可能已过期，请重新获取 SESSDATA"
                else:
                    error_msg = "连接失败，直播间可能未开播"
            # 先关闭 client
            try:
                if self._client:
                    await self._client.stop() # type: ignore
            except Exception:
                pass
            self._client = None
            # 发送错误通知
            try:
                await self.rpc.send_notification("connection.error", {
                    "roomId": self._room_id,
                    "error": error_msg,
                })
            except Exception:
                pass
            # 等待一点时间让通知发送
            await asyncio.sleep(0.1)
            # 返回错误结果
            return {"status": "error", "error": error_msg}

    async def stop(self, params: dict) -> dict:
        if self._client:
            # blivedm 新版本 stop() 是同步方法，这里直接调用即可
            self._client.stop()  # 同步停止
            self._client = None
            self._connected = False
            await self.rpc.send_notification("connection.disconnected", {"roomId": self._room_id})
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None
        return {"status": "stopped"}

    async def get_status(self, params: dict) -> dict:
        return {"connected": self._connected, "roomId": self._room_id}


class _DanmakuHandler:
    """弹幕事件处理器。

    说明：
    - 采用直接实现 handle(cmd) 的方式，显式分发 DANMU/GIFT/SC，
      便于在项目层做字段兜底与统一输出格式。
    - 输出给上层（Node/Electron）的结构是“项目自定义契约”，
      不完全等同于 blivedm 原始 data 结构。
    """

    def __init__(self, client: BilibiliDanmakuClient):
        self.client = client

    def _to_guard_title(self, guard_level: int) -> str:
        if guard_level == 1:
            return "总督"
        if guard_level == 2:
            return "提督"
        if guard_level == 3:
            return "舰长"
        return ""

    def _extract_guard_level(self, command, user, info):
        """提取大航海等级 (0=无, 1=总督, 2=提督, 3=舰长)

        优先级：
        1) info[7] — B站 DANMU_MSG 原始协议标准位置 (privilege_type/guard_level)
        2) 命名字段 — user/data/command 中的 guard_level / privilege_type
        3) info[3] 粉丝牌数组 index 6 — 部分协议版本的 guard_level 位
        """
        # ── 优先级 1: info[7] 是 B站 DANMU_MSG 原始协议标准位置 ──
        # A. 先看 DANMU_MSG 标准位 info[7]（最可靠）
        if isinstance(info, list) and len(info) > 7:
            try:
                v = int(info[7])
                if v in (0, 1, 2, 3):
                    return v
            except (ValueError, TypeError):
                pass

        # ── 优先级 2: 命名字段 (open_live 协议 / blivedm 解析) ──
        candidates = []
        # B. 再看命名字段（不同协议/版本字段名不一致）
        if isinstance(user, dict):
            candidates.extend([
                user.get("guard_level"),
                user.get("privilege_type"),
                user.get("guardLevel"),
                user.get("guardlevel"),
            ])
            base = user.get("base", {})
            if isinstance(base, dict):
                candidates.extend([
                    base.get("guard_level"),
                    base.get("privilege_type"),
                    base.get("guardLevel"),
                ])

        if isinstance(command, dict):
            data = command.get("data", {})
            if isinstance(data, dict):
                candidates.extend([
                    data.get("guard_level"),
                    data.get("privilege_type"),
                    data.get("guardLevel"),
                ])
            candidates.append(command.get("guard_level"))
            candidates.append(command.get("privilege_type"))

        # C. 依次尝试转 int，命中 0/1/2/3 立即返回
        for value in candidates:
            try:
                v = int(value)
                if v in (0, 1, 2, 3):
                    return v
            except (ValueError, TypeError):
                pass

        # ── 优先级 3: info[3] 粉丝牌数组 index 6 ──
        # D. 最后兜底到 info[3] 粉丝牌数组特定位（兼容旧结构）
        medal = info[3] if isinstance(info, list) and len(info) > 3 and isinstance(info[3], list) else []
        if isinstance(medal, list) and len(medal) > 6:
            try:
                v = int(medal[6])
                if v in (0, 1, 2, 3):
                    return v
            except (ValueError, TypeError):
                pass

        return 0

    def _extract_medal(self, command, user, info):
        """提取粉丝牌信息，兼容多种字段结构。

        输出统一结构：
        {
          name: str,
          level: int,
          color: int,
        }

        兼容顺序：
        1) user.medal / user.base.medal
        2) command.data.medal_info
        3) DANMU_MSG info[3] 数组
        """
        candidates = []

        # 1) user.medal / user.base.medal
        if isinstance(user, dict):
            candidates.append(user.get("medal"))
            base = user.get("base", {})
            if isinstance(base, dict):
                candidates.append(base.get("medal"))

        # 2) command.data.medal_info
        if isinstance(command, dict):
            data = command.get("data", {})
            if isinstance(data, dict):
                candidates.append(data.get("medal_info"))

        # 命名字段解析：只要拿到 name 就构建统一结构返回
        for c in candidates:
            if not isinstance(c, dict):
                continue
            name = c.get("medal_name") or c.get("name")
            level = c.get("medal_level") or c.get("level")
            color = c.get("medal_color") or c.get("color")
            if name:
                try:
                    return {
                        "name": str(name),
                        "level": int(level) if level is not None else 0,
                        "color": int(color) if color is not None else 0,
                    }
                except Exception:
                    # 某些字段格式异常时，至少保证 name 不丢
                    return {
                        "name": str(name),
                        "level": 0,
                        "color": 0,
                    }

        # 3) 兼容 DANMU_MSG info[3] 数组
        # 命名字段拿不到时，再兼容 DANMU_MSG 的 info[3]
        medal = info[3] if isinstance(info, list) and len(info) > 3 else []
        if isinstance(medal, list) and len(medal) >= 2:
            try:
                return {
                    "name": str(medal[1]),
                    "level": int(medal[0]),
                    "color": int(medal[4]) if len(medal) > 4 and medal[4] is not None else 0,
                }
            except Exception:
                return {
                    "name": str(medal[1]),
                    "level": 0,
                    "color": 0,
                }

        return None

    def set_client(self, client):
        """设置 blivedm 客户端引用（blivedm 回调接口要求）"""
        self.client = client

    def on_client_stopped(self, client, exception):
        """blivedm 生命周期回调：客户端停止时触发。"""
        if exception is not None:
            try:
                log_stderr(f"[Danmaku client stopped] {exception}")
            except Exception:
                pass

    def handle(self, client, command):
        """直接处理所有命令 - 修复 blivedm 的异步回调 bug"""
        cmd = command.get("cmd", "")
        pos = cmd.find(":")
        if pos != -1:
            # B站有时会附带后缀参数，如 CMD:xxx，这里统一裁掉后缀
            cmd = cmd[:pos]
        
        # 按消息类型分发。未识别消息不抛错，避免影响主流程。
        if cmd == "DANMU_MSG":
            self._handle_danmaku(command)
        elif cmd == "SEND_GIFT":
            self._handle_gift(command)
        elif cmd == "SUPER_CHAT_MESSAGE":
            self._handle_superchat(command)

    def _handle_danmaku(self, command):
        """处理普通弹幕（DANMU_MSG）。

        这里会把 blivedm 原始命令转换为项目统一结构后通过
        JSON-RPC 通知 `danmaku.received` 发给 Node。
        """
        info = command.get("info", [])
        if not info:
            return
        
        try:
            # 弹幕文本
            msg = str(info[1]) if len(info) > 1 else ""
            
            # 从 command 的 user 字段获取用户信息
            user = command.get("user", {})
            uid = 0
            uname = "匿名用户"
            
            if user:
                # 新结构优先：command.user 中通常包含 uid/uname
                uid = int(user.get("uid", 0)) if user.get("uid") else 0
                uname = str(user.get("uname", f"uid_{uid}"))
                # 如果用户名被遮挡，用 base 信息
                if uname.startswith("**") or uname == "匿名用户":
                    base = user.get("base", {})
                    if base:
                        uname = str(base.get("name", uname))
            
            # 如果没找到，从 info 数组获取
            # 兜底：若 user 结构不完整，再从 info[2] 老结构取值
            if uname == "匿名用户" or uid == 0:
                user_info = info[2] if len(info) > 2 else []
                if user_info:
                    uid = int(user_info[0]) if len(user_info) > 0 and user_info[0] else 0
                    uname = str(user_info[1]) if len(user_info) > 1 else f"uid_{uid}"
            
            medal_data = self._extract_medal(command, user, info)

            guard_level = self._extract_guard_level(command, user, info)
            guard_title = self._to_guard_title(guard_level)
            
            data = {
                "id": int(time.time() * 1000000),
                "content": msg,
                "sender": {
                    "uid": uid,
                    "username": uname,
                    "is_admin": False,
                    "is_vip": False,
                    "guard_level": guard_level,
                    "guard_title": guard_title,
                    "medal": medal_data,
                },
                "timestamp": int(time.time() * 1000),
                "roomId": self.client._room_id,
                "color": 16777215,
                "mode": 1,
            }
            asyncio.create_task(self.client.rpc.send_notification("danmaku.received", data))
        except Exception as e:
            log_stderr(f"[Danmaku parse error] {e}")

    def _handle_gift(self, command):
        """处理礼物（SEND_GIFT）。

        输出通知：`danmaku.gift`
        字段使用项目统一命名（giftId/giftName/count/sender...）。
        """
        data_payload = command.get("data", {})
        medal_data = self._extract_medal(command, {"medal": data_payload.get("medal_info")}, [])
        ts = int(time.time() * 1000)
        # 统一转换成前端消费结构；字段名尽量稳定（giftId/giftName/count/sender）
        asyncio.create_task(self.client.rpc.send_notification("danmaku.gift", {
            "giftId": data_payload.get("giftId", 0),
            "giftName": data_payload.get("giftName", ""),
            "count": data_payload.get("num", 1),
            "coinType": "gold" if str(data_payload.get("coin_type", "gold")).lower() == "gold" else "silver",
            "totalPrice": data_payload.get("total_coin", 0),
            "sender": {
                "uid": data_payload.get("uid", 0),
                "username": data_payload.get("uname", ""),
                "is_admin": False,
                "is_vip": False,
                "medal": medal_data,
            },
            "roomId": self.client._room_id,
            "timestamp": ts,
        }))

    def _handle_superchat(self, command):
        """处理 SuperChat（SUPER_CHAT_MESSAGE）。

        重点：用户名兜底
        ----------------
        blivedm/web 模型中，SC 用户名常位于 `data.user_info.uname`。
        历史代码只读 `data.uname`，在部分场景会拿不到用户名，
        导致前端回退显示“用户”。

        当前策略：
        1) uid 先取 data.uid，缺失时回退 data.user_info.uid
        2) username 先取 data.uname，缺失时回退 data.user_info.uname
        3) 补充 face/guard_level/guard_title/medal/timestamp

        输出通知：`danmaku.superchat`
        """
        data = command.get("data", {})
        user_info = data.get("user_info", {}) if isinstance(data, dict) else {}
        medal_info = data.get("medal_info", {}) if isinstance(data, dict) else {}

        # uid 优先顶层 data.uid，缺失时回退 user_info.uid
        uid = data.get("uid", 0)
        if not uid and isinstance(user_info, dict):
            uid = user_info.get("uid", 0)

        # uname 优先顶层 data.uname，缺失时回退 user_info.uname
        # 这是修复“前端显示用户”问题的关键分支。
        uname = data.get("uname", "")
        if not uname and isinstance(user_info, dict):
            uname = user_info.get("uname", "")

        face = ""
        if isinstance(user_info, dict):
            face = user_info.get("face", "")

        guard_level = 0
        # guard_level 仅在可转 int 时使用；异常时回退 0
        if isinstance(user_info, dict):
            try:
                guard_level = int(user_info.get("guard_level", 0) or 0)
            except (TypeError, ValueError):
                guard_level = 0

        medal_data = None
        # SC 的 medal_info 可选；存在且含 name 才输出 medal
        if isinstance(medal_info, dict):
            medal_name = medal_info.get("medal_name") or ""
            if medal_name:
                try:
                    medal_data = {
                        "name": str(medal_name),
                        "level": int(medal_info.get("medal_level", 0) or 0),
                        "color": int(medal_info.get("medal_color", 0) or 0),
                    }
                except (TypeError, ValueError):
                    medal_data = {
                        "name": str(medal_name),
                        "level": 0,
                        "color": 0,
                    }

        asyncio.create_task(self.client.rpc.send_notification("danmaku.superchat", {
            "id": data.get("id", 0),
            "content": data.get("message", ""),
            "price": data.get("price", 0),
            "sender": {
                "uid": uid,
                "username": uname,
                "is_admin": False,
                "is_vip": False,
                "guard_level": guard_level,
                "guard_title": self._to_guard_title(guard_level),
                "medal": medal_data,
                "face": face,
            },
            "roomId": self.client._room_id,
            "timestamp": int(time.time() * 1000),
        }))


# ─── Danmaku Sender ─────────────────────────────────────────

class DanmakuSender:
    """发送弹幕到B站直播间"""

    SEND_API = "https://api.live.bilibili.com/msg/send"

    def __init__(self, rpc: JsonRpcServer):
        self.rpc = rpc
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def send(self, params: dict) -> dict:
        room_id = params.get("roomId")
        msg = sanitize_utf8_text(params.get("msg", ""))
        sessdata = params.get("sessdata", "")
        bili_jct = params.get("biliJct", "")
        color = params.get("color", 16777215)
        mode = params.get("mode", 1)

        if not room_id or not msg:
            raise ValueError("roomId and msg are required")
        if not sessdata or not bili_jct:
            raise ValueError("sessdata and biliJct are required for sending danmaku")

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
                raise RuntimeError(f"B站API错误: {result.get('message', '未知错误')} (code={result.get('code')})")
            return {"status": "sent", "msg": msg}

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


# ─── Main ────────────────────────────────────────────────────

async def main():
    rpc = JsonRpcServer()
    danmaku_client = BilibiliDanmakuClient(rpc)
    danmaku_sender = DanmakuSender(rpc)

    rpc.register_method("start", danmaku_client.start)
    rpc.register_method("stop", danmaku_client.stop)
    rpc.register_method("getStatus", danmaku_client.get_status)
    rpc.register_method("sendDanmaku", danmaku_sender.send)

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown(rpc, danmaku_client, danmaku_sender)))
        except NotImplementedError:
            pass

    try:
        await rpc.start()
    except KeyboardInterrupt:
        await shutdown(rpc, danmaku_client, danmaku_sender)


async def shutdown(rpc, client, sender):
    await client.stop({})
    await sender.close()
    await rpc.stop()


if __name__ == "__main__":
    asyncio.run(main())
