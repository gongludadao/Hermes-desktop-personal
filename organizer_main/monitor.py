"""
文件监控模块 - 监控 main 目录文件变化
支持 Watchdog（实时）和轮询（备用）两种模式
"""

import os
import time
import threading
from pathlib import Path
from typing import Callable, Optional, List, Set
from dataclasses import dataclass


@dataclass
class FileEvent:
    """文件事件"""
    file_path: str
    event_type: str  # 'created', 'modified', 'deleted'
    timestamp: float


class BaseMonitor:
    """监控基类"""
    
    def __init__(self, watch_path: str, debounce_seconds: float = 5.0):
        self.watch_path = Path(watch_path)
        self.debounce_seconds = debounce_seconds
        self._pending_events: dict = {}  # 防抖用的待处理事件
        self._lock = threading.Lock()
        self._callback: Optional[Callable] = None
        self._running = False
        self._thread: Optional[threading.Thread] = None
    
    def set_callback(self, callback: Callable):
        """设置事件回调函数"""
        self._callback = callback
    
    def _emit_event(self, file_path: str, event_type: str):
        """防抖后发送事件"""
        with self._lock:
            now = time.time()
            last_time = self._pending_events.get(file_path, {}).get('time', 0)
            
            # 防抖：如果距离上次处理时间太短，跳过
            if now - last_time < self.debounce_seconds:
                return
            
            # 记录本次事件
            self._pending_events[file_path] = {
                'type': event_type,
                'time': now
            }
            
            # 清理旧记录
            self._pending_events = {
                k: v for k, v in self._pending_events.items()
                if now - v['time'] < self.debounce_seconds * 2
            }
        
        # 回调
        if self._callback:
            event = FileEvent(
                file_path=file_path,
                event_type=event_type,
                timestamp=now
            )
            self._callback(event)
    
    def start(self):
        """启动监控（子类实现）"""
        self._running = True
    
    def stop(self):
        """停止监控"""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)


class PollingMonitor(BaseMonitor):
    """轮询监控（备用方案）"""
    
    def __init__(self, watch_path: str, debounce_seconds: float = 5.0, poll_interval: float = 10.0):
        super().__init__(watch_path, debounce_seconds)
        self.poll_interval = poll_interval
        self._known_files: Set[str] = set()
        self._known_mtimes: dict = {}
    
    def _scan_files(self) -> Set[str]:
        """递归扫描目录下的所有文件"""
        files = set()
        if not self.watch_path.exists():
            return files
        
        for entry in self.watch_path.rglob('*'):
            if entry.is_file() and not entry.name.startswith('.'):
                files.add(str(entry))
        return files
    
    def start(self):
        """启动轮询监控"""
        self._running = True
        # 初始化 mtime 记录，避免第一次轮询误触发
        initial_files = self._scan_files()
        self._known_files = initial_files
        self._known_mtimes = {
            f: os.path.getmtime(f) for f in initial_files
            if os.path.exists(f)
        }
        
        def _poll_loop():
            while self._running:
                try:
                    current_files = self._scan_files()
                    
                    # 检测新增文件
                    for file_path in current_files - self._known_files:
                        self._emit_event(file_path, 'created')
                    
                    # 检测修改文件
                    for file_path in current_files & self._known_files:
                        try:
                            mtime = os.path.getmtime(file_path)
                            if mtime != self._known_mtimes.get(file_path):
                                self._emit_event(file_path, 'modified')
                        except OSError:
                            pass
                    
                    # 检测删除文件
                    for file_path in self._known_files - current_files:
                        self._emit_event(file_path, 'deleted')
                    
                    # 更新记录
                    self._known_files = current_files
                    self._known_mtimes = {
                        f: os.path.getmtime(f) for f in current_files
                        if os.path.exists(f)
                    }
                    
                except Exception as e:
                    print(f"[Monitor] 轮询出错：{e}")
                
                time.sleep(self.poll_interval)
        
        self._thread = threading.Thread(target=_poll_loop, daemon=True)
        self._thread.start()
        print(f"[Monitor] 轮询监控已启动（间隔 {self.poll_interval} 秒）")


class WatchdogMonitor(BaseMonitor):
    """Watchdog 实时监控"""
    
    def __init__(self, watch_path: str, debounce_seconds: float = 5.0):
        super().__init__(watch_path, debounce_seconds)
        self._observer = None
    
    def start(self):
        """启动 Watchdog 监控"""
        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler
            
            class EventHandler(FileSystemEventHandler):
                def __init__(self, outer):
                    self.outer = outer
                
                def on_created(self, event):
                    if not event.is_directory and not event.src_path.endswith('.tmp'):
                        self.outer._emit_event(event.src_path, 'created')
                
                def on_modified(self, event):
                    if not event.is_directory and not event.src_path.endswith('.tmp'):
                        self.outer._emit_event(event.src_path, 'modified')
                
                def on_deleted(self, event):
                    if not event.is_directory:
                        self.outer._emit_event(event.src_path, 'deleted')
            
            self._observer = Observer()
            handler = EventHandler(self)
            self._observer.schedule(handler, str(self.watch_path), recursive=False)
            self._observer.start()
            print(f"[Monitor] Watchdog 实时监控已启动：{self.watch_path}")
            
        except ImportError:
            print("[Monitor] watchdog 未安装，回退到轮询模式")
            # 回退到轮询
            self._poll_fallback = PollingMonitor(
                str(self.watch_path),
                self.debounce_seconds,
                poll_interval=10.0
            )
            if self._callback:
                self._poll_fallback.set_callback(self._callback)
            self._poll_fallback.start()
    
    def stop(self):
        """停止监控"""
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None
        elif hasattr(self, '_poll_fallback'):
            self._poll_fallback.stop()


def create_monitor(watch_path: str, debounce_seconds: float = 5.0, 
                   poll_interval: float = 10.0, prefer_watchdog: bool = True) -> BaseMonitor:
    """
    创建监控器（自动选择最佳方案）
    
    Args:
        watch_path: 监控目录路径
        debounce_seconds: 防抖时间
        poll_interval: 轮询间隔
        prefer_watchdog: 是否优先使用 Watchdog
        
    Returns:
        BaseMonitor 实例
    """
    if prefer_watchdog:
        try:
            import watchdog
            return WatchdogMonitor(watch_path, debounce_seconds)
        except ImportError:
            pass
    return PollingMonitor(watch_path, debounce_seconds, poll_interval)
