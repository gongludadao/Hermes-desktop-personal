"""
Obsidian vault RPC — watchdog passive file monitoring.
"""

import os
import json
import time
import threading
from pathlib import Path
from typing import Optional


_OBSIDIAN_CONFIG = Path(__file__).parent.resolve() / "cache" / "obsidian_config.json"


import _broadcast


class _VaultWatcher:
    """Watchdog-based passive file monitor for vault directory."""

    def __init__(self):
        self._observer = None
        self._version = 0
        self._lock = threading.Lock()
        self._watch_path: Optional[str] = None

    def start_watching(self, vault_path: str) -> None:
        self.stop_watching()
        if not vault_path or not os.path.isdir(vault_path):
            return

        # Windows 需要反斜杠路径，Watchdog 才能正常工作
        native_path = os.path.normpath(vault_path)
        self._watch_path = native_path.replace("\\", "/")  # 内部统一用正斜杠
        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler

            class _Handler(FileSystemEventHandler):
                def __init__(self, watcher: "_VaultWatcher"):
                    self.watcher = watcher
                    import time as _time
                    self._last_push = 0
                def _inc(self, event):
                    import time as _time
                    now = _time.time()
                    # 去抖：2000ms 内不重复推送（防止系统进程在读取文件时触发 on_modified）
                    if now - self._last_push < 2.0:
                        return
                    self._last_push = now
                    src = event.src_path.replace("\\", "/")
                    name = os.path.basename(src)
                    if name.startswith(".") or name.endswith((".tmp", ".swp")):
                        return
                    with self.watcher._lock:
                        self.watcher._version += 1
                    _broadcast.push_event("obsidian.vault_changed", {"version": self.watcher._version})
                def on_created(self, e):   self._inc(e)
                def on_deleted(self, e):    self._inc(e)
                def on_moved(self, e):
                    if e.dest_path:
                        self._inc(e)

            self._observer = Observer()
            self._observer.schedule(_Handler(self), native_path, recursive=True)
            self._observer.start()
            print(f"[ObsVault] watchdog 监控已启动：{native_path}")

        except ImportError:
            print("[ObsVault] watchdog 未安装，无法监控")
        except Exception as exc:
            print(f"[ObsVault] watchdog 启动失败: {exc}")

    def stop_watching(self) -> None:
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=2)
            except Exception:
                pass
            self._observer = None
        self._watch_path = None

    @property
    def version(self) -> int:
        with self._lock:
            return self._version


_vault_watcher = _VaultWatcher()


def _ensure_config():
    if not _OBSIDIAN_CONFIG.exists():
        _OBSIDIAN_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        _OBSIDIAN_CONFIG.write_text(json.dumps({"active_vault": None}), encoding="utf-8")


