"""
Hermes Agent — Desktop UI (standalone launcher).

Wraps the existing web dashboard in a native desktop window using pywebview.
This file lives OUTSIDE the hermes-agent repo — zero repo modifications.

Usage:
    python desktop_ui.py
    python desktop_ui.py --port 8080 --lang en
"""

import argparse
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

_DESKTOP_DIR = Path(__file__).parent.resolve()
HERMES_BASE_DIR = _DESKTOP_DIR.parent.resolve()
HERMES_AGENT_DIR = HERMES_BASE_DIR / "hermes-agent"
HERMES_AGENT_DIR = HERMES_AGENT_DIR.resolve()

if str(_DESKTOP_DIR) not in sys.path:
    sys.path.insert(0, str(_DESKTOP_DIR))
if str(HERMES_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(HERMES_AGENT_DIR))

os.environ.setdefault("HERMES_HOME", str(HERMES_BASE_DIR))
os.environ.setdefault("HERMES_WEB_DIST", str(HERMES_AGENT_DIR / "hermes_cli" / "web_dist"))

_GIT_BASH = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Git", "bin", "bash.exe")
if os.path.isfile(_GIT_BASH):
    os.environ.setdefault("HERMES_GIT_BASH_PATH", _GIT_BASH)

_SUPPORTED_LOCALES = (
    "zh", "en", "zh-hant", "ja", "de", "es", "fr",
    "tr", "uk", "af", "ko", "it", "ga", "pt", "ru", "hu",
)


def _ensure_webview():
    try:
        import webview
        return webview
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pywebview", "-i", "https://mirrors.aliyun.com/pypi/simple/", "--trusted-host", "mirrors.aliyun.com"])
        import webview
        return webview


def _ensure_web_deps():
    try:
        import fastapi
        import uvicorn
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn[standard]", "-i", "https://mirrors.aliyun.com/pypi/simple/", "--trusted-host", "mirrors.aliyun.com"])


def _check_web_dist():
    web_dist = Path(os.environ.get("HERMES_WEB_DIST", HERMES_AGENT_DIR / "hermes_cli" / "web_dist"))
    if not web_dist.is_dir() or not (web_dist / "index.html").exists():
        import subprocess
        web_dir = HERMES_AGENT_DIR / "web"
        if not (web_dir / "package.json").exists():
            raise SystemExit(f"Web source not found at {web_dir}")
        if not (web_dir / "node_modules").is_dir():
            subprocess.check_call(["npm", "install"], cwd=str(web_dir), shell=True)
        subprocess.check_call(["npm", "run", "build"], cwd=str(web_dir), shell=True)


_CHAT_OVERLAY_JS_PATH = _DESKTOP_DIR / "_chat_overlay.js"
_CHAT_OVERLAY_MODULES = [
    "_attach_to_ai.js",
    "_editor_panel.js",
    "_file_manager.js",
    "_notepad.js",
    "_clipboard_translate.js",
    "_stock_sidebar.js",
    "_obsidian_vault.js",
]
_chat_overlay_injected = False


def _load_chat_overlay_js():
    modules_code = []
    for mod_name in _CHAT_OVERLAY_MODULES:
        mod_path = _DESKTOP_DIR / mod_name
        if mod_path.exists():
            modules_code.append(mod_path.read_text(encoding="utf-8"))
    modules_str = "\n".join(modules_code)

    main_js = _CHAT_OVERLAY_JS_PATH.read_text(encoding="utf-8") if _CHAT_OVERLAY_JS_PATH.exists() else ""
    result = main_js.replace("    // ── MODULES ──", modules_str)

    return result


