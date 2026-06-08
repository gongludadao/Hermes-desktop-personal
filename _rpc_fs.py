from pathlib import Path


def register(gw):
    """Register all file-system RPC handlers."""

    _CACHE_DIR = Path(__file__).parent.resolve() / "cache"
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _CLIPBOARD_CACHE_PATH = _CACHE_DIR / "clipboard_cache.json"
    _PROJECT_CACHE_PATH = _CACHE_DIR / "project_index.json"

    def _write_clipboard_cache():
        # 注意：调用者必须持有 _clipboard_history_lock
        import json as _json
        items = []
        for h in _clipboard_history[:10]:
            text = h.get("text", "")
            # ✅ 移除预览限制，显示完整内容
            preview = text.replace("\n", " ")
            # 保存完整的 text 字段，以便前端恢复时使用
            items.append({"text": text, "preview": preview, "time": h.get("time", "")})
        data = {"history": items, "total": len(items), "updated_at": __import__("time").strftime("%Y-%m-%d %H:%M:%S")}
        _CLIPBOARD_CACHE_PATH.write_text(_json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _build_tree(path, max_depth=3, depth=0):
        import os as _os
        if depth >= max_depth:
            return None
        try:
            children = []
            for child in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if child.name.startswith('.') and child.name not in ('.env', '.gitignore', '.git'):
                    continue
                if child.name in ('node_modules', '__pycache__', '.git', 'venv', '.venv', 'dist', 'build'):
                    children.append({"name": child.name, "is_dir": child.is_dir(), "size": 0, "children": None})
                    continue
                try:
                    if child.is_dir():
                        sub = _build_tree(child, max_depth, depth + 1)
                        children.append({"name": child.name, "is_dir": True, "size": 0, "children": sub})
                    else:
                        children.append({"name": child.name, "is_dir": False, "size": child.stat().st_size})
                except (PermissionError, OSError):
                    continue
            return children
        except (PermissionError, OSError):
            return None

    def _write_project_cache(project_path, items):
        import json as _json
        data = {
            "projectRoot": project_path,
            "items": items,
            "updated_at": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
        }
        _PROJECT_CACHE_PATH.write_text(_json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _refresh_project_cache():
        import json as _json
        if not _PROJECT_CACHE_PATH.exists():
            return
        try:
            data = _json.loads(_PROJECT_CACHE_PATH.read_text(encoding="utf-8"))
            root = data.get("projectRoot")
            if not root:
                return
            p = Path(root).resolve()
            if not p.exists():
                return
            tree = _build_tree(p)
            _write_project_cache(str(p), tree or [])
        except Exception:
            pass

    def _fs_stat(rid, params):
        from pathlib import Path as _Path
        file_path = (params or {}).get("path", "")
        if not file_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(file_path).resolve()
            if not p.exists():
                return gw._err(rid, 4003, "未找到")
            return gw._ok(rid, {"path": str(p), "name": p.name, "is_dir": p.is_dir(), "is_file": p.is_file()})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_list_dir(rid, params):
        import os as _os
        from pathlib import Path as _Path
        dir_path = (params or {}).get("path", "")
        if not dir_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(dir_path).resolve()
            if not p.is_dir():
                return gw._err(rid, 4002, "不是目录")
            items = []
            for child in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if child.name.startswith('.') and child.name not in ('.env', '.gitignore', '.git'):
                    continue
                try:
                    st = child.stat()
                    items.append({
                        "name": child.name,
                        "path": str(child),
                        "is_dir": child.is_dir(),
                        "size": st.st_size if not child.is_dir() else 0,
                    })
                except (PermissionError, OSError):
                    continue
            return gw._ok(rid, {"items": items, "path": str(p)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_read_file(rid, params):
        import base64 as _base64
        from pathlib import Path as _Path
        file_path = (params or {}).get("path", "")
        if not file_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(file_path).resolve()
            if p.is_dir():
                items = []
                for child in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                    if child.name.startswith('.') and child.name not in ('.env', '.gitignore', '.git'):
                        continue
                    try:
                        items.append({"name": child.name, "is_dir": child.is_dir(), "size": child.stat().st_size if not child.is_dir() else 0})
                    except (PermissionError, OSError):
                        continue
                return gw._ok(rid, {"content_type": "directory", "items": items, "path": str(p), "name": p.name})
            if not p.is_file():
                return gw._err(rid, 4003, "不是文件")
            # ✅ 移除文件大小限制
            img_exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'}
            pdf_exts = {'.pdf'}
            audio_exts = {'.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'}
            video_exts = {'.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v'}
            doc_exts = {'.docx', '.doc'}
            sheet_exts = {'.xlsx', '.xls', '.csv'}
            if p.suffix.lower() in img_exts:
                raw = p.read_bytes()
                content = _base64.b64encode(raw).decode('ascii')
                return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "image", "encoding": "base64"})
            if p.suffix.lower() in pdf_exts:
                raw = p.read_bytes()
                content = _base64.b64encode(raw).decode('ascii')
                return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "pdf", "encoding": "base64"})
            if p.suffix.lower() in audio_exts:
                raw = p.read_bytes()
                content = _base64.b64encode(raw).decode('ascii')
                return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "audio", "encoding": "base64", "ext": p.suffix.lower().lstrip('.')})
            if p.suffix.lower() in video_exts:
                raw = p.read_bytes()
                content = _base64.b64encode(raw).decode('ascii')
                return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "video", "encoding": "base64", "ext": p.suffix.lower().lstrip('.')})
            # ✅ 支持 Word 文档
            if p.suffix.lower() in doc_exts:
                try:
                    from docx import Document
                    doc = Document(str(p))
                    text_parts = []
                    for para in doc.paragraphs:
                        text_parts.append(para.text)
                    content = '\n'.join(text_parts)
                    return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "text", "ext": "md"})
                except ImportError:
                    return gw._err(rid, 5001, "需要安装 python-docx: pip install python-docx")
                except Exception as e:
                    return gw._err(rid, 5002, f"读取Word文档失败: {str(e)}")
            # ✅ 支持 Excel 和 CSV
            if p.suffix.lower() in sheet_exts:
                try:
                    import pandas as pd
                    if p.suffix.lower() == '.csv':
                        # ✅ 尝试多种编码和参数读取 CSV
                        encodings = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'latin-1']
                        df = None
                        last_error = None
                        for enc in encodings:
                            try:
                                # 先尝试自动检测分隔符和表头
                                df = pd.read_csv(str(p), encoding=enc, sep=None, engine='python', on_bad_lines='skip')
                                # 检查是否有表头（如果大部分列名是 Unnamed，说明没有表头）
                                unnamed_count = sum(1 for col in df.columns if str(col).startswith('Unnamed:'))
                                if unnamed_count > len(df.columns) * 0.5:
                                    # 重新读取，不使用表头
                                    df = pd.read_csv(str(p), encoding=enc, sep=None, engine='python', on_bad_lines='skip', header=None)
                                
                                # ✅ 检查是否适合用表格显示
                                # 1. 列数过多（超过20列）可能不是标准表格
                                # 2. 大部分值是nan（空值）说明格式不规范
                                if len(df.columns) > 20:
                                    # 列数过多，直接返回原始文本
                                    for enc2 in encodings:
                                        try:
                                            content = p.read_text(encoding=enc2)
                                            return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "text", "ext": "csv"})
                                        except UnicodeDecodeError:
                                            continue
                                
                                # 检查nan比例
                                total_cells = len(df) * len(df.columns)
                                nan_cells = df.isna().sum().sum()
                                if total_cells > 0 and nan_cells / total_cells > 0.7:
                                    # 70%以上是空值，直接返回原始文本
                                    for enc2 in encodings:
                                        try:
                                            content = p.read_text(encoding=enc2)
                                            return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "text", "ext": "csv"})
                                        except UnicodeDecodeError:
                                            continue
                                
                                if len(df) > 0:
                                    break
                            except Exception as e:
                                last_error = e
                                continue
                        if df is None or len(df) == 0:
                            # 如果 pandas 失败，尝试简单读取
                            try:
                                for enc in encodings:
                                    try:
                                        content = p.read_text(encoding=enc)
                                        break
                                    except UnicodeDecodeError:
                                        continue
                                return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "text", "ext": "csv"})
                            except Exception as e:
                                return gw._err(rid, 5002, f"读取CSV文件失败: {str(last_error or e)}")
                    else:
                        df = pd.read_excel(str(p))
                    # 转换为 Markdown 表格
                    content = df.to_markdown(index=False)
                    return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "text", "ext": "md"})
                except ImportError:
                    # 如果没有 pandas，尝试简单读取 CSV
                    if p.suffix.lower() == '.csv':
                        # ✅ 尝试多种编码
                        encodings = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'latin-1']
                        content = None
                        for enc in encodings:
                            try:
                                content = p.read_text(encoding=enc)
                                break
                            except UnicodeDecodeError:
                                continue
                        if content is None:
                            return gw._err(rid, 5002, "无法识别CSV文件编码")
                        return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "text", "ext": "csv"})
                    return gw._err(rid, 5001, "需要安装 pandas: pip install pandas openpyxl")
                except Exception as e:
                    return gw._err(rid, 5002, f"读取表格文件失败: {str(e)}")
            try:
                content = p.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                content = p.read_bytes().decode('latin-1')
            return gw._ok(rid, {"content": content, "path": str(p), "name": p.name, "content_type": "text"})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_write_file(rid, params):
        from pathlib import Path as _Path
        file_path = (params or {}).get("path", "")
        content = (params or {}).get("content", "")
        if not file_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(file_path).resolve()
            p.write_text(content, encoding='utf-8')
            # 推送文件变化事件到前端
            if _ws_transport is not None:
                try:
                    _ws_transport.write({
                        "jsonrpc": "2.0",
                        "method": "event",
                        "params": {
                            "type": "file.changed",
                            "payload": {"path": str(p)},
                        },
                    })
                except Exception:
                    pass
            return gw._ok(rid, {"path": str(p), "saved": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_create_file(rid, params):
        from pathlib import Path as _Path
        file_path = (params or {}).get("path", "")
        if not file_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(file_path).resolve()
            if p.exists():
                return gw._err(rid, 4005, "文件已存在")
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('', encoding='utf-8')
            _refresh_project_cache()
            return gw._ok(rid, {"path": str(p), "created": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_create_folder(rid, params):
        from pathlib import Path as _Path
        dir_path = (params or {}).get("path", "")
        if not dir_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(dir_path).resolve()
            if p.exists():
                return gw._err(rid, 4005, "文件夹已存在")
            p.mkdir(parents=True, exist_ok=True)
            _refresh_project_cache()
            return gw._ok(rid, {"path": str(p), "created": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_rename(rid, params):
        from pathlib import Path as _Path
        file_path = (params or {}).get("path", "")
        new_name = (params or {}).get("new_name", "")
        if not file_path or not new_name:
            return gw._err(rid, 4001, "缺少路径或新名称参数")
        try:
            p = _Path(file_path).resolve()
            if not p.exists():
                return gw._err(rid, 4003, "未找到")
            new_path = p.with_name(new_name)
            if new_path.exists():
                return gw._err(rid, 4005, "目标已存在")
            p.rename(new_path)
            _refresh_project_cache()
            return gw._ok(rid, {"path": str(new_path), "renamed": True})
        except PermissionError:
            return gw._err(rid, 5001, "权限不足，无法重命名")
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_delete(rid, params):
        from pathlib import Path as _Path
        import os as _os
        import shutil as _shutil
        import stat as _stat
        file_path = (params or {}).get("path", "")
        if not file_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(file_path).resolve()
            if not p.exists():
                return gw._err(rid, 4003, "未找到")
            if p.is_file():
                p.unlink()
            elif p.is_dir():
                def _onerror(func, path, exc_info):
                    _os.chmod(path, _stat.S_IWRITE)
                    func(path)
                _shutil.rmtree(p, onerror=_onerror)
            _refresh_project_cache()
            return gw._ok(rid, {"path": str(p), "deleted": True})
        except PermissionError:
            return gw._err(rid, 5001, "权限不足，无法删除")
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_select_folder(rid, params):
        import tkinter as _tk
        from tkinter import filedialog as _fd
        try:
            root = _tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            folder = _fd.askdirectory(title='选择项目文件夹')
            root.destroy()
            if folder:
                from pathlib import Path as _Path
                p = _Path(folder).resolve()
                try:
                    tree = _build_tree(p)
                    _write_project_cache(str(p), tree or [])
                except Exception:
                    pass
                return gw._ok(rid, {"path": str(p), "name": p.name})
            return gw._ok(rid, {"path": None, "cancelled": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_open_folder(rid, params):
        import os as _os
        import subprocess as _sp
        from pathlib import Path as _Path
        dir_path = (params or {}).get("path", "")
        if not dir_path:
            return gw._err(rid, 4001, "缺少路径参数")
        try:
            p = _Path(dir_path).resolve()
            if not p.exists():
                return gw._err(rid, 4003, "未找到")
            if not p.is_dir():
                p = p.parent if p.parent.exists() and p.parent.is_dir() else p
            if _os.name == 'nt':
                _os.startfile(str(p))
            elif _os.uname().sysname == 'Darwin':
                _sp.run(['open', str(p)])
            else:
                _sp.run(['xdg-open', str(p)])
            return gw._ok(rid, {"path": str(p), "opened": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_move(rid, params):
        import shutil as _shutil
        from pathlib import Path as _Path
        src = (params or {}).get("src", "")
        dst = (params or {}).get("dst", "")
        if not src or not dst:
            return gw._err(rid, 4001, "缺少源路径或目标路径")
        try:
            sp = _Path(src).resolve()
            dp = _Path(dst).resolve()
            if not sp.exists():
                return gw._err(rid, 4003, "源文件不存在")
            if dp.exists():
                return gw._err(rid, 4005, "目标已存在")
            dp.parent.mkdir(parents=True, exist_ok=True)
            _shutil.move(str(sp), str(dp))
            _refresh_project_cache()
            return gw._ok(rid, {"src": str(sp), "dst": str(dp), "moved": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_copy(rid, params):
        import shutil as _shutil
        from pathlib import Path as _Path
        src = (params or {}).get("src", "")
        dst = (params or {}).get("dst", "")
        if not src or not dst:
            return gw._err(rid, 4001, "缺少源路径或目标路径")
        try:
            sp = _Path(src).resolve()
            dp = _Path(dst).resolve()
            if not sp.exists():
                return gw._err(rid, 4003, "源文件不存在")
            if dp.exists():
                return gw._err(rid, 4005, "目标已存在")
            dp.parent.mkdir(parents=True, exist_ok=True)
            if sp.is_dir():
                _shutil.copytree(str(sp), str(dp))
            else:
                _shutil.copy2(str(sp), str(dp))
            return gw._ok(rid, {"src": str(sp), "dst": str(dp), "copied": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    _clipboard_watcher = None
    _clipboard_history = []
    _clipboard_history_lock = __import__('threading').Lock()
    _ws_transport = None  # 全局 WebSocket transport

    def _read_clipboard_text():
        try:
            import pyperclip
            return pyperclip.paste() or ""
        except Exception:
            pass
        # Windows native fallback via ctypes
        try:
            import ctypes
            import ctypes.wintypes
            CF_UNICODETEXT = 13
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            user32.OpenClipboard.argtypes = [ctypes.wintypes.HWND]
            user32.OpenClipboard.restype = ctypes.wintypes.BOOL
            user32.CloseClipboard.argtypes = []
            user32.CloseClipboard.restype = ctypes.wintypes.BOOL
            user32.GetClipboardData.argtypes = [ctypes.c_uint]
            user32.GetClipboardData.restype = ctypes.wintypes.HANDLE
            user32.IsClipboardFormatAvailable.argtypes = [ctypes.c_uint]
            user32.IsClipboardFormatAvailable.restype = ctypes.wintypes.BOOL
            kernel32.GlobalLock.argtypes = [ctypes.wintypes.HGLOBAL]
            kernel32.GlobalLock.restype = ctypes.c_void_p
            kernel32.GlobalUnlock.argtypes = [ctypes.wintypes.HGLOBAL]
            kernel32.GlobalUnlock.restype = ctypes.wintypes.BOOL
            if not user32.IsClipboardFormatAvailable(CF_UNICODETEXT):
                return ""
            if not user32.OpenClipboard(None):
                return ""
            try:
                handle = user32.GetClipboardData(CF_UNICODETEXT)
                if not handle:
                    return ""
                ptr = kernel32.GlobalLock(handle)
                if not ptr:
                    return ""
                try:
                    return ctypes.c_wchar_p(ptr).value or ""
                finally:
                    kernel32.GlobalUnlock(handle)
            finally:
                user32.CloseClipboard()
        except Exception:
            return ""

    def _start_clipboard_watcher():
        import ctypes
        import ctypes.wintypes
        import threading

        WM_CLIPBOARDUPDATE = 0x031D
        WM_DESTROY = 0x0002

        class WNDCLASS(ctypes.Structure):
            _fields_ = [
                ("style", ctypes.c_uint),
                ("lpfnWndProc", ctypes.c_void_p),
                ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int),
                ("hInstance", ctypes.c_void_p),
                ("hIcon", ctypes.c_void_p),
                ("hCursor", ctypes.c_void_p),
                ("hbrBackground", ctypes.c_void_p),
                ("lpszMenuName", ctypes.wintypes.LPCWSTR),
                ("lpszClassName", ctypes.wintypes.LPCWSTR),
            ]

        ctypes.windll.user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASS)]
        ctypes.windll.user32.RegisterClassW.restype = ctypes.c_ushort
        ctypes.windll.user32.CreateWindowExW.argtypes = [
            ctypes.c_ulong, ctypes.c_wchar_p, ctypes.c_wchar_p,
            ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
            ctypes.c_int, ctypes.c_int, ctypes.c_void_p,
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p
        ]
        ctypes.windll.user32.CreateWindowExW.restype = ctypes.c_void_p
        ctypes.windll.kernel32.GetModuleHandleW.argtypes = [ctypes.c_wchar_p]
        ctypes.windll.kernel32.GetModuleHandleW.restype = ctypes.c_void_p
        ctypes.windll.user32.DefWindowProcW.argtypes = [
            ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p
        ]
        ctypes.windll.user32.DefWindowProcW.restype = ctypes.c_longlong
        ctypes.windll.user32.AddClipboardFormatListener.argtypes = [ctypes.c_void_p]
        ctypes.windll.user32.AddClipboardFormatListener.restype = ctypes.c_bool
        ctypes.windll.user32.GetMessageW.argtypes = [
            ctypes.POINTER(ctypes.wintypes.MSG), ctypes.c_void_p,
            ctypes.c_uint, ctypes.c_uint
        ]
        ctypes.windll.user32.GetMessageW.restype = ctypes.c_bool
        ctypes.windll.user32.TranslateMessage.argtypes = [ctypes.POINTER(ctypes.wintypes.MSG)]
        ctypes.windll.user32.TranslateMessage.restype = ctypes.c_bool
        ctypes.windll.user32.DispatchMessageW.argtypes = [ctypes.POINTER(ctypes.wintypes.MSG)]
        ctypes.windll.user32.DispatchMessageW.restype = ctypes.c_longlong

        def _watcher():
            import sys
            WndProcType = ctypes.WINFUNCTYPE(
                ctypes.c_longlong,
                ctypes.c_void_p, ctypes.c_uint,
                ctypes.c_void_p, ctypes.c_void_p
            )

            def window_proc(hwnd, msg, wparam, lparam):
                if msg == WM_CLIPBOARDUPDATE:
                    try:
                        _on_clipboard_change()
                    except Exception:
                        pass
                    return 0
                elif msg == WM_DESTROY:
                    ctypes.windll.user32.PostQuitMessage(0)
                    return 0
                return ctypes.windll.user32.DefWindowProcW(hwnd, msg, wparam, lparam)

            wndproc = WndProcType(window_proc)
            setattr(_watcher, '_wndproc', wndproc)

            wc = WNDCLASS()
            wc.style = 0
            wc.lpfnWndProc = ctypes.cast(wndproc, ctypes.c_void_p)
            wc.cbClsExtra = 0
            wc.cbWndExtra = 0
            wc.hInstance = ctypes.windll.kernel32.GetModuleHandleW(None)
            wc.hIcon = None
            wc.hCursor = None
            wc.hbrBackground = None
            wc.lpszMenuName = None
            wc.lpszClassName = "HermesClipboardWatcher"

            atom = ctypes.windll.user32.RegisterClassW(ctypes.byref(wc))
            if not atom:
                return

            hwnd = ctypes.windll.user32.CreateWindowExW(
                0, "HermesClipboardWatcher", None, 0,
                0, 0, 0, 0,
                ctypes.c_void_p(-3),  # HWND_MESSAGE
                None, wc.hInstance, None
            )
            if not hwnd:
                return

            ctypes.windll.user32.AddClipboardFormatListener(hwnd)

            msg = ctypes.wintypes.MSG()
            while ctypes.windll.user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                ctypes.windll.user32.TranslateMessage(ctypes.byref(msg))
                ctypes.windll.user32.DispatchMessageW(ctypes.byref(msg))

            # ✅ 清理资源：销毁窗口和注销监听器
            try:
                ctypes.windll.user32.RemoveClipboardFormatListener(hwnd)
                ctypes.windll.user32.DestroyWindow(hwnd)
            except Exception:
                pass

        def _on_clipboard_change():
            try:
                # ✅ 使用超时等待，避免丢失事件
                if not _clipboard_history_lock.acquire(timeout=0.5):
                    return
                try:
                    text = _read_clipboard_text()
                    if not text:
                        return
                    # ✅ 移除大小限制，允许处理任意大小的剪贴板内容
                    if _clipboard_history and _clipboard_history[0].get("text") == text:
                        return
                    _clipboard_history.insert(0, {
                        "text": text,
                        "time": __import__("time").strftime("%H:%M:%S"),
                    })
                    del _clipboard_history[20:]
                    try:
                        _write_clipboard_cache()
                    except Exception:
                        pass
                    if _ws_transport is not None:
                        try:
                            _ws_transport.write({
                                "jsonrpc": "2.0",
                                "method": "event",
                                "params": {
                                    "type": "clipboard.changed",
                                    "payload": {"text": text},
                                },
                            })
                        except Exception:
                            pass
                finally:
                    _clipboard_history_lock.release()
            except Exception:
                pass

        t = threading.Thread(target=_watcher, daemon=True, name="clipboard-watcher")
        t.start()
        return t

    def _fs_read_clipboard(rid, params):
        try:
            content = _read_clipboard_text()
            return gw._ok(rid, {"content": content})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_clipboard_history(rid, params):
        with _clipboard_history_lock:
            return gw._ok(rid, {"history": list(_clipboard_history[:10])})

    def _fs_clipboard_watch_start(rid, params):
        nonlocal _clipboard_watcher, _ws_transport
        # 每次调用都更新 transport，确保 WebSocket 重连后能向新的 transport 发送事件
        try:
            from tui_gateway.transport import current_transport
            _ws_transport = current_transport()
        except Exception:
            pass
        if _clipboard_watcher is None:
            _clipboard_watcher = _start_clipboard_watcher()
        return gw._ok(rid, {"watching": True})

    def _fs_open_file_manager(rid, params):
        import subprocess as _sp
        import os as _os
        path = (params or {}).get("path", "")
        if not path:
            return gw._err(rid, 4001, "缺少路径")
        try:
            p = _os.path.abspath(_os.path.expanduser(path))
            if _os.path.isdir(p):
                _sp.Popen(['explorer', p], shell=False)
                return gw._ok(rid, {"opened": p})
            else:
                return gw._err(rid, 4003, "路径不是文件夹")
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_translate(rid, params):
        text = (params or {}).get("text", "")
        if not text or not text.strip():
            return gw._err(rid, 4001, "缺少要翻译的文本")
        try:
            import urllib.parse as _up
            import urllib.request as _ur
            import json as _json
            from_lang = (params or {}).get("from", "auto")
            to_lang = (params or {}).get("to", "zh")
            if from_lang == 'auto':
                if any('\u4e00' <= c <= '\u9fff' for c in text[:50]):
                    from_lang = 'zh'
                    to_lang = 'en' if to_lang == 'zh' else to_lang
                elif any('\u3040' <= c <= '\u309f' or '\u30a0' <= c <= '\u30ff' for c in text[:50]):
                    from_lang = 'ja'
                elif any('\uac00' <= c <= '\ud7af' for c in text[:50]):
                    from_lang = 'ko'
                else:
                    from_lang = 'en'
            result = None
            engine = 'mymemory'
            try:
                qs = _up.urlencode({'q': text, 'langpair': from_lang + '|' + to_lang})
                req = _ur.Request('https://api.mymemory.translated.net/get?' + qs,
                                  headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                with _ur.urlopen(req, timeout=10) as resp:
                    body = resp.read().decode('utf-8', errors='replace')
                data = _json.loads(body)
                translated = data.get('responseData', {}).get('translatedText', '')
                if translated and translated != text.upper():
                    result = translated
            except Exception:
                pass
            if not result:
                try:
                    sug_data = _up.urlencode({'kw': text}).encode('utf-8')
                    sug_req = _ur.Request('https://fanyi.baidu.com/sug', data=sug_data,
                                          headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                                                   'Content-Type': 'application/x-www-form-urlencoded'})
                    with _ur.urlopen(sug_req, timeout=10) as resp:
                        body = resp.read().decode('utf-8', errors='replace')
                    sug = _json.loads(body)
                    parts = []
                    for item in sug.get('data', []):
                        v = item.get('v', '')
                        if v:
                            parts.append(v)
                    if parts:
                        result = parts[0]
                        engine = 'baidu_sug'
                except Exception:
                    pass
            if not result:
                return gw._err(rid, 5000, "翻译失败，所有引擎均无响应")
            return gw._ok(rid, {"content": result, "engine": engine})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_open_url(rid, params):
        import webbrowser as _wb
        url = (params or {}).get("url", "")
        if not url:
            return gw._err(rid, 4001, "缺少URL")
        try:
            _wb.open(url)
            return gw._ok(rid, {"url": url, "opened": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _fs_execute(rid, params):
        import subprocess as _sp
        import shutil as _shutil
        code = (params or {}).get("code", "")
        lang = (params or {}).get("lang", "").lower()
        if not code.strip():
            return gw._err(rid, 4001, "缺少代码")
        try:
            if lang in ("powershell", "pwsh", "ps1"):
                shell_cmd = ["powershell", "-NoProfile", "-Command", code]
            elif lang in ("python", "py"):
                shell_cmd = ["python", "-c", code]
            elif lang in ("node", "js", "javascript"):
                shell_cmd = ["node", "-e", code]
            elif lang in ("bat", "cmd"):
                shell_cmd = ["cmd", "/c", code]
            else:
                bash_path = _shutil.which("bash")
                if bash_path:
                    shell_cmd = [bash_path, "-c", code]
                else:
                    shell_cmd = ["powershell", "-NoProfile", "-Command", code]
            result = _sp.run(
                shell_cmd,
                capture_output=True, text=True, timeout=30,
                cwd=str(Path.home()),
            )
            output = result.stdout
            if result.stderr:
                output += ("\n--- stderr ---\n" + result.stderr) if output else result.stderr
            import re as _re
            output = _re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', output)
            if result.returncode != 0:
                output += ("\n退出码: " + str(result.returncode)) if output else ("退出码: " + str(result.returncode))
            return gw._ok(rid, {"output": output or "(无输出)", "exitCode": result.returncode})
        except _sp.TimeoutExpired:
            return gw._err(rid, 5001, "执行超时（30秒）")
        except FileNotFoundError:
            return gw._err(rid, 5002, "未找到执行器")
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    gw._methods["fs.stat"] = _fs_stat
    gw._methods["fs.open_url"] = _fs_open_url
    gw._methods["fs.execute"] = _fs_execute
    gw._methods["fs.list_dir"] = _fs_list_dir
    gw._methods["fs.read_file"] = _fs_read_file
    gw._methods["fs.write_file"] = _fs_write_file
    gw._methods["fs.create_file"] = _fs_create_file
    gw._methods["fs.create_folder"] = _fs_create_folder
    gw._methods["fs.rename"] = _fs_rename
    gw._methods["fs.delete"] = _fs_delete
    gw._methods["fs.select_folder"] = _fs_select_folder
    gw._methods["fs.open_folder"] = _fs_open_folder
    gw._methods["fs.move"] = _fs_move
    gw._methods["fs.copy"] = _fs_copy
    gw._methods["fs.read_clipboard"] = _fs_read_clipboard
    gw._methods["fs.clipboard_history"] = _fs_clipboard_history
    gw._methods["fs.clipboard_watch_start"] = _fs_clipboard_watch_start
    gw._methods["fs.open_file_manager"] = _fs_open_file_manager
    gw._methods["fs.translate"] = _fs_translate
    gw._methods["fs.open_url"] = _fs_open_url
