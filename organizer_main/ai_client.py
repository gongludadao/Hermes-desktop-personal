"""
AI 客户端 - 通过 gateway dispatch 处理文件
"""

import json
import time
import threading
from pathlib import Path


class MainProcessorAIClient:
    """通过 gateway dispatch 发送 prompt.submit"""

    def __init__(self, config, ws_token=None, gateway_proc=None):
        self.config = config
        self._lock = threading.Lock()
        self._busy = False
        self._vault = "C:\\Users\\13213\\.openclaw\\wiki"
        
        # 加载技能文件
        self._skills_prompt = self._load_skills()

    def _load_skills(self) -> str:
        """加载 skills 目录中的技能文件到 prompt"""
        skills_dir = Path(__file__).parent.parent.parent / "skills" / "desktop"
        parts = []
        
        # Obsidian 技能
        obsidian_skills = [
            "obsidian-markdown",
            "openclaw-bridge-organization",
        ]
        
        for skill_name in obsidian_skills:
            skill_path = skills_dir / skill_name / "SKILL.md"
            if skill_path.exists():
                content = skill_path.read_text(encoding="utf-8")
                parts.append(content)
                print(f"[MainProcessor.AI] 已加载技能: {skill_name}")
            else:
                print(f"[MainProcessor.AI] 技能文件不存在: {skill_path}")
        
        return "\n\n---\n\n".join(parts)

    def create_message(self, file_path: str, content: str) -> str:
        fname = Path(file_path).name
        return f"""整理以下文件到 Obsidian 知识库。

## ⚠️ 判断原则：只保存用户个性化内容，不要问用户自己做决定。

**只有文件包含以下用户相关内容时，才创建笔记：**
1. **用户需求/指令** — 用户提的需求、偏好、反馈、决策
2. **用户数据** — 用户输入的内容、评分、评价、创作作品
3. **用户行为** — 用户的操作记录、使用习惯、自定义设置
4. **用户个人信息** — 用户的偏好、习惯、时间安排、人际关系

**以下情况直接跳过，不要创建笔记：**
- 通用技术教程（Docker、Terraform、Python 等）
- 网上能找到的参考手册
- 与用户无关的第三方资料
- 纯 AI 之间的闲聊对话
- 空模板、仅有元数据无实质内容的文件

## 提取要求

如果判断为需要保存的内容：

**优先提取：**
- 用户的需求、评分、反馈
- 用户的创作产出、进度
- 用户的决策、偏好、设置

**其次提取：**
- 评分数据、质量趋势分析
- 故障诊断、错误模式
- 灵感记录、创作素材

**忽略：**
- AI 之间的角色扮演对话
- 空模板、无内容元数据
- 系统内部状态信息

## 技能指引

{self._skills_prompt}

## 文件信息

知识库路径：{self._vault}

文件路径：{file_path}
文件内容：
{content[:50000]}
"""

    def process_file(self, file_path: str, content: str):
        with self._lock:
            if self._busy:
                return {'success': False, 'message': 'busy'}
            self._busy = True

        try:
            from tui_gateway.server import dispatch
            import tui_gateway.server as _server

            class _FilterStdout:
                """过滤 JSON-RPC 事件行，保留普通打印"""
                def __init__(self, real):
                    self._real = real
                def write(self, data: str) -> None:
                    stripped = data.strip()
                    if stripped.startswith('{"jsonrpc":'):
                        return
                    self._real.write(data)
                    self._real.flush()
                def flush(self) -> None:
                    self._real.flush()

            _orig_out = _server._real_stdout
            _server._real_stdout = _FilterStdout(_orig_out)

            # 确保 session 存在
            from tui_gateway.server import _sessions
            import threading as _th
            sid = "wiki-main-processor"
            if sid not in _sessions:
                _sessions[sid] = {
                    "agent": None, "session_key": sid,
                    "history": [], "history_lock": _th.Lock(),
                    "history_version": 0, "inflight_turn": None,
                    "created_at": time.time(), "last_active": time.time(),
                    "running": False, "attached_images": [],
                    "agent_ready": _th.Event(),
                    "agent_build_started": False,
                    "agent_build_lock": _th.Lock(), "cols": 80,
                }

            fname = Path(file_path).name
            msg = self.create_message(file_path, content)
            rid = f"mp-{int(time.time())}"

            req = {
                "jsonrpc": "2.0", "id": rid,
                "method": "prompt.submit",
                "params": {"text": msg, "session_id": sid},
            }

            print(f"[MainProcessor.AI] 发送: {fname}")
            r = dispatch(req)

            # session busy 则重试
            for i in range(3):
                if r and r.get("error") and r["error"].get("code") == 4009:
                    print(f"[MainProcessor.AI] session 忙碌，等待... ({i+1}/3)")
                    time.sleep(5)
                    r = dispatch(req)
                else:
                    break

            if r and r.get("error"):
                print(f"[MainProcessor.AI] 错误: {r['error'].get('message')}")
                return {'success': False, 'message': r['error'].get('message')}

            # 等 AI 处理完成（轮询 session 状态）
            print(f"[MainProcessor.AI] 等待 AI 处理...")
            session = _sessions.get(sid)
            if session:
                for _ in range(90):  # 最多 90 秒
                    if not session.get("running"):
                        break
                    time.sleep(1)
                if session.get("running"):
                    print(f"[MainProcessor.AI] AI 处理超时")
                else:
                    print(f"[MainProcessor.AI] AI 处理完成")

            return {'success': True, 'message': '已提交'}

        except Exception as e:
            print(f"[MainProcessor.AI] 失败: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'message': str(e)}

        finally:
            try:
                _server._real_stdout = _orig_out
            except Exception:
                pass
            with self._lock:
                self._busy = False
