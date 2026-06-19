"""
共享广播模块 - 向所有已连接的 WebSocket 客户端推送事件。
由 desktop_ui.py 初始化，供 _rpc_obsidian.py 和 processor.py 等模块使用。
"""

_gw = None


def init(gw) -> None:
    """初始化广播模块（在 desktop_ui.py 注册 RPC 时调用）"""
    global _gw
    _gw = gw


def push_event(event_type: str, payload: dict = None) -> None:
    """向所有已连接的 WebSocket 客户端推送事件"""
    global _gw
    if _gw is None:
        return
    try:
        items = list(_gw._sessions.items())
        for sid, session in items:
            t = session.get("transport")
            # 只通过 WebSocket 推送，跳过 StdioTransport（会输出到终端）
            if t is not None and type(t).__name__ == "WSTransport":
                t.write({
                    "jsonrpc": "2.0",
                    "method": "event",
                    "params": {
                        "type": event_type,
                        "session_id": sid,
                        "payload": payload or {},
                    },
                })
    except Exception:
        pass