def _inject_chat_overlay():
    global _chat_overlay_injected
    if _chat_overlay_injected:
        return
    _chat_overlay_injected = True

    _js_content = _load_chat_overlay_js()

    from starlette.types import ASGIApp, Receive, Scope, Send

    class _ChatInjectMiddleware:
        def __init__(self, app: ASGIApp):
            self.app = app

        async def __call__(self, scope: Scope, receive: Receive, send: Send):
            if scope["type"] != "http":
                await self.app(scope, receive, send)
                return

            request_path = scope.get("path", "")

            if request_path.startswith("/api/"):
                await self.app(scope, receive, send)
                return

            if not _js_content:
                await self.app(scope, receive, send)
                return

            async def _inject(send):
                send_original = send
                body_chunks = []

                async def _send_with_inject(message):
                    if message["type"] == "http.response.start":
                        status = message.get("status", 200)
                        headers = message.get("headers", [])
                        content_type = b""
                        for hk, hv in headers:
                            if hk.lower() == b"content-type":
                                content_type = hv
                                break
                        if status == 200 and (b"text/html" in content_type or content_type == b""):
                            _send_with_inject._is_html = True
                            _send_with_inject._status = status
                            _send_with_inject._headers = [
                                (k, v) for k, v in headers
                                if k.lower() not in (b"content-length", b"cache-control", b"pragma", b"etag", b"last-modified")
                            ] + [
                                (b"cache-control", b"no-cache, no-store, must-revalidate"),
                                (b"pragma", b"no-cache"),
                            ]
                            return
                        _send_with_inject._is_html = False
                        await send_original(message)
                    elif message["type"] == "http.response.body":
                        body = message.get("body", b"")
                        more = message.get("more_body", False)
                        if getattr(_send_with_inject, '_is_html', False):
                            body_chunks.append(body)
                            if not more:
                                full_body = b"".join(body_chunks)
                                _js_bytes = _js_content.encode("utf-8")
                                _inject_tag = (
                                    b'<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">'
                                    b'<meta http-equiv="Pragma" content="no-cache">'
                                    b'<meta http-equiv="Expires" content="0">'
                                    b"<script>try{localStorage.setItem('hermes-locale','zh');localStorage.setItem('hermes-sidebar-collapsed','true')}catch(e){}</script>"
                                    + b"<script>" + _js_bytes + b"</script></body>"
                                )
                                if full_body.rstrip().endswith(b"</body>"):
                                    idx = full_body.rindex(b"</body>")
                                    full_body = full_body[:idx] + _inject_tag
                                else:
                                    full_body = full_body + _inject_tag
                                new_headers = _send_with_inject._headers + [
                                    (b"content-length", str(len(full_body)).encode()),
                                ]
                                await send_original({
                                    "type": "http.response.start",
                                    "status": _send_with_inject._status,
                                    "headers": new_headers,
                                })
                                await send_original({
                                    "type": "http.response.body",
                                    "body": full_body,
                                })
                            return
                        await send_original(message)

                await self.app(scope, receive, _send_with_inject)

            await _inject(send)

    import hermes_cli.web_server as ws
    ws.app.add_middleware(_ChatInjectMiddleware)


def _add_web_proxy():
    pass


_gateway_proc = None


def _find_hermes_python():
    venv_python = HERMES_AGENT_DIR / "venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        return str(venv_python)
    return sys.executable


