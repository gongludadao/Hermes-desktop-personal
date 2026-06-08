import os
import json
from pathlib import Path


_OBSIDIAN_CONFIG = Path(__file__).parent.resolve() / "cache" / "obsidian_config.json"


def _ensure_config():
    if not _OBSIDIAN_CONFIG.exists():
        _OBSIDIAN_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        _OBSIDIAN_CONFIG.write_text(json.dumps({"active_vault": None}), encoding="utf-8")


def register(gw):
    _ensure_config()

    def _obsidian_get_active(rid, params):
        try:
            config = json.loads(_OBSIDIAN_CONFIG.read_text(encoding="utf-8"))
            path = config.get("active_vault")
            # 验证路径是否存在
            if path and os.path.isdir(path):
                return gw._ok(rid, {"path": path})
            else:
                return gw._ok(rid, {"path": None})
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
            # Sort: dirs first, then files, both alphabetically
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
        # 选择 Vault，弹出系统目录选择器
        # 这里只记录提示，具体 UI 由前端处理
        return gw._ok(rid, {"show_selector": True})

    import time
    gw._methods["obsidian.get_active"] = _obsidian_get_active
    gw._methods["obsidian.set_vault"] = _obsidian_set_vault
    gw._methods["obsidian.list_files"] = _obsidian_list_files
    gw._methods["obsidian.read_note"] = _obsidian_read_note
    gw._methods["obsidian.update_note"] = _obsidian_update_note
    gw._methods["obsidian.create_note"] = _obsidian_create_note
    gw._methods["obsidian.delete_note"] = _obsidian_delete_note
    gw._methods["obsidian.select_vault"] = _obsidian_select_vault


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