def register(gw):
    _broadcast.init(gw)
    _ensure_config()

    def _obsidian_get_active(rid, params):
        try:
            config = json.loads(_OBSIDIAN_CONFIG.read_text(encoding="utf-8"))
            path = config.get("active_vault")
            return gw._ok(rid, {"path": path if path and os.path.isdir(path) else None})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _obsidian_set_vault(rid, params):
        path = params.get("path")
        if not path:
            return gw._err(rid, 4000, "path required")
        if not os.path.isdir(path):
            return gw._err(rid, 4004, f"directory not found: {path}")
        try:
            _OBSIDIAN_CONFIG.parent.mkdir(parents=True, exist_ok=True)
            config = json.loads(_OBSIDIAN_CONFIG.read_text(encoding="utf-8"))
            config["active_vault"] = path
            config["last_switched"] = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(_OBSIDIAN_CONFIG, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            _vault_watcher.start_watching(path)
            return gw._ok(rid, {"success": True, "path": path})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _obsidian_list_files(rid, params):
        path = params.get("path", "")
        if not path or not os.path.isdir(path):
            return gw._err(rid, 4004, f"directory not found: {path}")
        try:
            items = []
            for entry in os.scandir(path):
                try:
                    stat = entry.stat()
                    items.append({
                        "name": entry.name,
                        "path": entry.path.replace("\\", "/"),
                        "is_dir": entry.is_dir(),
                        "size": stat.st_size if not entry.is_dir() else 0,
                        "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
                    })
                except OSError:
                    continue
            items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
            return gw._ok(rid, {"items": items})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _obsidian_read_note(rid, params):
        note_id = str(params.get("id", "")).strip()
        if not note_id:
            return gw._err(rid, 4000, "id required")
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._err(rid, 4004, "no vault configured")
        note_path = os.path.join(active_vault, note_id + ".md")
        if not os.path.isfile(note_path):
            return gw._err(rid, 4004, f"note not found: {note_id}")
        content = Path(note_path).read_text(encoding="utf-8")
        return gw._ok(rid, {"id": note_id, "title": note_id, "content": content})

    def _obsidian_update_note(rid, params):
        note_id = str(params.get("id", "")).strip()
        content = str(params.get("content", ""))
        if not note_id:
            return gw._err(rid, 4000, "id required")
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._err(rid, 4004, "no vault configured")
        note_path = os.path.join(active_vault, note_id + ".md")
        if not os.path.isfile(note_path):
            return gw._err(rid, 4004, f"note not found: {note_id}")
        Path(note_path).write_text(content, encoding="utf-8")
        return gw._ok(rid, {"id": note_id, "title": note_id})

    def _obsidian_create_note(rid, params):
        title = str(params.get("title", "")).strip()
        content = str(params.get("content", ""))
        if not title:
            title = "Untitled"
        safe = _safe_filename(title)
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._err(rid, 4004, "no vault configured")
        note_path = Path(active_vault) / (safe + ".md")
        counter = 1
        while note_path.exists():
            note_path = Path(active_vault) / (safe + "_%d.md" % counter)
            counter += 1
        note_path.write_text(content, encoding="utf-8")
        return gw._ok(rid, {"id": note_path.stem, "title": note_path.stem})

    def _obsidian_delete_note(rid, params):
        note_id = str(params.get("id", "")).strip()
        if not note_id:
            return gw._err(rid, 4000, "id required")
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._err(rid, 4004, "no vault configured")
        note_path = Path(active_vault) / (note_id + ".md")
        if not note_path.exists():
            return gw._err(rid, 4004, f"note not found: {note_id}")
        note_path.unlink()
        return gw._ok(rid, {"id": note_id})

    def _obsidian_select_vault(rid, params):
        return gw._ok(rid, {"show_selector": True})

    def _obsidian_get_vault_version(rid, params):
        ver = _vault_watcher.version
        print(f"[ObsVault] 查询版本号: {ver}, watch_path={_vault_watcher._watch_path}")
        return gw._ok(rid, {"version": ver})

    gw._methods["obsidian.get_active"] = _obsidian_get_active
    gw._methods["obsidian.set_vault"] = _obsidian_set_vault
    gw._methods["obsidian.list_files"] = _obsidian_list_files
    gw._methods["obsidian.read_note"] = _obsidian_read_note
    gw._methods["obsidian.update_note"] = _obsidian_update_note
    gw._methods["obsidian.create_note"] = _obsidian_create_note
    gw._methods["obsidian.delete_note"] = _obsidian_delete_note
    gw._methods["obsidian.select_vault"] = _obsidian_select_vault
    gw._methods["obsidian.get_vault_version"] = _obsidian_get_vault_version

    # 自动启动对已配置 vault 的监控
    active = _get_active_vault()
    if active:
        _vault_watcher.start_watching(active)


def _get_active_vault():
    if not _OBSIDIAN_CONFIG.exists():
        return None
    try:
        config = json.loads(_OBSIDIAN_CONFIG.read_text(encoding="utf-8"))
        return config.get("active_vault")
    except:
        return None


def _safe_filename(title):
    keep = (" ", "-", "_", ".")
    return "".join(c if c.isalnum() or c in keep else "_" for c in title).strip("_ .")[:80]
