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
                """按文件路径独立防抖：同一文件短时间连续变化合并为一次推送，不同文件互不干扰
                前端 _event_bus.js 已有各模块独立防抖，后端仅做最小合并避免重复推送"""
                def __init__(self, watcher: "_VaultWatcher"):
                    self.watcher = watcher
                    self._timers = {}          # path -> Timer
                    self._lock = __import__('threading').Lock()
                def _schedule_push(self, path: str):
                    src = path.replace("\\", "/")
                    name = os.path.basename(src)
                    if name.startswith(".") or name.endswith((".tmp", ".swp")):
                        return
                    with self._lock:
                        # 取消该文件之前的定时器，重置为 trailing edge
                        old = self._timers.get(src)
                        if old is not None:
                            old.cancel()
                        t = __import__('threading').Timer(0.1, self._do_push, args=(src,))
                        t.daemon = True
                        self._timers[src] = t
                        t.start()
                def _do_push(self, src):
                    with self._lock:
                        self._timers.pop(src, None)
                    with self.watcher._lock:
                        self.watcher._version += 1
                    _broadcast.push_event("obsidian.vault_changed", {"version": self.watcher._version, "src_path": src})
                    # 通知 embedding 模块做增量索引更新
                    try:
                        import _rpc_embedding
                        _rpc_embedding.notify_file_changed(src)
                    except Exception:
                        pass
                def on_created(self, e):
                    self._schedule_push(e.src_path)
                def on_deleted(self, e):
                    self._schedule_push(e.src_path)
                def on_moved(self, e):
                    # 原子写入（Obsidian）：写临时文件 → 重命名为目标文件
                    # 此时 src_path 是临时文件，dest_path 才是真正的文件
                    if e.dest_path:
                        self._schedule_push(e.dest_path)
                def on_modified(self, e):
                    self._schedule_push(e.src_path)

            self._observer = Observer()
            self._observer.schedule(_Handler(self), native_path, recursive=True)
            self._observer.start()

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
            # 获取旧 vault 路径（用于前端关闭旧标签等）
            old_path = None
            if _OBSIDIAN_CONFIG.exists():
                try:
                    old_config = json.loads(_OBSIDIAN_CONFIG.read_text(encoding="utf-8"))
                    old_path = old_config.get("active_vault")
                except Exception:
                    pass

            _OBSIDIAN_CONFIG.parent.mkdir(parents=True, exist_ok=True)
            config = json.loads(_OBSIDIAN_CONFIG.read_text(encoding="utf-8"))
            config["active_vault"] = path
            config["last_switched"] = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(_OBSIDIAN_CONFIG, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            _vault_watcher.start_watching(path)

            # 清除 embedding 索引缓存，强制新 vault 重建索引
            try:
                import _rpc_embedding
                _rpc_embedding.reset_on_vault_switch()
            except Exception:
                pass

            # 推送 vault_switched 事件，通知前端各模块刷新
            _broadcast.push_event("obsidian.vault_switched", {"path": path, "old_path": old_path})
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

    # ── Todo 扫描 ──
    import re as _re

    def _find_todo_file(vault):
        """在 vault 中递归查找 待办事项.md，返回 (Path, relative_path)"""
        vault_p = Path(vault)
        # 先检查根目录
        root_file = vault_p / "待办事项.md"
        if root_file.exists():
            return root_file, "待办事项.md"
        # 递归搜索
        for f in sorted(vault_p.rglob("待办事项.md")):
            rel = str(f.relative_to(vault_p).as_posix())
            return f, rel
        return None, None

    def _obsidian_scan_todos(rid, params):
        """从 vault 中查找 待办事项.md，读取 --- 分割线之间的待办内容"""
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._ok(rid, {"todos": [], "todo_relpath": None})
        todo_file, rel_path = _find_todo_file(active_vault)
        if not todo_file:
            return gw._ok(rid, {"todos": [], "todo_relpath": None})
        todos = []
        abs_path = str(todo_file.resolve()).replace("\\", "/")
        try:
            content = todo_file.read_text("utf-8", errors="replace")
        except Exception:
            return gw._ok(rid, {"todos": [], "todo_relpath": rel_path})
        # 逐行扫描，只取 --- 分割线之间的内容（标记实际行号）
        all_lines = content.split("\n")
        in_section = False
        section_enter_at = 0
        for i, line in enumerate(all_lines, 1):
            stripped = line.strip()
            # 检测 --- 分割线（单独一行）
            if _re.match(r"^-{3,}\s*$", stripped):
                # 跳过文件首行的 ---（Obsidian frontmatter 开始标记）
                if i == 1:
                    continue
                in_section = not in_section
                if in_section:
                    section_enter_at = i
                continue
            if not in_section:
                continue
            m = _re.match(r"^\s*-\s+\[([ xX])\]\s+(.+)$", line)
            if m:
                done = m.group(1) in ("x", "X")
                text = m.group(2).strip()
                todos.append({
                    "path": rel_path,
                    "absPath": abs_path,
                    "line": i,
                    "text": text,
                    "done": done,
                })
        return gw._ok(rid, {"todos": todos, "todo_relpath": rel_path})

    def _obsidian_toggle_todo(rid, params):
        """切换待办事项.md 中某个待办的完成状态"""
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._err(rid, 4004, "no vault configured")
        todo_file, _ = _find_todo_file(active_vault)
        if not todo_file:
            return gw._err(rid, 4004, "待办事项.md not found")
        line_no = int(params.get("line", 0))
        done = bool(params.get("done", False))
        try:
            lines = todo_file.read_text("utf-8", errors="replace").split("\n")
        except Exception as e:
            return gw._err(rid, 5000, str(e))
        if line_no < 1 or line_no > len(lines):
            return gw._err(rid, 4000, f"line {line_no} out of range")
        old = lines[line_no - 1]
        if done:
            new = _re.sub(r"-\s+\[[ xX]\]", "- [x]", old, count=1)
        else:
            new = _re.sub(r"-\s+\[[ xX]\]", "- [ ]", old, count=1)
        if new == old:
            return gw._ok(rid, {"changed": False})
        lines[line_no - 1] = new
        todo_file.write_text("\n".join(lines), "utf-8")
        return gw._ok(rid, {"changed": True})

    def _obsidian_add_todo(rid, params):
        """在待办事项.md 的分割线之间添加一条新的待办"""
        text = str(params.get("text", "")).strip()
        if not text:
            return gw._err(rid, 4000, "todo text required")
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._err(rid, 4004, "no vault configured")
        todo_file, rel_path = _find_todo_file(active_vault)
        if not todo_file:
            return gw._err(rid, 4004, "待办事项.md not found")
        content = todo_file.read_text("utf-8", errors="replace")
        # 在第一个 --- 分割线后插入新待办
        # 找到第一个 --- 的位置
        idx = content.find("\n---")
        if idx == -1:
            # 没有分割线，直接在末尾插入
            new_line = f"\n---\n- [ ] {text}\n---\n"
            content += new_line
        else:
            # 在第一个 --- 后面插入
            after_divider = idx + 4  # 跳过 \n---
            # 检查是否有第二个 ---
            second = content.find("\n---", after_divider)
            if second == -1:
                # 没有第二个分割线，创建一个新区域
                new_line = f"\n- [ ] {text}\n---\n"
            else:
                # 在第一个和第二个分割线之间插入
                before_second = content[:second]
                after_second = content[second:]
                new_line = f"- [ ] {text}\n"
                content = before_second + new_line + after_second
                todo_file.write_text(content, "utf-8")
                return gw._ok(rid, {"added": True, "relpath": rel_path})
            content += new_line
        todo_file.write_text(content, "utf-8")
        return gw._ok(rid, {"added": True, "relpath": rel_path})

    def _obsidian_delete_todo_line(rid, params):
        """删除待办事项.md 中指定行的内容"""
        active_vault = _get_active_vault()
        if not active_vault:
            return gw._err(rid, 4004, "no vault configured")
        todo_file, _ = _find_todo_file(active_vault)
        if not todo_file:
            return gw._err(rid, 4004, "待办事项.md not found")
        line_no = int(params.get("line", 0))
        try:
            lines = todo_file.read_text("utf-8", errors="replace").split("\n")
        except Exception as e:
            return gw._err(rid, 5000, str(e))
        if line_no < 1 or line_no > len(lines):
            return gw._err(rid, 4000, f"line {line_no} out of range")
        old_text = lines[line_no - 1]
        # 检查该行是否真的是待办项（防止误删非待办行）
        if not _re.match(r"^\s*-\s+\[[ xX]\]", old_text):
            return gw._err(rid, 4000, "line is not a todo item")
        del lines[line_no - 1]
        todo_file.write_text("\n".join(lines), "utf-8")
        return gw._ok(rid, {"deleted": True})

    gw._methods["obsidian.scan_todos"] = _obsidian_scan_todos
    gw._methods["obsidian.toggle_todo"] = _obsidian_toggle_todo
    gw._methods["obsidian.add_todo"] = _obsidian_add_todo
    gw._methods["obsidian.delete_todo_line"] = _obsidian_delete_todo_line

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
