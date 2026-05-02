"""直播间主播信息查询（可被 danmaku.py anchor 模式复用）。"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
from dataclasses import dataclass, asdict

import aiohttp
from bilibili_api import Credential, live, user


@dataclass
class AnchorProfile:
    room_id_input: int
    room_id_real: int
    anchor_uid: int
    anchor_name: str
    anchor_face: str
    anchor_face_data: str
    live_status: int
    room_title: str
    popularity: int
    followers: int


def _make_credential(
    sessdata: str | None = None,
    bili_jct: str | None = None,
    buvid3: str | None = None,
) -> Credential:
    return Credential(sessdata=sessdata, bili_jct=bili_jct, buvid3=buvid3)


async def fetch_anchor_profile(
    room_id: int,
    *,
    sessdata: str | None = None,
    bili_jct: str | None = None,
    buvid3: str | None = None,
) -> AnchorProfile:
    credential = _make_credential(sessdata=sessdata, bili_jct=bili_jct, buvid3=buvid3)
    room = live.LiveRoom(room_display_id=room_id, credential=credential)

    play_info = await room.get_room_play_info()
    room_info = await room.get_room_info()

    room_id_real = int(play_info.get("room_id") or 0)
    anchor_uid = int(play_info.get("uid") or 0)
    live_status = int(play_info.get("live_status") or 0)

    room_info_data = (room_info.get("room_info") or {}) if isinstance(room_info, dict) else {}
    anchor_info_data = (room_info.get("anchor_info") or {}) if isinstance(room_info, dict) else {}
    base_info = anchor_info_data.get("base_info") or {}

    room_title = str(room_info_data.get("title") or "")
    popularity = int(room_info_data.get("online") or 0)
    followers = int(room_info_data.get("attention") or 0)
    anchor_name = str(base_info.get("uname") or "")
    anchor_face = str(base_info.get("face") or "")

    if anchor_uid and (not anchor_name or not anchor_face):
        anchor_user = user.User(uid=anchor_uid, credential=credential)
        user_info = await anchor_user.get_user_info()
        anchor_name = anchor_name or str(user_info.get("name") or "")
        anchor_face = anchor_face or str(user_info.get("face") or "")

    # 关注数兜底：若房间信息未返回 attention，则从用户关系接口补齐
    if anchor_uid and followers <= 0:
        try:
            anchor_user = user.User(uid=anchor_uid, credential=credential)
            relation = await anchor_user.get_relation_info()
            # 常见字段：follower / fans
            followers = int(relation.get("follower") or relation.get("fans") or 0)
        except Exception:
            # 兜底失败时保持 0，不中断主流程
            pass

    anchor_face_data = ""
    if anchor_face:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://www.bilibili.com/",
            }
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(anchor_face, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        content_type = resp.headers.get("Content-Type", "image/jpeg")
                        data = await resp.read()
                        b64 = base64.b64encode(data).decode("ascii")
                        anchor_face_data = f"data:{content_type};base64,{b64}"
        except Exception:
            # 头像下载失败不影响主流程，前端可回退 URL
            anchor_face_data = ""

    return AnchorProfile(
        room_id_input=room_id,
        room_id_real=room_id_real,
        anchor_uid=anchor_uid,
        anchor_name=anchor_name,
        anchor_face=anchor_face,
        anchor_face_data=anchor_face_data,
        live_status=live_status,
        room_title=room_title,
        popularity=popularity,
        followers=followers,
    )


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Test Bilibili room anchor profile API")
    parser.add_argument("room_id", type=int, help="直播间号（短号或长号）")
    parser.add_argument("--sessdata", default=None)
    parser.add_argument("--bili-jct", dest="bili_jct", default=None)
    parser.add_argument("--buvid3", default=None)
    args = parser.parse_args()

    profile = await fetch_anchor_profile(
        args.room_id,
        sessdata=args.sessdata,
        bili_jct=args.bili_jct,
        buvid3=args.buvid3,
    )
    print(json.dumps(asdict(profile), ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(_main())
