import os
import time
import json
from pathlib import Path

_NOTEPAD_DIR = Path(__file__).parent.resolve() / "notepad"
_CACHE_DIR = Path(__file__).parent.resolve() / "cache"
_INDEX_PATH = _CACHE_DIR / "notepad_index.json"


def _ensure_dir():
    _NOTEPAD_DIR.mkdir(parents=True, exist_ok=True)
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _safe_filename(title):
    keep = (" ", "-", "_", ".")
    return "".join(c if c.isalnum() or c in keep else "_" for c in title).strip("_ .")[:80]


def _find_note(note_id):
    safe = _safe_filename(note_id)
    md = _NOTEPAD_DIR / (safe + ".md")
    if md.is_file():
        return md
    txt = _NOTEPAD_DIR / (safe + ".txt")
    if txt.is_file():
        return txt
    return None


def _write_index():
    files = sorted(
        [f for f in _NOTEPAD_DIR.iterdir() if f.suffix in (".md", ".txt") and f.is_file()],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    items = []
    for fp in files:
        stat = fp.stat()
        items.append({
            "id": fp.stem,
            "title": fp.stem,
            "path": str(fp),
            "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
            "size": stat.st_size,
        })
    data = {"notes": items, "total": len(items), "updated_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    _INDEX_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def register(gw):
    _ensure_dir()
    _write_index()

    def _notepad_list(rid, params):
        limit = int(params.get("limit", 50))
        files = sorted(
            [f for f in _NOTEPAD_DIR.iterdir() if f.suffix in (".md", ".txt") and f.is_file()],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        items = []
        for fp in files[:limit]:
            title = fp.stem
            stat = fp.stat()
            items.append({
                "id": title,
                "title": title,
                "path": str(fp),
                "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
                "size": stat.st_size,
            })
        return gw._ok(rid, {"notes": items, "total": len(files)})

    def _notepad_read(rid, params):
        note_id = str(params.get("id", "")).strip()
        if not note_id:
            return gw._err(rid, 4000, "id is required")
        fp = _find_note(note_id)
        if not fp:
            return gw._err(rid, 4004, "note not found")
        content = fp.read_text(encoding="utf-8")
        stat = fp.stat()
        return gw._ok(rid, {
            "id": note_id,
            "title": note_id,
            "path": str(fp),
            "content": content,
            "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
        })

    def _notepad_create(rid, params):
        title = str(params.get("title", "")).strip()
        content = str(params.get("content", ""))
        if not title:
            title = time.strftime("%Y%m%d_%H%M%S")
        safe = _safe_filename(title)
        fp = _NOTEPAD_DIR / (safe + ".md")
        counter = 1
        while fp.exists():
            fp = _NOTEPAD_DIR / (safe + "_%d.md" % counter)
            counter += 1
        fp.write_text(content, encoding="utf-8")
        _write_index()
        return gw._ok(rid, {"id": fp.stem, "title": fp.stem})

    def _notepad_update(rid, params):
        note_id = str(params.get("id", "")).strip()
        content = str(params.get("content", ""))
        if not note_id:
            return gw._err(rid, 4000, "id is required")
        fp = _find_note(note_id)
        if not fp:
            return gw._err(rid, 4004, "note not found")
        if fp.suffix == ".txt":
            new_fp = fp.with_suffix(".md")
            fp.rename(new_fp)
            fp = new_fp
        fp.write_text(content, encoding="utf-8")
        _write_index()
        return gw._ok(rid, {"id": note_id, "title": note_id})

    def _notepad_rename(rid, params):
        note_id = str(params.get("id", "")).strip()
        new_title = str(params.get("title", "")).strip()
        if not note_id or not new_title:
            return gw._err(rid, 4000, "id and title are required")
        old_fp = _find_note(note_id)
        if not old_fp:
            return gw._err(rid, 4004, "note not found")
        new_fp = _NOTEPAD_DIR / (_safe_filename(new_title) + ".md")
        if new_fp.exists() and new_fp != old_fp:
            return gw._err(rid, 4009, "title already exists")
        old_fp.rename(new_fp)
        _write_index()
        return gw._ok(rid, {"id": new_fp.stem, "title": new_fp.stem})

    def _notepad_delete(rid, params):
        note_id = str(params.get("id", "")).strip()
        if not note_id:
            return gw._err(rid, 4000, "id is required")
        fp = _find_note(note_id)
        if not fp:
            return gw._err(rid, 4004, "note not found")
        fp.unlink()
        _write_index()
        return gw._ok(rid, {"id": note_id})

    gw._methods["notepad.list"] = _notepad_list
    gw._methods["notepad.read"] = _notepad_read
    gw._methods["notepad.create"] = _notepad_create
    gw._methods["notepad.update"] = _notepad_update
    gw._methods["notepad.rename"] = _notepad_rename
    gw._methods["notepad.delete"] = _notepad_delete