def _start_gateway():
    global _gateway_proc
    hermes_python = _find_hermes_python()
    try:
        result = subprocess.run(
            [hermes_python, "-m", "hermes_cli", "gateway", "status"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return
    except Exception:
        pass

    _gateway_proc = subprocess.Popen(
        [hermes_python, "-m", "hermes_cli", "gateway", "run", "--replace"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    time.sleep(2.0)


def _register_rpc_methods():
    import importlib
    gw = importlib.import_module("tui_gateway.server")

    from _rpc_fs import register as register_fs
    register_fs(gw)

    from _rpc_stock import register as register_stock
    register_stock(gw)

    from _rpc_config import register as register_config
    register_config(gw)

    from _rpc_notepad import register as register_notepad
    register_notepad(gw)

    from _rpc_obsidian import register as register_obsidian
    register_obsidian(gw)


def _refresh_skills_cache():
    from pathlib import Path
    hermes_home = Path(
        __import__("os").environ.get("HERMES_HOME")
        or str(Path.home() / ".hermes")
    )

    snapshot = hermes_home / ".skills_prompt_snapshot.json"
    try:
        snapshot.unlink(missing_ok=True)
    except OSError:
        pass

    try:
        from agent.prompt_builder import clear_skills_system_prompt_cache
        clear_skills_system_prompt_cache(clear_snapshot=True)
    except Exception:
        pass


def _sync_skill():
    """Sync desktop skills from desktop/skill/ to skills/desktop/ if different."""
    src_dir = _DESKTOP_DIR / "skill"
    if not src_dir.is_dir():
        return

    dst_dir = HERMES_BASE_DIR / "skills" / "desktop"

    # Remove old desktop-sidebar if it exists
    old_dir = dst_dir / "desktop-sidebar"
    if old_dir.is_dir():
        import shutil
        try:
            shutil.rmtree(old_dir)
        except OSError:
            pass

    # Sync DESCRIPTION.md
    changed = False
    src_desc = src_dir / "DESCRIPTION.md"
    if src_desc.is_file():
        dst_desc = dst_dir / "DESCRIPTION.md"
        need_copy = False
        if not dst_desc.exists():
            need_copy = True
        else:
            try:
                if dst_desc.read_text(encoding="utf-8") != src_desc.read_text(encoding="utf-8"):
                    need_copy = True
            except OSError:
                need_copy = True
        
        if need_copy:
            dst_desc.parent.mkdir(parents=True, exist_ok=True)
            import shutil
            shutil.copy2(str(src_desc), str(dst_desc))
            changed = True

    # Sync each skill subdirectory
    for skill_dir in src_dir.iterdir():
        if not skill_dir.is_dir():
            continue
        
        skill_name = skill_dir.name
        src_skill_file = skill_dir / "SKILL.md"
        
        if not src_skill_file.is_file():
            continue
        
        dst_skill_dir = dst_dir / skill_name
        dst_skill_file = dst_skill_dir / "SKILL.md"
        
        need_copy = False
        if not dst_skill_file.exists():
            need_copy = True
        else:
            try:
                if dst_skill_file.read_text(encoding="utf-8") != src_skill_file.read_text(encoding="utf-8"):
                    need_copy = True
            except OSError:
                need_copy = True
        
        if need_copy:
            dst_skill_file.parent.mkdir(parents=True, exist_ok=True)
            import shutil
            shutil.copy2(str(src_skill_file), str(dst_skill_file))
            changed = True

    if changed:
        _refresh_skills_cache()


def start_desktop(
    host: str = "127.0.0.1",
    port: int = 9119,
    *,
    width: int = 1200,
    height: int = 800,
    locale: str = "zh",
):
    _ensure_web_deps()
    _check_web_dist()

    _start_gateway()
    _inject_chat_overlay()
    _add_web_proxy()
    _sync_skill()
    _register_rpc_methods()

    from hermes_cli.web_server import start_server

    server_started = threading.Event()

    def _run_server():
        server_started.set()
        start_server(host=host, port=port, open_browser=False, embedded_chat=True)

    server_thread = threading.Thread(target=_run_server, daemon=True, name="hermes-dashboard")
    server_thread.start()
    server_started.wait(timeout=5)
    time.sleep(1.0)

    webview = _ensure_webview()
    url = f"http://{host}:{port}"
    window = webview.create_window(
        title="Hermes Agent",
        url=url,
        width=width,
        height=height,
        min_size=(800, 600),
    )

    _locale_adjusted = threading.Event()

    def _on_loaded():
        if not _locale_adjusted.is_set():
            _locale_adjusted.set()
        window.evaluate_js(
            "(function(){"
            "if(window.__hdcov){"
            "var ovl=document.getElementById('hdc-overlay');"
            "if(ovl){ovl.style.display='flex';}"
            "}"
            "})();"
        )

    window.events.loaded += _on_loaded
    webview.start(debug=False, http_server=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hermes Agent — Desktop UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9119)
    parser.add_argument("--width", type=int, default=1200)
    parser.add_argument("--height", type=int, default=800)
    parser.add_argument("--lang", default="zh", choices=_SUPPORTED_LOCALES)
    args = parser.parse_args()

    start_desktop(
        host=args.host, port=args.port,
        width=args.width, height=args.height,
        locale=args.lang,
    )
