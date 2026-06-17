"""
主处理器 - 协调监控、AI 调用和文件处理
"""

import os
import time
import asyncio
import threading
import yaml
from pathlib import Path
from typing import Optional, Dict
from dataclasses import dataclass, field

from .ai_client import MainProcessorAIClient
from .monitor import create_monitor, FileEvent


@dataclass
class ProcessingResult:
    """处理结果"""
    file_path: str
    success: bool
    message: str
    timestamp: float = field(default_factory=time.time)


class MainProcessor:
    """Main 文件夹处理器"""
    
    def __init__(self, config_path: Optional[str] = None, ws_token: Optional[str] = None, gateway_proc=None):
        # 加载配置
        if config_path is None:
            config_path = Path(__file__).parent / "config.yaml"
        
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        # 监控配置
        monitor_config = self.config.get('monitoring', {})
        self.watch_path = monitor_config.get('watch_path', '')
        self.debounce_seconds = monitor_config.get('debounce_seconds', 5.0)
        self.poll_interval = monitor_config.get('poll_interval', 10.0)
        self.enabled = monitor_config.get('enabled', True)
        
        # 处理配置
        proc_config = self.config.get('processing', {})
        self.max_file_size = proc_config.get('max_file_size', 50000)
        self.supported_extensions = set(proc_config.get('supported_extensions', ['.md', '.txt']))
        
        # 初始化组件
        self._monitor = None
        self._ai_client = MainProcessorAIClient(self.config, ws_token=ws_token, gateway_proc=gateway_proc)
        self._results: list = []
        self._lock = threading.Lock()
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None
        self._queue: list = []  # 待处理文件队列
    
    def _is_supported_file(self, file_path: str) -> bool:
        """检查文件类型是否支持"""
        ext = Path(file_path).suffix.lower()
        return ext in self.supported_extensions
    
    def _read_file_content(self, file_path: str) -> Optional[str]:
        """读取文件内容"""
        try:
            # 检查文件大小
            size = os.path.getsize(file_path)
            if size > self.max_file_size * 2:
                print(f"[MainProcessor] 文件过大，跳过：{file_path}")
                return None
            
            # 尝试 UTF-8，失败则尝试 GBK
            try:
                content = Path(file_path).read_text(encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    content = Path(file_path).read_text(encoding='gbk')
                except UnicodeDecodeError:
                    content = Path(file_path).read_text(encoding='gb2312')
            
            # 截取限制长度
            if len(content) > self.max_file_size:
                content = content[:self.max_file_size]
                print(f"[MainProcessor] 截取内容（原大小 {len(content) + 50000} 字符）")
            
            return content
            
        except Exception as e:
            print(f"[MainProcessor] 读取文件失败 {file_path}: {e}")
            return None
    
    def _on_file_event(self, event: FileEvent):
        """文件事件回调"""
        file_path = event.file_path
        event_type = event.event_type
        
        # 只处理 created 和 modified 事件
        if event_type not in ('created', 'modified'):
            return
        
        # 检查文件类型
        if not self._is_supported_file(file_path):
            print(f"[MainProcessor] 跳过不支持的文件类型：{Path(file_path).suffix}")
            return
        
        print(f"[MainProcessor] 检测到文件变化：{Path(file_path).name} ({event_type})")
        
        # 添加到处理队列
        with self._lock:
            # 避免重复添加
            if file_path not in [f for f in self._queue]:
                self._queue.append(file_path)
    
    def _process_queue(self):
        """处理队列中的文件"""
        print("[MainProcessor] 工作线程启动")
        
        while self._running:
            # 从队列获取文件
            file_path = None
            with self._lock:
                if self._queue:
                    file_path = self._queue.pop(0)
            
            if file_path is None:
                time.sleep(0.5)
                continue
            
            # 处理文件
            result = self._process_single_file(file_path)
            
            # 记录结果
            with self._lock:
                self._results.append(result)
                # 只保留最近 100 条记录
                if len(self._results) > 100:
                    self._results = self._results[-100:]
    
    def _process_single_file(self, file_path: str) -> ProcessingResult:
        """处理单个文件"""
        print(f"[MainProcessor] 处理文件：{Path(file_path).name}")
        
        # 读取内容
        content = self._read_file_content(file_path)
        if content is None:
            return ProcessingResult(
                file_path=file_path,
                success=False,
                message='无法读取文件内容'
            )
        
        # 调用 Hermes Gateway 处理
        try:
            result = self._ai_client.process_file(file_path, content)
        except Exception as e:
            print(f"[MainProcessor] AI 处理异常：{e}")
            return ProcessingResult(
                file_path=file_path,
                success=False,
                message=f'处理异常：{str(e)}'
            )
        
        if result['success']:
            return ProcessingResult(
                file_path=file_path,
                success=True,
                message=result.get('message', '处理成功')
            )
        else:
            return ProcessingResult(
                file_path=file_path,
                success=False,
                message=result.get('message', '处理失败')
            )
    
    def start(self):
        """启动处理器"""
        if self._running:
            print("[MainProcessor] 已在运行中")
            return
        
        if not self.enabled:
            print("[MainProcessor] 监控未启用")
            return
        
        self._running = True
        
        # 创建监控器
        self._monitor = create_monitor(
            watch_path=self.watch_path,
            debounce_seconds=self.debounce_seconds,
            poll_interval=self.poll_interval,
            prefer_watchdog=True
        )
        
        # 设置回调
        self._monitor.set_callback(self._on_file_event)
        
        # 启动监控
        self._monitor.start()
        
        # 启动工作线程
        self._worker_thread = threading.Thread(target=self._process_queue, daemon=True)
        self._worker_thread.start()
        
        print(f"[MainProcessor] 处理器已启动，监控：{self.watch_path}")
    
    def stop(self):
        """停止处理器"""
        self._running = False
        
        if self._monitor:
            self._monitor.stop()
        
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2)
        
        print("[MainProcessor] 处理器已停止")
    
    def process_all(self) -> list:
        """
        立即处理 watch_path 下的所有文件（用于首次运行）
        
        Returns:
            list: 处理结果列表
        """
        print(f"[MainProcessor] 扫描已有文件：{self.watch_path}")
        
        results = []
        watch_path = Path(self.watch_path)
        
        if not watch_path.exists():
            print(f"[MainProcessor] 目录不存在：{self.watch_path}")
            return results
        
        # 扫描所有文件
        files_to_process = []
        for entry in watch_path.iterdir():
            if entry.is_file() and not entry.name.startswith('.'):
                if self._is_supported_file(str(entry)):
                    files_to_process.append(str(entry))
        
        print(f"[MainProcessor] 找到 {len(files_to_process)} 个文件需要处理")
        
        # 处理每个文件
        for file_path in files_to_process:
            result = self._process_single_file(file_path)
            results.append(result)
            self._results.append(result)
        
        return results
    
    def get_recent_results(self, limit: int = 20) -> list:
        """获取最近的处理结果"""
        with self._lock:
            return self._results[-limit:]
    
    def get_status(self) -> Dict:
        """获取处理器状态"""
        with self._lock:
            queue_size = len(self._queue)
            result_count = len(self._results)
        
        return {
            'running': self._running,
            'watch_path': self.watch_path,
            'queue_size': queue_size,
            'result_count': result_count,
        }
