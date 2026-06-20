"""
Embedding RPC 模块 - 提供向量搜索功能
使用本地 model + Chroma 向量数据库实现语义搜索

依赖（可选）：
- numpy
- torch
- transformers
- chromadb
- jieba
- requests (用于 LLM 意图分类)
"""
import os
import re
import json
import threading
import time
from pathlib import Path
import requests
import yaml

# 加载配置
_CONFIG = None

def _load_config():
    """加载 Hermes 配置"""
    global _CONFIG
    if _CONFIG is None:
        try:
            # 从 desktop/_rpc_embedding.py -> desktop -> hermes -> config.yaml
            config_path = Path(__file__).parent.parent / "config.yaml"
            with open(config_path, "r", encoding="utf-8") as f:
                _CONFIG = yaml.safe_load(f)
        except Exception as e:
            print(f"[Embedding] 配置加载失败: {e}")
            _CONFIG = {}
    return _CONFIG

def _get_llm_config():
    """获取 LLM API 配置"""
    config = _load_config()
    return {
        "base_url": config.get("model", {}).get("base_url", "http://localhost:3000/v1"),
        "api_key": config.get("model", {}).get("api_key", ""),
        "model": config.get("model", {}).get("default", "Qwen")
    }

# 意图分类缓存（避免重复调用 LLM）
_intent_cache = {}
_intent_cache_lock = threading.Lock()

def classify_intent(query, context_messages=None):
    """使用 LLM 判断查询意图
    
    返回意图类别：健康/小说/财务/通用/其他
    """
    global _intent_cache
    
    # 构建缓存键
    cache_key = query[:50]  # 取前50字符作为缓存键
    with _intent_cache_lock:
        if cache_key in _intent_cache:
            return _intent_cache[cache_key]
    
    try:
        llm_config = _get_llm_config()
        if not llm_config["api_key"]:
            print("[Intent] 未配置 LLM API，跳过意图分类")
            return "通用"
        
        # 构建提示词
        prompt = f"""请判断以下查询的意图类别，只返回类别名称：

查询：{query}

可选类别：
- 健康：身体健康、健身、医疗相关
- 小说：小说创作、剧情、角色相关
- 财务：信用、账单、消费、财务相关
- 通用：其他一般性查询

只返回类别名称（健康/小说/财务/通用），不要解释。"""
        
        try:
            response = requests.post(
                f"{llm_config['base_url']}/chat/completions",
                headers={
                    "Authorization": f"Bearer {llm_config['api_key']}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": llm_config["model"],
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 10
                },
                timeout=30
            )
        except Exception as e:
            print(f"[Intent] LLM 请求失败：{e}")
            return "通用"
        
        if response.status_code == 200:
            result = response.json()
            if "choices" not in result or not result["choices"]:
                print(f"[Intent] 异常响应: {response.text[:200]}")
                return "通用"
            content = result["choices"][0].get("message", {}).get("content", "")
            # 部分 API 使用 delta 格式
            if not content:
                content = result["choices"][0].get("delta", {}).get("content", "")
            intent = content.strip()
            # 标准化意图
            intent_map = {
                "健康": "健康",
                "小说": "小说",
                "财务": "财务",
                "通用": "通用"
            }
            intent = intent_map.get(intent, "通用")
            
            # 缓存结果
            with _intent_cache_lock:
                _intent_cache[cache_key] = intent
            
            print(f"[Intent] 查询意图: '{query[:30]}...' → {intent}")
            return intent
        else:
            print(f"[Intent] LLM API 调用失败: {response.status_code}")
            return "通用"
            
    except Exception as e:
        print(f"[Intent] 意图分类失败: {e}")
        return "通用"


# 意图关键词映射（本地判断，无需 LLM）
_INTENT_KEYWORDS = {
    "健康": ["健康", "锻炼", "运动", "健身", "身体", "医疗", "吃药", "医院", "跑步", "训练", "哑铃", "卧推", "推胸", "练胸", "杠铃", "胸部", "肌肉", "力量", "重量"],
    "小说": list("小说剧情角色故事章节主角配角情节大纲设定"),
    "财务": ["信用", "账单", "消费", "财务", "银行", "信用卡", "收入", "支出", "存款", "成本", "价格", "贵", "便宜", "省钱", "赚钱", "花钱"]
}


def _determine_intent(keywords):
    """根据 jieba 关键词判断查询意图（本地判断）
    
    使用子串匹配，例如"身体健康"→"健康"也能识别。
    """
    scores = {}
    for intent, words in _INTENT_KEYWORDS.items():
        score = 0
        for kw in keywords:
            kw_l = kw.lower()
            for w in words:
                if w in kw_l or kw_l in w:
                    score += 1
                    break
        if score > 0:
            scores[intent] = score
    
    if scores:
        best = max(scores, key=scores.get)
        return best
    return "通用"


def _filter_results_with_keywords(query, results, max_candidates=16, jieba_keywords=None):
    """jieba 关键词匹配 + 意图判断
    
    流程：jieba 分词 → 向量搜索 → jieba 关键词匹配 → 意图判断
    
    Args:
        query: 用户查询
        results: 搜索结果列表
        max_candidates: 最多评估的候选数
        jieba_keywords: jieba 提取的关键词（不传则用 regex 提取）
    """
    if not results:
        return results
    
    candidates = results[:min(max_candidates, len(results))]
    
    # 使用 jieba 关键词（优先）或从查询中提取
    if jieba_keywords:
        # 过滤停用词和个人专属词
        stop_words = {'我的', '我', '本人', '自己', '个人', '这么', '那么', '怎么', 
            '为什么', '什么', '可以', '没有', '这个', '那个', '这些', '那些',
            '因为', '所以', '但是', '如果', '虽然', '而且', '然后', '时候',
            '怎样', '如何', '不是', '就是', '只是', '还是', '或者', '并且',
            '已经', '应该', '能够', '可能', '需要', '知道', '觉得', '真是',
            '真的', '一个', '一些', '有点', '有些', '等等', '不过', '不要',
            '不能', '这样', '那样', '比如', '关于', '除了', '是不是', '有没有',
            '情况', '记录', '内容', '问题', '结果', '时候', '方面'}
        keywords = [k for k in jieba_keywords if k not in stop_words and len(k) > 1]
    else:
        # 回退：regex 提取
        import re
        words = re.findall(r'[\u4e00-\u9fff]{2,5}|[a-zA-Z0-9]+', query)
        stop_words = {'我的', '我', '本人', '自己', '个人'}
        keywords = [w for w in words if w not in stop_words and len(w) > 1]
    
    # 判断意图（基于关键词）
    intent = _determine_intent(keywords)
    if intent != "通用":
        print(f"[意图] {intent}（关键词: {keywords}）")
    
    if not keywords:
        return results[:5]
    
    # 用 jieba 关键词匹配搜索结果
    scored = []
    for r in candidates:
        fname = r.get("fileName", "").lower()
        chunk = r.get("chunkText", "").lower()[:300]
        sim = r.get("similarity", 0)
        
        keyword_score = 0
        matched = []
        for kw in keywords:
            kw_l = kw.lower()
            if kw_l in fname:
                keyword_score += 0.3
                matched.append(f"{kw}(文件名)")
            elif kw_l in chunk:
                keyword_score += 0.15
                matched.append(kw)
        
        if matched:
            print(f"[匹配] {r.get('fileName', '?')}: {matched}")
        
        # 标记是否有关键词匹配，用于动态阈值
        has_kw_match = keyword_score > 0
        
        scored.append((sim + keyword_score, has_kw_match, r))
    
    # 按分数降序
    scored.sort(key=lambda x: x[0], reverse=True)
    
    # 过滤：有关键词匹配的用 0.5 阈值，无匹配的用 0.6 阈值（更严格）
    filtered = []
    for s, has_kw, r in scored:
        threshold = 0.5 if has_kw else 0.6
        if s >= threshold:
            filtered.append(r)
    
    # 如果过滤后为空，尝试返回有关键词匹配的结果
    any_kw = sum(1 for _, h, _ in scored if h)
    if not filtered and any_kw:
        for s, has_kw, r in scored:
            if has_kw and len(filtered) < 3:
                filtered.append(r)
    # 无关键词匹配 → 不强制返回（避免无关文件混入）
    if not filtered and not any_kw:
        print(f"[结果] 无任何文件有关键词匹配，跳过返回")
    elif not filtered and any_kw:
        filtered = [r for _, _, r in scored[:3]]
    
    print(f"[结果] 意图={intent}，保留 {len(filtered)}/{len(candidates)} 个（关键词匹配:{sum(1 for _,h,_ in scored if h)}个）")
    return filtered



# 后台构建状态
_index_build_status = {
    "building": False,
    "progress": 0,
    "total": 0,
    "error": None,
    "complete": False
}

# 模型加载状态 + 线程锁（防止并发加载导致竞态问题）
_model_loading = False
_model_load_lock = threading.Lock()

# 索引自动更新检查：记录上次检查时间，避免每次搜索都遍历文件
_last_index_check_time = 0
_INDEX_CHECK_INTERVAL = 300  # 5 分钟检查一次文件变化

# 索引内存缓存（避免每次搜索都读磁盘 + 解析 JSON）
_index_cache = None  # {"documents": [...], "matrix": np.array, "mtime": float, "vault_path": str}

# 索引文件写入锁（防止并发写入导致 JSON 损坏）
_index_write_lock = threading.Lock()

# 尝试导入 numpy（可选）
try:
    import numpy as np
    _numpy_available = True
except ImportError:
    _numpy_available = False
    np = None

# 尝试导入 Chroma
try:
    import chromadb
    from chromadb.config import Settings
    _chroma_available = True
except ImportError:
    _chroma_available = False
    print("[Embedding] ChromaDB 未安装，使用回退模式")

# 尝试导入 jieba（中文分词，用于关键词提取）
try:
    import jieba
    import jieba.analyse
    _jieba_available = True
except ImportError:
    _jieba_available = False
    print("[Embedding] jieba 未安装，关键词提取功能不可用")

# Local Embedding Config
_embedding_model_name = "Qwen/Qwen3-Embedding-0.6B"
_embedding_cache_dir = Path(__file__).parent.resolve() / "cache" / "embeddings"
_index_file = _embedding_cache_dir / "vault_index.json"
_embedding_available = False
_INDEX_VERSION = 3  # 索引格式版本（v3=ChromaDB），不匹配时强制重建

# Chroma 客户端（延迟初始化）
_chroma_client = None
_chroma_collection = None
_current_vault_path = None


def _get_chroma_collection(vault_path):
    """获取或初始化 Chroma 集合
    
    每个 vault 对应一个 collection，collection 名称为 vault 路径的哈希
    """
    global _chroma_client, _chroma_collection, _current_vault_path
    
    if not _chroma_available:
        return None
    
    # 如果 vault 路径变了，需要重新初始化
    if vault_path != _current_vault_path or _chroma_collection is None:
        try:
            import hashlib
            # 使用 vault 路径的哈希作为 collection 名称
            vault_hash = hashlib.md5(vault_path.encode()).hexdigest()[:16]
            collection_name = f"vault_{vault_hash}"
            
            # Chroma 数据存储在 cache/embeddings 目录
            chroma_db_path = _embedding_cache_dir
            chroma_db_path.mkdir(parents=True, exist_ok=True)
            
            # 初始化客户端
            _chroma_client = chromadb.PersistentClient(
                path=str(chroma_db_path),
                settings=Settings(anonymized_telemetry=False)
            )
            
            # 获取或创建 collection
            _chroma_collection = _chroma_client.get_or_create_collection(
                name=collection_name,
                metadata={"vault_path": vault_path, "version": _INDEX_VERSION}
            )
            
            _current_vault_path = vault_path
            print(f"[Embedding] Chroma collection 初始化完成: {collection_name}")
            
        except Exception as e:
            print(f"[Embedding] Chroma 初始化失败: {e}")
            _chroma_collection = None
            return None
    
    return _chroma_collection


# Local model (lazy load)
_embedding_model = None
_tokenizer = None
_device = "cpu"
_dml_device = None
_torch_directml = None  # 缓存 torch_directml 模块引用


def _load_model():
    """延迟加载本地 model"""
    global _embedding_model, _tokenizer, _model_loading, _embedding_available, _device, _dml_device, _torch_directml, _model_load_lock
    
    # 线程锁：防止多个线程同时加载模型导致竞态问题
    if not _model_load_lock.acquire(blocking=False):
        # 其他线程正在加载模型，等待它完成
        with _model_load_lock:
            pass  # 锁释放后，_embedding_model 应该已经被设置了
        return _embedding_model is not None
    
    try:
        if _embedding_model is not None:
            return True
        
        _model_loading = True
        print(f"[Embedding] 正在加载本地模型：{_embedding_model_name}")
        
        import torch
        import os
        
        # 设置离线模式，避免连接 HuggingFace 超时
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        
        # 尝试使用 DirectML (支持所有 Windows GPU，包括 RTX 5060)
        _device = "cpu"
        _dml_device = None
        _torch_directml = None
        try:
            import torch_directml
            _torch_directml = torch_directml
            _dml_device = torch_directml.device()
            print(f"[Embedding] DirectML 可用，使用 GPU 加速: {torch_directml.device_name(0)}")
        except ImportError:
            print("[Embedding] torch-directml 未安装，使用 CPU")
        except Exception as dml_err:
            print(f"[Embedding] DirectML 初始化失败，使用 CPU: {dml_err}")
            _dml_device = None
        
        # 用 transformers 加载（手动控制推理，绕过 DirectML 不兼容操作）
        from transformers import AutoModel, AutoTokenizer
        
        _tokenizer = AutoTokenizer.from_pretrained(_embedding_model_name, trust_remote_code=True, padding_side="left")
        
        if _dml_device is not None:
            # DirectML: 用 float32 加载
            _embedding_model = AutoModel.from_pretrained(
                _embedding_model_name,
                trust_remote_code=True,
                dtype=torch.float32
            )
            _embedding_model = _embedding_model.to(_dml_device)
            print("[Embedding] Model 加载完成！(DirectML GPU 模式)")
        else:
            _embedding_model = AutoModel.from_pretrained(
                _embedding_model_name,
                trust_remote_code=True
            )
            print("[Embedding] Model 加载完成！(CPU 模式)")
        
        _embedding_model.eval()
        _embedding_available = True
        _model_loading = False
        return True
    except ImportError as e:
        _model_loading = False
        print(f"[Embedding] 缺少依赖库：{e}")
        print("[Embedding] 请运行：uv pip install modelscope torch torch-directml")
        return False
    except Exception as e:
        _model_loading = False
        print(f"[Embedding] 模型加载失败：{e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        _model_load_lock.release()


def _compute_embedding_batch(texts):
    """批量计算文本的 embedding 向量
    
    Qwen3-Embedding 是 decoder-only 模型，用 last token 的 hidden state
    """
    if not _load_model():
        return None
    
    try:
        import torch
        
        # 批量处理：GPU 用较大 batch 提升吞吐，CPU 用小 batch 避免内存爆炸
        # RTX 5060 8GB 显存，但通常被其他应用占用，可用显存有限
        # 从小 batch 开始，成功后逐步升级，避免反复 OOM 试探
        max_len = 512
        initial_batch_size = 2 if _dml_device is not None else 8
        max_batch_size = 8 if _dml_device is not None else 8  # 成功后可升级的上限
        all_embeddings = []
        total = len(texts)
        
        i = 0
        batch_size = initial_batch_size
        consecutive_oom = 0
        consecutive_success = 0
        # 记录已验证可用的最大 batch_size，避免反复试探
        stable_batch_size = 1
        # 是否已找到稳定 batch（首次成功后设为 True，之后不再尝试升级）
        found_stable = False
        
        while i < total:
            # 如果还没找到稳定 batch，使用当前试探值；找到后固定使用
            cur_batch = batch_size if not found_stable else stable_batch_size
            batch = texts[i:i + cur_batch]
            # 截断过长的文本（token 化前先截字符，避免无谓 tokenize）
            batch = [t[:4000] if len(t) > 4000 else t for t in batch]
            
            # Tokenize (padding_side="left" 已在加载时设置)
            encoded = _tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=max_len,
                return_tensors="pt"
            )
            
            # 把输入移到设备
            if _dml_device is not None:
                encoded = {k: v.to(_dml_device) for k, v in encoded.items()}
            
            # Compute embeddings（带 OOM 自动降级重试）
            try:
                with torch.no_grad():
                    outputs = _embedding_model(**encoded)
                    last_hidden = outputs.last_hidden_state
                    
                    # Qwen3-Embedding 用 last token（因为 padding_side="left"，最后一个 token 是有效 token）
                    embeddings = last_hidden[:, -1, :]
                    
                    # Normalize
                    embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
                    
                    # Convert to list (先移回 CPU)
                    batch_embeddings = embeddings.cpu().tolist()
                    all_embeddings.extend(batch_embeddings)
                    
                    # 释放显存
                    del outputs, last_hidden, embeddings, encoded
                
                # 成功：记录当前 batch 为稳定值
                if not found_stable:
                    stable_batch_size = cur_batch
                    found_stable = True
                    print(f"[Embedding] 确定稳定 batch_size={cur_batch}")
                
                consecutive_oom = 0
                
                # 不再升级 batch_size，保持稳定值
                
                # 每个批次后清理（DirectML 显存回收较慢）
                import gc
                gc.collect()
                if _dml_device is not None and _torch_directml is not None:
                    try:
                        _torch_directml.empty_cache()
                    except Exception:
                        pass
                
                # 每 5 个批次打印一次进度
                batch_num = (i // stable_batch_size) + 1
                if batch_num % 5 == 0 or i + cur_batch >= total:
                    print(f"[Embedding] 进度：{min(i + cur_batch, total)}/{total} (batch={cur_batch})")
                
                i += cur_batch
            except RuntimeError as oom_err:
                # OOM：释放显存，减半 batch_size 重试
                if "not enough GPU video memory" in str(oom_err) or "out of memory" in str(oom_err).lower():
                    try:
                        del encoded
                    except Exception:
                        pass
                    import gc
                    gc.collect()
                    if _dml_device is not None and _torch_directml is not None:
                        try:
                            _torch_directml.empty_cache()
                        except Exception:
                            pass
                    
                    # 稳定后遇到 OOM，跳过当前文件（不改变 batch_size）
                    if found_stable:
                        print(f"[Embedding] 文件过大 OOM，跳过当前文件，保持 batch_size={stable_batch_size}")
                        all_embeddings.append([0.0] * 1024)  # 占位向量
                        i += 1
                        continue
                    
                    if batch_size > 1:
                        print(f"[Embedding] GPU OOM，batch_size {batch_size} → {batch_size // 2} 重试...")
                        batch_size = batch_size // 2
                        consecutive_oom += 1
                        if consecutive_oom >= 3 and batch_size == 1:
                            print(f"[Embedding] batch=1 仍连续 OOM，跳过剩余 {total - i} 个文件")
                            break
                        continue
                    else:
                        print(f"[Embedding] batch=1 仍 OOM，跳过当前文件")
                        all_embeddings.append([0.0] * 1024)  # 占位向量
                        i += 1
                        consecutive_oom = 0
                        continue
                else:
                    raise
        
        print(f"[Embedding] 成功获取 {len(all_embeddings)} 个 embedding")
        return all_embeddings
    except Exception as e:
        print(f"[Embedding] 计算 embedding 失败：{e}")
        import traceback
        traceback.print_exc()
        return None


def _compute_embedding(text):
    """计算单个文本的 embedding 向量"""
    embeddings = _compute_embedding_batch([text])
    if embeddings:
        return embeddings[0]
    return None


def _cosine_similarity(vec1, vec2):
    """计算两个向量的余弦相似度"""
    if vec1 is None or vec2 is None:
        return 0.0
    if not _numpy_available or np is None:
        # Pure Python calculation
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = sum(a * a for a in vec1) ** 0.5
        norm2 = sum(b * b for b in vec2) ** 0.5
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot_product / (norm1 * norm2)
    v1 = np.array(vec1)
    v2 = np.array(vec2)
    dot_product = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot_product / (norm1 * norm2)


def _ensure_cache_dir():
    """确保缓存目录存在"""
    _embedding_cache_dir.mkdir(parents=True, exist_ok=True)


# ── 文本分块（chunk）─────────────────────────────────────────────
# 每个文件切成多个 chunk，每个 chunk 单独算 embedding
# 搜索时返回匹配的 chunk 内容，而不是整个文件
_CHUNK_MAX_CHARS = 1200   # 单个 chunk 最大字符数
_CHUNK_OVERLAP = 100      # chunk 之间的重叠字符数（避免切断语义）
_CHUNK_MIN_CHARS = 50     # 小于此长度的段落合并到前一段
_MAX_CHUNKS_PER_FILE = 15 # 单个文件最多 chunk 数（避免超大文件爆炸）


def _chunk_text(content):
    """把文本切成多个 chunk
    
    策略：
    1. 按双换行分段（保留段落语义）
    2. 过长段落按 _CHUNK_MAX_CHARS 切分（带重叠）
    3. 过短段落合并到前一段
    4. 限制每个文件最多 _MAX_CHUNKS_PER_FILE 个 chunk
    """
    if not content:
        return []
    
    # 按双换行分段
    raw_paragraphs = content.split('\n\n')
    
    # 第一轮：处理过长段落，按 _CHUNK_MAX_CHARS 切分（带重叠）
    paragraphs = []
    for para in raw_paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para) <= _CHUNK_MAX_CHARS:
            paragraphs.append(para)
        else:
            # 长段落切分，带重叠
            start = 0
            while start < len(para):
                end = start + _CHUNK_MAX_CHARS
                chunk = para[start:end]
                # 尽量在句号/换行处切分
                if end < len(para):
                    # 找最后一个句号或换行
                    for sep in ['\n', '。', '. ', '；', '; ', '，', ', ']:
                        last_sep = chunk.rfind(sep)
                        if last_sep > _CHUNK_MAX_CHARS // 2:
                            end = start + last_sep + len(sep)
                            chunk = para[start:end]
                            break
                paragraphs.append(chunk.strip())
                if end >= len(para):
                    break
                start = end - _CHUNK_OVERLAP
                if start < 0:
                    start = 0
    
    # 第二轮：合并过短段落
    merged = []
    for para in paragraphs:
        if len(para) < _CHUNK_MIN_CHARS and merged:
            # 合并到前一段
            merged[-1] = merged[-1] + '\n\n' + para
        else:
            merged.append(para)
    
    # 限制 chunk 数量（取前 N 个，保留开头内容）
    if len(merged) > _MAX_CHUNKS_PER_FILE:
        merged = merged[:_MAX_CHUNKS_PER_FILE]
    
    # 计算每个 chunk 在原文中的字符位置
    chunks = []
    search_pos = 0
    for para in merged:
        # 在原文中查找该段落位置（容错：找第一个匹配位置）
        idx = content.find(para[:80], search_pos)
        if idx < 0:
            idx = search_pos
        char_start = idx
        char_end = idx + len(para)
        search_pos = char_end
        chunks.append({
            "text": para,
            "charStart": char_start,
            "charEnd": char_end
        })
    
    return chunks


# 文件变更通知：收集变更文件，延迟批量增量更新索引
_pending_file_changes = set()       # 待处理的文件路径集合
_pending_changes_lock = threading.Lock()
_pending_changes_timer = None       # 延迟触发的 Timer
_PENDING_CHANGES_DELAY = 3.0       # 收集窗口（秒），3 秒内的变更合并为一次增量更新


def notify_file_changed(src_path):
    """watchdog 检测到文件变化时调用，收集变更并延迟触发增量索引更新
    
    多个文件短时间内连续变化时，会合并为一次增量更新，避免频繁重建索引。
    """
    global _pending_changes_timer, _index_cache
    if not src_path or not os.path.isfile(src_path):
        # 文件已删除，也需要更新索引（移除旧 chunk）
        if src_path:
            with _pending_changes_lock:
                _pending_file_changes.add(src_path)
        else:
            return
    else:
        with _pending_changes_lock:
            _pending_file_changes.add(src_path)

    # 重置定时器（trailing edge：3 秒内无新变更才触发）
    with _pending_changes_lock:
        if _pending_changes_timer is not None:
            _pending_changes_timer.cancel()
        _pending_changes_timer = threading.Timer(_PENDING_CHANGES_DELAY, _do_pending_update)
        _pending_changes_timer.daemon = True
        _pending_changes_timer.start()


def _do_pending_update():
    """执行待处理的增量索引更新"""
    global _index_cache, _pending_changes_timer
    _pending_changes_timer = None

    with _pending_changes_lock:
        files = set(_pending_file_changes)
        _pending_file_changes.clear()

    if not files:
        return

    # 正在构建中，跳过（避免冲突）
    if _index_build_status["building"]:
        return

    # 没有索引文件，无法增量更新（需要先 build_index）
    if not _index_file.exists():
        return

    try:
        cached_index = _load_index_file()
        if cached_index is None:
            return
    except Exception:
        return

    vault_path = cached_index.get("vault_path", "")
    if not vault_path or not os.path.isdir(vault_path):
        return

    # 验证变更文件属于当前 vault
    vault_prefix = vault_path.replace("\\", "/").rstrip("/")
    new_files = []
    deleted_files = []
    for fp in files:
        normalized = fp.replace("\\", "/")
        if not normalized.startswith(vault_prefix):
            continue  # 不属于当前 vault，跳过
        if os.path.isfile(fp):
            new_files.append(fp)
        else:
            deleted_files.append(fp)

    if not new_files and not deleted_files:
        return

    # 清除内存缓存，确保下次搜索读到最新索引
    _index_cache = None

    print(f"[Embedding] 文件变更触发增量更新：新增/修改 {len(new_files)} 个，删除 {len(deleted_files)} 个")
    _start_background_update_local(vault_path, cached_index, new_files, deleted_files)


def _start_background_update_local(vault_path, cached_index, new_files, deleted_files):
    """后台增量更新索引（从模块级别调用，非 RPC 内部函数）"""
    global _index_build_status

    _index_build_status = {
        "building": True,
        "progress": 0,
        "total": len(new_files),
        "error": None,
        "complete": False
    }

    def update_thread():
        try:
            text_extensions = ['.md', '.txt', '.json', '.py', '.js', '.ts', '.html', '.css', '.yaml', '.yml', '.xml', '.csv', '.log', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1']
            max_content_length = 20000

            index_data = cached_index.get("index", [])

            # Remove all chunks of deleted files
            index_data = [item for item in index_data if item.get("path") not in deleted_files]

            # Remove all chunks in main directory
            index_data = [item for item in index_data if "\\main\\" not in item.get("path", "").replace('/', '\\') and not item.get("path", "").endswith("\\main")]

            # Filter out new files in main directory
            new_files_filtered = [f for f in new_files if "\\main\\" not in f.replace('/', '\\') and not f.endswith("\\main")]

            # Collect new/modified files' chunks
            texts_to_encode = []
            chunk_metadata = []

            for i, fp in enumerate(new_files_filtered):
                try:
                    fileName = os.path.basename(fp)
                    file_ext = os.path.splitext(fp)[1].lower()

                    content = ""
                    if file_ext in text_extensions:
                        try:
                            content = Path(fp).read_text(encoding="utf-8")
                            if len(content) > max_content_length:
                                content = content[:max_content_length]
                        except UnicodeDecodeError:
                            try:
                                content = Path(fp).read_text(encoding="gbk")
                                if len(content) > max_content_length:
                                    content = content[:max_content_length]
                            except:
                                content = ""
                        except Exception:
                            content = ""

                    # 分块
                    chunks = _chunk_text(content) if content else []

                    try:
                        file_mtime = os.path.getmtime(fp)
                    except:
                        file_mtime = 0

                    if not chunks:
                        chunks = [{"text": fileName, "charStart": 0, "charEnd": 0}]

                    # 移除该文件旧的 chunk（modified files）
                    index_data = [item for item in index_data if item.get("path") != fp]

                    for chunk_idx, chunk in enumerate(chunks):
                        combined = fileName + " " + chunk["text"]
                        texts_to_encode.append(combined)
                        chunk_metadata.append({
                            "path": fp,
                            "fileName": fileName,
                            "fileExt": file_ext,
                            "length": len(content),
                            "mtime": file_mtime,
                            "chunkIdx": chunk_idx,
                            "chunkTotal": len(chunks),
                            "chunkText": chunk["text"],
                            "charStart": chunk["charStart"],
                            "charEnd": chunk["charEnd"]
                        })
                except Exception as e:
                    print(f"[Embedding] 处理变更文件失败：{fp}, {e}")
                    continue

            # Batch encode
            if texts_to_encode:
                print(f"[Embedding] 开始编码 {len(texts_to_encode)} 个 chunk（来自 {len(new_files_filtered)} 个变更文件）...")
                embeddings = _compute_embedding_batch(texts_to_encode)

                if embeddings:
                    for i, meta in enumerate(chunk_metadata):
                        index_data.append({
                            **meta,
                            "embedding": embeddings[i]
                        })

            # Save updated index
            _save_index_file({
                "vault_path": vault_path,
                "model": _embedding_model_name,
                "provider": "local",
                "version": _INDEX_VERSION,
                "count": len(index_data),
                "chunkCount": len(index_data),
                "index": index_data
            })

            print(f"[Embedding] 增量更新完成，共 {len(index_data)} 个 chunk")
            _index_build_status["building"] = False
            _index_build_status["complete"] = True
        except Exception as e:
            print(f"[Embedding] 增量更新失败：{e}")
            _index_build_status["error"] = str(e)
            _index_build_status["building"] = False

    thread = threading.Thread(target=update_thread, daemon=True)
    thread.start()


def _save_index_file(index_data_obj):
    """原子写入索引文件（加锁 + 先写临时文件再重命名，防止并发写入和写入中途崩溃导致损坏）"""
    with _index_write_lock:
        _ensure_cache_dir()
        tmp_file = _index_file.with_suffix(".tmp")
        try:
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(index_data_obj, f, ensure_ascii=False)
            # Windows 需要先删除目标文件才能 rename
            if _index_file.exists():
                _index_file.unlink()
            tmp_file.rename(_index_file)
        except Exception:
            # 写入失败，清理临时文件
            try:
                tmp_file.unlink()
            except Exception:
                pass
            raise


def _load_index_file():
    """读取索引文件，损坏时自动删除并返回 None"""
    try:
        with open(_index_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"[Embedding] 索引文件损坏，将删除并重建: {e}")
        try:
            _index_file.unlink()
        except Exception:
            pass
        global _index_cache
        _index_cache = None
        return None
    except Exception:
        return None


def reset_on_vault_switch():
    """vault 切换时清除索引缓存和构建状态，强制新 vault 重建索引"""
    global _index_cache, _index_build_status, _last_index_check_time, _pending_changes_timer, _chroma_collection, _current_vault_path
    # 取消待处理的增量更新
    with _pending_changes_lock:
        _pending_file_changes.clear()
        if _pending_changes_timer is not None:
            _pending_changes_timer.cancel()
            _pending_changes_timer = None
    _index_cache = None
    _chroma_collection = None  # 清除 Chroma collection 缓存
    _current_vault_path = None
    _index_build_status = {
        "building": False,
        "progress": 0,
        "total": 0,
        "error": None,
        "complete": False
    }
    _last_index_check_time = 0
    print("[Embedding] vault 已切换，索引缓存和 Chroma collection 已清除")


def register(gw):
    """注册 RPC 方法"""
    _ensure_cache_dir()
    
    def _set_api_key(rid, params):
        """API key 设置（保留兼容性，但不再需要）"""
        return gw._ok(rid, {"status": "using_local_model"})
    
    gw._methods["embedding.set_api_key"] = _set_api_key

    def _embedding_save_config(rid, params):
        """保存配置（保留兼容性）"""
        model = params.get("model", "")
        if model and model != _embedding_model_name:
            print(f"[Embedding] 警告：本地模型固定为 {_embedding_model_name}, 无法更改")
        return gw._ok(rid, {"status": "using_local_model", "model": _embedding_model_name})

    gw._methods["embedding.save_config"] = _embedding_save_config

    def _embedding_compute(rid, params):
        """计算文本的 embedding 向量"""
        texts = params.get("texts", [])
        if not texts:
            return gw._err(rid, 4000, "texts required")
        
        embeddings = _compute_embedding_batch(texts)
        if embeddings is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        return gw._ok(rid, {"embeddings": embeddings, "count": len(embeddings)})

    def _embedding_similarity(rid, params):
        """计算两个文本的相似度"""
        text1 = params.get("text1", "")
        text2 = params.get("text2", "")
        if not text1 or not text2:
            return gw._err(rid, 4000, "text1 and text2 required")
        
        embeddings = _compute_embedding_batch([text1, text2])
        if embeddings is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        similarity = _cosine_similarity(embeddings[0], embeddings[1])
        return gw._ok(rid, {"similarity": float(similarity)})

    def _embedding_search(rid, params):
        """使用向量搜索文件"""
        query = params.get("query", "")
        top_k = params.get("top_k", 5)
        
        if not query:
            return gw._err(rid, 4000, "query required")
        
        if not _index_file.exists():
            return gw._err(rid, 4004, "index not built, please call embedding.build_index first")
        
        query_embedding = _compute_embedding(query)
        if query_embedding is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        try:
            index_data = _load_index_file()
            if index_data is None:
                return gw._ok(rid, {"results": [], "total": 0})
            
            documents = index_data.get("index", [])
            if not documents:
                return gw._ok(rid, {"results": [], "total": 0})
            
            results = []
            for i, doc in enumerate(documents):
                similarity = _cosine_similarity(query_embedding, doc.get("embedding", []))
                results.append({
                    "path": doc.get("path", ""),
                    "similarity": float(similarity),
                    "fileName": doc.get("fileName", "")
                })
            
            # Sort by similarity
            results.sort(key=lambda x: x["similarity"], reverse=True)
            
            # 按路径去重并收集每个文件的所有 chunk
            file_chunks = {}
            for r in results:
                path = r["path"]
                if path not in file_chunks:
                    file_chunks[path] = []
                file_chunks[path].append(r)
            
            # 限制文件数量，保留 top_k 个文件
            top_file_paths = list(file_chunks.keys())[:top_k]
            
            # 返回这些文件的完整信息（包含所有 chunk）
            deduped_results = []
            for path in top_file_paths:
                chunks = file_chunks[path]
                # 取平均相似度作为该文件的代表分数
                avg_similarity = sum(c["similarity"] for c in chunks) / len(chunks)
                deduped_results.append({
                    "path": path,
                    "similarity": float(avg_similarity),
                    "fileName": chunks[0]["fileName"],
                    "chunkCount": len(chunks),  # 新增字段：该文件有多少 chunk 匹配
                    "chunks": chunks  # 新增字段：包含所有匹配的 chunk
                })
            
            # Sort files by average similarity
            deduped_results.sort(key=lambda x: x["similarity"], reverse=True)
            
            return gw._ok(rid, {"results": deduped_results, "total": len(deduped_results)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    # Background build function
    def _start_background_build(vault_path, all_files):
        """后台完整构建索引"""
        global _index_build_status, _current_vault_path
        _index_build_status = {
            "building": True,
            "progress": 0,
            "total": len(all_files),
            "error": None,
            "complete": False
        }
        # 设置当前 vault 路径，供后续查询使用
        _current_vault_path = vault_path
        
        def build_thread():
            try:
                # Readable file types
                text_extensions = ['.md', '.txt', '.json', '.py', '.js', '.ts', '.html', '.css', '.yaml', '.yml', '.xml', '.csv', '.log', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1']
                max_content_length = 20000  # 读取更多内容用于分块
                
                # Step 1: Collect all chunks and metadata
                texts_to_encode = []  # 每个 chunk 的文本
                chunk_metadata = []   # 每个 chunk 的元数据
                print(f"[Embedding] 正在读取文件内容并分块...")
                
                for i, fp in enumerate(all_files):
                    try:
                        fileName = os.path.basename(fp)
                        file_ext = os.path.splitext(fp)[1].lower()
                        
                        content = ""
                        if file_ext in text_extensions:
                            try:
                                content = Path(fp).read_text(encoding="utf-8")
                                if len(content) > max_content_length:
                                    content = content[:max_content_length]
                            except UnicodeDecodeError:
                                try:
                                    content = Path(fp).read_text(encoding="gbk")
                                    if len(content) > max_content_length:
                                        content = content[:max_content_length]
                                except:
                                    content = ""
                            except Exception:
                                content = ""
                        
                        # 分块
                        chunks = _chunk_text(content) if content else []
                        
                        try:
                            file_mtime = os.path.getmtime(fp)
                        except:
                            file_mtime = 0
                        
                        if not chunks:
                            # 无内容文件，用文件名作为唯一 chunk
                            chunks = [{"text": fileName, "charStart": 0, "charEnd": 0}]
                        
                        for chunk_idx, chunk in enumerate(chunks):
                            # chunk 文本前缀加上文件名，提升文件名匹配权重
                            combined = fileName + " " + chunk["text"]
                            texts_to_encode.append(combined)
                            chunk_metadata.append({
                                "path": fp,
                                "fileName": fileName,
                                "fileExt": file_ext,
                                "length": len(content),
                                "mtime": file_mtime,
                                "chunkIdx": chunk_idx,
                                "chunkTotal": len(chunks),
                                "chunkText": chunk["text"],
                                "charStart": chunk["charStart"],
                                "charEnd": chunk["charEnd"]
                            })
                        
                        if (i + 1) % 100 == 0:
                            print(f"[Embedding] 读取进度：{i + 1}/{len(all_files)}（已生成 {len(texts_to_encode)} 个 chunk）")
                    except Exception as e:
                        print(f"[Embedding] 读取文件失败：{fp}, {e}")
                        continue
                
                # Step 2: Batch encode (using local model)
                print(f"[Embedding] 开始批量编码 {len(texts_to_encode)} 个 chunk（来自 {len(all_files)} 个文件）...")
                embeddings = _compute_embedding_batch(texts_to_encode)
                
                if embeddings is None:
                    _index_build_status["error"] = "embedding model failed"
                    _index_build_status["building"] = False
                    return
                
                # Step 3: Save to Chroma
                _index_build_status["progress"] = len(all_files)
                
                # 获取 Chroma collection
                collection = _get_chroma_collection(vault_path)
                
                if collection is not None and _chroma_available:
                    # 清空旧数据
                    try:
                        collection.delete(where={"vault_path": vault_path})
                        print(f"[Embedding] 已清空旧索引数据")
                    except Exception as e:
                        print(f"[Embedding] 清空旧数据警告: {e}")
                    
                    # 批量添加到 Chroma
                    batch_size = 100
                    total_chunks = len(chunk_metadata)
                    
                    for batch_start in range(0, total_chunks, batch_size):
                        batch_end = min(batch_start + batch_size, total_chunks)
                        batch_ids = [f"chunk_{i}" for i in range(batch_start, batch_end)]
                        batch_embeddings = [embeddings[i] if isinstance(embeddings[i], list) else embeddings[i].tolist() for i in range(batch_start, batch_end)]
                        batch_documents = [texts_to_encode[i] for i in range(batch_start, batch_end)]
                        batch_metadatas = [{
                            "path": chunk_metadata[i]["path"],
                            "fileName": chunk_metadata[i]["fileName"],
                            "fileExt": chunk_metadata[i]["fileExt"],
                            "length": chunk_metadata[i]["length"],
                            "mtime": chunk_metadata[i]["mtime"],
                            "chunkIdx": chunk_metadata[i]["chunkIdx"],
                            "chunkTotal": chunk_metadata[i]["chunkTotal"],
                            "chunkText": chunk_metadata[i]["chunkText"],
                            "charStart": chunk_metadata[i]["charStart"],
                            "charEnd": chunk_metadata[i]["charEnd"],
                            "vault_path": vault_path
                        } for i in range(batch_start, batch_end)]
                        
                        collection.add(
                            ids=batch_ids,
                            embeddings=batch_embeddings,
                            documents=batch_documents,
                            metadatas=batch_metadatas
                        )
                        
                        if (batch_end // batch_size) % 10 == 0:
                            print(f"[Embedding] Chroma 写入进度: {batch_end}/{total_chunks}")
                    
                    print(f"[Embedding] Chroma 索引构建完成，共 {total_chunks} 个 chunk")
                else:
                    # Chroma 不可用，回退到 JSON 模式
                    print("[Embedding] Chroma 不可用，使用 JSON 回退模式")
                    index_data = []
                    for i, meta in enumerate(chunk_metadata):
                        index_data.append({
                            **meta,
                            "embedding": embeddings[i]
                        })
                    
                    _save_index_file({
                        "vault_path": vault_path,
                        "model": _embedding_model_name,
                        "provider": "local",
                        "version": _INDEX_VERSION,
                        "count": len(index_data),
                        "fileCount": len(all_files),
                        "chunkCount": len(index_data),
                        "index": index_data
                    })
                
                print(f"[Embedding] 后台构建完成，共 {len(chunk_metadata)} 个 chunk（来自 {len(all_files)} 个文件）")
                _index_build_status["building"] = False
                _index_build_status["complete"] = True
            except Exception as e:
                print(f"[Embedding] 后台构建失败：{e}")
                _index_build_status["error"] = str(e)
                _index_build_status["building"] = False
        
        thread = threading.Thread(target=build_thread, daemon=True)
        thread.start()

    def _start_background_update(vault_path, cached_index, new_files, deleted_files):
        """后台增量更新索引"""
        global _index_build_status
        _index_build_status = {
            "building": True,
            "progress": 0,
            "total": len(new_files),
            "error": None,
            "complete": False
        }
        
        def update_thread():
            try:
                text_extensions = ['.md', '.txt', '.json', '.py', '.js', '.ts', '.html', '.css', '.yaml', '.yml', '.xml', '.csv', '.log', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1']
                max_content_length = 20000
                
                index_data = cached_index.get("index", [])
                
                # Remove all chunks of deleted files
                index_data = [item for item in index_data if item.get("path") not in deleted_files]
                
                # Remove all chunks in main directory
                index_data = [item for item in index_data if "\\main\\" not in item.get("path", "").replace('/', '\\') and not item.get("path", "").endswith("\\main")]
                
                # Filter out new files in main directory
                new_files_filtered = [f for f in new_files if "\\main\\" not in f.replace('/', '\\') and not f.endswith("\\main")]
                
                # Collect new/modified files' chunks
                texts_to_encode = []
                chunk_metadata = []
                
                for i, fp in enumerate(new_files_filtered):
                    try:
                        fileName = os.path.basename(fp)
                        file_ext = os.path.splitext(fp)[1].lower()
                        
                        content = ""
                        if file_ext in text_extensions:
                            try:
                                content = Path(fp).read_text(encoding="utf-8")
                                if len(content) > max_content_length:
                                    content = content[:max_content_length]
                            except UnicodeDecodeError:
                                try:
                                    content = Path(fp).read_text(encoding="gbk")
                                    if len(content) > max_content_length:
                                        content = content[:max_content_length]
                                except:
                                    content = ""
                            except Exception:
                                content = ""
                        
                        # 分块
                        chunks = _chunk_text(content) if content else []
                        
                        try:
                            file_mtime = os.path.getmtime(fp)
                        except:
                            file_mtime = 0
                        
                        if not chunks:
                            chunks = [{"text": fileName, "charStart": 0, "charEnd": 0}]
                        
                        # 移除该文件旧的 chunk（modified files）
                        index_data = [item for item in index_data if item.get("path") != fp]
                        
                        for chunk_idx, chunk in enumerate(chunks):
                            combined = fileName + " " + chunk["text"]
                            texts_to_encode.append(combined)
                            chunk_metadata.append({
                                "path": fp,
                                "fileName": fileName,
                                "fileExt": file_ext,
                                "length": len(content),
                                "mtime": file_mtime,
                                "chunkIdx": chunk_idx,
                                "chunkTotal": len(chunks),
                                "chunkText": chunk["text"],
                                "charStart": chunk["charStart"],
                                "charEnd": chunk["charEnd"]
                            })
                    except Exception as e:
                        print(f"[Embedding] 处理新增文件失败：{fp}, {e}")
                        continue
                
                # Batch encode
                if texts_to_encode:
                    print(f"[Embedding] 开始编码 {len(texts_to_encode)} 个 chunk（来自 {len(new_files)} 个文件）...")
                    embeddings = _compute_embedding_batch(texts_to_encode)
                    
                    if embeddings:
                        for i, meta in enumerate(chunk_metadata):
                            index_data.append({
                                **meta,
                                "embedding": embeddings[i]
                            })
                
                # Save updated index
                _ensure_cache_dir()
                with open(_index_file, "w", encoding="utf-8") as f:
                    json.dump({
                        "vault_path": vault_path,
                        "model": _embedding_model_name,
                        "provider": "local",
                        "version": _INDEX_VERSION,
                        "count": len(index_data),
                        "chunkCount": len(index_data),
                        "index": index_data
                    }, f, ensure_ascii=False)
                
                print(f"[Embedding] 后台更新完成，共 {len(index_data)} 个 chunk")
                _index_build_status["building"] = False
                _index_build_status["complete"] = True
            except Exception as e:
                print(f"[Embedding] 后台更新失败：{e}")
                _index_build_status["error"] = str(e)
                _index_build_status["building"] = False
        
        thread = threading.Thread(target=update_thread, daemon=True)
        thread.start()

    def _embedding_build_index(rid, params):
        """构建 vault 的向量索引（后台运行，不阻塞主线程）- Chroma 版本"""
        vault_path = params.get("vault_path", "")
        if not vault_path or not os.path.isdir(vault_path):
            return gw._err(rid, 4004, f"vault path not found: {vault_path}")
        
        # 设置当前 vault 路径
        global _current_vault_path
        _current_vault_path = vault_path
        
        # If already building, return current status
        if _index_build_status["building"]:
            return gw._ok(rid, {
                "status": "building",
                "progress": _index_build_status["progress"],
                "total": _index_build_status["total"]
            })
        
        # Collect all files (exclude archive folders + main directory)
        _EXCLUDE_DIRS = {'_archive', 'archive', '_archived', 'archived', '_old', 'old', 'trash', '.trash', '_archive_old', 'archive_old', 'main'}
        all_files = []
        for root, dirs, files in os.walk(vault_path):
            dirs[:] = [d for d in dirs if not d.startswith('.') and d.lower() not in _EXCLUDE_DIRS]
            for f in files:
                if not f.startswith('.'):
                    all_files.append(os.path.join(root, f))
        
        # 优先检查 Chroma
        if _chroma_available:
            try:
                collection = _get_chroma_collection(vault_path)
                if collection is not None:
                    # 获取 Chroma 中的统计信息
                    count = collection.count()
                    if count > 0:
                        # 检查是否有文件变化
                        # 简化处理：如果 Chroma 中有数据，直接返回缓存状态
                        # 文件变化检测由前端触发重建
                        print(f"[Embedding] Chroma 索引已存在（{count} 个 chunk），直接加载")
                        return gw._ok(rid, {
                            "count": count,
                            "index_type": "chroma",
                            "loaded_from_cache": True
                        })
            except Exception as e:
                print(f"[Embedding] 检查 Chroma 索引失败：{e}")
        
        # 回退到 JSON 检查（兼容性）
        if _index_file.exists():
            try:
                cached_index = _load_index_file()
                if cached_index is not None:
                    cached_version = cached_index.get("version", 1)
                    if cached_version != _INDEX_VERSION:
                        print(f"[Embedding] 索引版本不匹配（缓存 v{cached_version} ≠ 当前 v{_INDEX_VERSION}），强制重建...")
                        _start_background_build(vault_path, all_files)
                        return gw._ok(rid, {
                            "status": "building",
                            "total": len(all_files),
                            "reason": "index version mismatch, rebuilding"
                        })
                    
                    if cached_index.get("vault_path") == vault_path and cached_index.get("model") == _embedding_model_name:
                        cached_files = set(item.get("path") for item in cached_index.get("index", []))
                        current_files = set(all_files)
                        new_files = current_files - cached_files
                        deleted_files = cached_files - current_files
                        
                        modified_files = []
                        cached_index_map = {item.get("path"): item for item in cached_index.get("index", [])}
                        for fp in current_files:
                            if fp in cached_index_map:
                                try:
                                    current_mtime = os.path.getmtime(fp)
                                    cached_mtime = cached_index_map[fp].get("mtime", 0)
                                    if current_mtime > cached_mtime:
                                        modified_files.append(fp)
                                except:
                                    pass
                        
                        if len(new_files) == 0 and len(deleted_files) == 0 and len(modified_files) == 0:
                            print(f"[Embedding] JSON 索引无变化，直接加载（{cached_index.get('count', 0)} 个文件）")
                            return gw._ok(rid, {
                                "count": cached_index.get("count", 0),
                                "index_file": str(_index_file),
                                "loaded_from_cache": True
                            })
                        
                        print(f"[Embedding] JSON 发现文件变化：新增 {len(new_files)} 个，删除 {len(deleted_files)} 个，修改 {len(modified_files)} 个，后台更新...")
                        all_new_files = list(new_files) + modified_files
                        _start_background_update(vault_path, cached_index, all_new_files, deleted_files)
                        return gw._ok(rid, {
                            "status": "updating",
                            "new_files": len(new_files),
                            "deleted_files": len(deleted_files)
                        })
            except Exception as e:
                print(f"[Embedding] 加载 JSON 缓存索引失败：{e}，将后台重新构建")
        
        print(f"[Embedding] 找到 {len(all_files)} 个文件，开始后台构建...")
        _start_background_build(vault_path, all_files)
        return gw._ok(rid, {
            "status": "building",
            "total": len(all_files)
        })

    def _maybe_refresh_index():
        """轻量检查索引是否过期，过期则触发后台更新（每 5 分钟最多检查一次）"""
        global _last_index_check_time
        now = time.time()
        if now - _last_index_check_time < _INDEX_CHECK_INTERVAL:
            return  # 距离上次检查不足 5 分钟，跳过
        if _index_build_status["building"]:
            return  # 正在构建/更新中，跳过
        if not _index_file.exists():
            return  # 无索引文件，跳过
        
        _last_index_check_time = now
        
        try:
            cached_index = _load_index_file()
            if cached_index is None:
                return
            vault_path = cached_index.get("vault_path", "")
            if not vault_path or not os.path.isdir(vault_path):
                return
            
            # 收集当前所有文件（排除 main 目录，和 _start_background_update 一致）
            current_files = set()
            for root, dirs, files in os.walk(vault_path):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for fn in files:
                    if not fn.startswith('.'):
                        fp = os.path.join(root, fn)
                        # 跳过 main 目录下的文件（由 MainProcessor 处理，不纳入索引）
                        if "\\main\\" in fp.replace('/', '\\') or fp.endswith("main"):
                            continue
                        current_files.add(fp)
            
            cached_files = set(item.get("path") for item in cached_index.get("index", []))
            new_files = current_files - cached_files
            deleted_files = cached_files - current_files
            
            # 检查修改的文件
            modified_files = []
            cached_index_map = {item.get("path"): item for item in cached_index.get("index", [])}
            for fp in current_files:
                if fp in cached_index_map:
                    try:
                        current_mtime = os.path.getmtime(fp)
                        cached_mtime = cached_index_map[fp].get("mtime", 0)
                        if current_mtime > cached_mtime:
                            modified_files.append(fp)
                    except:
                        pass
            
            total_changes = len(new_files) + len(deleted_files) + len(modified_files)
            if total_changes > 0:
                print(f"[Embedding] 检测到文件变化（新增 {len(new_files)}，删除 {len(deleted_files)}，修改 {len(modified_files)}），后台更新索引...")
                all_new_files = list(new_files) + modified_files
                _start_background_update(vault_path, cached_index, all_new_files, deleted_files)
        except Exception as e:
            print(f"[Embedding] 索引检查失败: {e}")

    def _get_index_in_memory():
        """获取索引的内存缓存（带 mtime 检查，文件更新时自动重载）
        
        返回 {"documents": [...], "matrix": np.array (N, D), "paths": [...]}
        matrix 是所有 chunk embedding 堆成的矩阵，用于批量算相似度
        """
        global _index_cache
        if not _index_file.exists():
            _index_cache = None
            return None
        
        try:
            file_mtime = os.path.getmtime(_index_file)
        except:
            file_mtime = 0
        
        # 缓存有效：文件未变化
        if _index_cache is not None and _index_cache.get("mtime") == file_mtime:
            return _index_cache
        
        # 重新加载
        try:
            index_data = _load_index_file()
            if index_data is None:
                return gw._ok(rid, {"results": [], "total": 0})
            documents = index_data.get("index", [])
            if not documents:
                _index_cache = None
                return None
            
            # 构建向量矩阵（N x D）
            if _numpy_available and np is not None:
                matrix = np.array([doc.get("embedding", []) for doc in documents], dtype=np.float32)
                # 预归一化（余弦相似度 = 点积，因为向量已归一化）
                norms = np.linalg.norm(matrix, axis=1, keepdims=True)
                norms[norms == 0] = 1.0
                matrix = matrix / norms
            else:
                matrix = None
            
            _index_cache = {
                "documents": documents,
                "matrix": matrix,
                "mtime": file_mtime,
                "vault_path": index_data.get("vault_path", "")
            }
            print(f"[Embedding] 索引已加载到内存（{len(documents)} 个 chunk）")
            return _index_cache
        except Exception as e:
            print(f"[Embedding] 加载索引到内存失败: {e}")
            _index_cache = None
            return None

    def _extract_keywords_with_embedding(text, top_n=5):
        """使用 jieba + Qwen embedding 提取关键词（模仿 KeyBERT）
        
        步骤：
        1. jieba 分词提取候选词（保留专属词如"我的"）
        2. 用 Qwen embedding 计算每个词与整句的相似度
        3. 返回相似度最高的关键词
        """
        if not _jieba_available or not text:
            return []
        
        try:
            # 定义专属词（个人相关）
            personal_words = {'我的', '我', '本人', '自己', '个人'}
            
            # 定义停用词
            stop_words = {'还是', '会', '有', '匹配', '问题', 'bug', '错误', '不对', '不是', '没', '没有',
                '怎么', '怎么样', '怎样', '如何', '为什么', '什么', '这么', '那么',
                '可以', '能够', '应该', '可能', '需要', '知道', '觉得', '真是', '真的',
                '这个', '那个', '这些', '那些', '因为', '所以', '但是', '如果', '虽然',
                '而且', '然后', '时候', '一个', '一些', '有点', '有些', '等等', '不过',
                '不要', '不能', '这样', '那样', '比如', '关于', '除了', '是不是', '有没有',
                '我练', '你练', '他是', '她是', '我是', '我是说'}
            
            # 1. jieba 分词提取候选词
            words = list(set(jieba.lcut(text)))
            words = [w.strip() for w in words if len(w.strip()) > 1]  # 过滤单字和空格
            
            # 过滤重复词（如"练胸练胸""胸练胸练"这种）
            filtered_words = []
            for w in words:
                # 跳过纯重复的词（如"练练""胸胸"）
                if len(set(w)) == 1:
                    continue
                # 跳过明显是重复拼接的词（长度>4且重复模式）
                if len(w) > 4:
                    # 检查是否是重复模式（如"练胸练胸"）
                    half = len(w) // 2
                    if w[:half] == w[half:2*half]:
                        continue
                filtered_words.append(w)
            words = filtered_words
            
            # 强制保留专属词
            found_personal = [w for w in personal_words if w in text]
            
            # 添加 TF-IDF 提取的关键词作为补充
            tfidf_words = jieba.analyse.extract_tags(text, topK=15, withWeight=False)
            # 同样过滤 TF-IDF 结果的重复词
            tfidf_filtered = []
            for w in tfidf_words:
                if len(set(w)) == 1:
                    continue
                if len(w) > 4:
                    half = len(w) // 2
                    if w[:half] == w[half:2*half]:
                        continue
                tfidf_filtered.append(w)
            words = list(set(words + tfidf_filtered))
            
            if len(words) == 0:
                return found_personal[:top_n]
            
            # 2. 使用已加载的 Qwen 模型计算 embedding
            global _embedding_model, _tokenizer
            if _embedding_model is None or _tokenizer is None:
                print("[Keywords] 模型未加载，使用 TF-IDF 回退")
                # 回退到 TF-IDF，但优先保留专属词
                result = found_personal + [w for w in tfidf_words if w not in found_personal]
                return result[:top_n]
            
            # 简化方案：直接使用 TF-IDF + 专属词优先（避免 DirectML GPU 错误）
            # 按 TF-IDF 权重排序
            from jieba.analyse import extract_tags
            tfidf_with_weight = extract_tags(text, topK=30, withWeight=True)
            
            # 过滤停用词
            tfidf_with_weight = [(w, weight) for w, weight in tfidf_with_weight if w not in stop_words]
            
            # 构建词到权重的映射
            word_weights = {w: float(weight) for w, weight in tfidf_with_weight}
            
            # 给专属词额外加权
            for pw in found_personal:
                if pw in word_weights:
                    word_weights[pw] *= 2.0  # 专属词权重翻倍
                else:
                    word_weights[pw] = 0.5  # 未在 TF-IDF 中的专属词给予基础权重
            
            # 按权重排序
            sorted_words = sorted(word_weights.items(), key=lambda x: x[1], reverse=True)
            result_words = [w for w, _ in sorted_words[:top_n]]
            
            # 确保专属词在前面
            for pw in reversed(found_personal):
                if pw in result_words:
                    result_words.remove(pw)
                result_words.insert(0, pw)
            
            return result_words[:top_n]
                
        except Exception as e:
            print(f"[Keywords] 提取失败: {e}")
            return []

    def _embedding_query_index(rid, params):
        """使用索引进行向量搜索（返回匹配的 chunk 片段）- Chroma 版本"""
        query = params.get("query", "")
        top_k = params.get("top_k", 5)
        vault_path = params.get("vault_path", _current_vault_path)
        
        if not query:
            return gw._err(rid, 4000, "query required")
        
        if _model_loading:
            return gw._err(rid, 5002, "model loading, please wait")
        
        query_embedding = _compute_embedding(query)
        if query_embedding is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        try:
            # 优先使用 Chroma
            collection = _get_chroma_collection(vault_path) if vault_path else None
            
            if collection is not None and _chroma_available:
                # Chroma 查询
                results = collection.query(
                    query_embeddings=[query_embedding if isinstance(query_embedding, list) else query_embedding.tolist()],
                    n_results=top_k * 3,  # 多取一些用于去重
                    include=["metadatas", "distances"]
                )
                
                all_results = []
                if results and results["metadatas"] and results["metadatas"][0]:
                    for i, meta in enumerate(results["metadatas"][0]):
                        # Chroma 返回的是距离（L2），转换为相似度（余弦）
                        distance = results["distances"][0][i]
                        # L2 距离转余弦相似度（近似）
                        similarity = 1.0 / (1.0 + distance)
                        
                        all_results.append({
                            "path": meta.get("path", ""),
                            "fileName": meta.get("fileName", ""),
                            "similarity": similarity,
                            "chunkIdx": meta.get("chunkIdx", 0),
                            "chunkTotal": meta.get("chunkTotal", 1),
                            "chunkText": meta.get("chunkText", ""),
                            "charStart": meta.get("charStart", 0),
                            "charEnd": meta.get("charEnd", 0)
                        })
                
                # 去重：同一文件只保留相似度最高的 chunk
                seen_files = {}
                top_results = []
                max_chunks_per_file = 2
                for r in all_results:
                    fp = r["path"]
                    cnt = seen_files.get(fp, 0)
                    if cnt >= max_chunks_per_file:
                        continue
                    seen_files[fp] = cnt + 1
                    top_results.append(r)
                    if len(top_results) >= top_k:
                        break
                
                return gw._ok(rid, {"results": top_results, "total": len(all_results)})
            
            else:
                # Chroma 不可用，回退到 JSON 模式
                if not _index_file.exists():
                    return gw._err(rid, 4004, "index not built, please call embedding.build_index first")
                
                _maybe_refresh_index()
                cache = _get_index_in_memory()
                if cache is None:
                    return gw._ok(rid, {"results": [], "total": 0})
                
                documents = cache["documents"]
                matrix = cache["matrix"]
                
                # 批量计算相似度
                if matrix is not None and _numpy_available and np is not None:
                    q = np.array(query_embedding, dtype=np.float32)
                    q_norm = np.linalg.norm(q)
                    if q_norm > 0:
                        q = q / q_norm
                    similarities = matrix @ q
                else:
                    similarities = [_cosine_similarity(query_embedding, doc.get("embedding", [])) for doc in documents]
                
                all_results = []
                for i, doc in enumerate(documents):
                    sim = float(similarities[i]) if hasattr(similarities[i], '__float__') else float(similarities[i])
                    all_results.append({
                        "path": doc.get("path", ""),
                        "fileName": doc.get("fileName", ""),
                        "similarity": sim,
                        "chunkIdx": doc.get("chunkIdx", 0),
                        "chunkTotal": doc.get("chunkTotal", 1),
                        "chunkText": doc.get("chunkText", ""),
                        "charStart": doc.get("charStart", 0),
                        "charEnd": doc.get("charEnd", 0)
                    })
                
                all_results.sort(key=lambda x: x["similarity"], reverse=True)
                
                seen_files = {}
                top_results = []
                max_chunks_per_file = 2
                for r in all_results:
                    fp = r["path"]
                    cnt = seen_files.get(fp, 0)
                    if cnt >= max_chunks_per_file:
                        continue
                    seen_files[fp] = cnt + 1
                    top_results.append(r)
                    if len(top_results) >= top_k:
                        break
                
                return gw._ok(rid, {"results": top_results, "total": len(all_results)})
                
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _embedding_status(rid, params):
        """获取索引构建状态"""
        return gw._ok(rid, _index_build_status)

    def _embedding_query_index_with_context(rid, params):
        """上下文感知向量搜索：接收多条消息，分别计算 embedding 后加权融合，再搜索索引 - Chroma 版本
        
        params:
          - messages: [str] 消息列表，最后一条是当前消息（权重最高）
          - weights: [float] 可选，每条消息的权重，默认自动递减
          - top_k: int 可选，返回结果数量
          - vault_path: str 可选，vault 路径
        """
        messages = params.get("messages", [])
        weights = params.get("weights", None)
        top_k = params.get("top_k", 5)
        vault_path = params.get("vault_path", _current_vault_path)

        if not messages:
            return gw._err(rid, 4000, "messages required")

        if _model_loading:
            return gw._err(rid, 5002, "model loading, please wait")

        # 批量计算所有消息的 embedding
        embeddings = _compute_embedding_batch(messages)
        if embeddings is None:
            return gw._err(rid, 5001, "embedding model not available")

        # 权重：默认递减，最后一条（当前消息）权重最高
        n = len(messages)
        if weights and len(weights) == n:
            w = [float(x) for x in weights]
            print(f"[Embedding] 使用前端传入的权重，共 {len(weights)} 个")
        elif weights and len(weights) > 0:
            # 权重数组长度不匹配，补齐或截断
            print(f"[Embedding] 警告：权重数组长度不匹配（传入 {len(weights)}，需要 {n}），自动调整")
            w = [float(x) for x in weights[:n]]  # 截断
            while len(w) < n:  # 补齐
                w.append(0.01)
        else:
            # 默认权重：当前消息占60%以上，历史消息快速衰减
            print(f"[Embedding] 使用默认权重策略（共 {n} 条消息，当前消息权重60%+）")
            w = []
            for i in range(n):
                dist_from_end = n - 1 - i  # 距离末尾的距离
                if dist_from_end == 0:
                    w.append(0.65)  # 当前消息：65%
                elif dist_from_end == 1:
                    w.append(0.15)  # 前一条：15%
                elif dist_from_end == 2:
                    w.append(0.08)  # 前两条：8%
                elif dist_from_end == 3:
                    w.append(0.05)  # 前三条：5%
                elif dist_from_end == 4:
                    w.append(0.03)  # 前四条：3%
                elif dist_from_end == 5:
                    w.append(0.02)  # 前五条：2%
                else:
                    # 更早的消息权重极小
                    w.append(max(0.005, 0.02 - (dist_from_end - 5) * 0.002))

        # 调试日志：显示拼接的消息和权重
        print(f"[Embedding] 上下文感知搜索：共 {n} 条消息")
        for i in range(n):
            preview = messages[i][:80].replace('\n', ' ')
            print(f"  [{i}] 权重={w[i]:.1f} | {preview}{'...' if len(messages[i]) > 80 else ''}")

        # 加权融合 embedding
        dim = len(embeddings[0])
        fused = [0.0] * dim
        for i, emb in enumerate(embeddings):
            wi = w[i]
            for j in range(dim):
                fused[j] += wi * emb[j]

        # 归一化融合向量
        norm = sum(x * x for x in fused) ** 0.5
        if norm > 0:
            fused = [x / norm for x in fused]

        # 构建加权融合文本（用于关键词提取）
        # 只取权重最高的前3条消息提取关键词（避免抱怨/反馈内容干扰）
        # 按权重排序，取前3
        msg_with_weight = [(messages[i], w[i]) for i in range(len(messages))]
        msg_with_weight.sort(key=lambda x: x[1], reverse=True)
        
        # 定义疑问词（真实查询的标志）
        question_words = {'怎么', '什么', '如何', '怎样', '哪里', '为什么', '吗', '呢'}
        # 定义负面词（抱怨的标志）
        negative_words = {'还是', '会', '问题', 'bug', '错误', '不对', '没', '没有'}
        
        # 判断消息意图，过滤抱怨内容
        top_messages = []
        for msg, weight in msg_with_weight[:3]:
            if weight <= 0.1:
                continue
            
            # 检查是否是抱怨：包含负面词且不包含疑问词
            has_negative = any(nw in msg for nw in negative_words)
            has_question = any(qw in msg for qw in question_words)
            
            if has_negative and not has_question:
                # 抱怨内容，降低权重但不完全排除
                print(f"[Keywords] 检测到抱怨内容，降低权重: {msg[:30]}...")
                # 如果权重较高，仍然使用但标记
                if weight > 0.3:
                    top_messages.append(msg)
            else:
                # 正常查询
                top_messages.append(msg)
        
        # 按权重重复消息
        fused_text_parts = []
        for msg in top_messages:
            # 找到对应权重
            for i, m in enumerate(messages):
                if m == msg and w[i] > 0.5:
                    repeat_count = 3
                elif m == msg and w[i] > 0.3:
                    repeat_count = 2
                elif m == msg:
                    repeat_count = 1
            for _ in range(repeat_count):
                fused_text_parts.append(msg)
        
        fused_text = " ".join(fused_text_parts)
        
        # 关键词提取策略：
        # 1. 优先从原始查询提取（不混入 AI 回复）
        original_query = params.get("original_query", "")
        primary_kw = _extract_keywords_with_embedding(original_query, top_n=5)
        
        # 2. 检查意图：原始查询是否能确定意图
        intent_primary = _determine_intent(primary_kw, original_query) if primary_kw else "通用"
        
        # 3. 如果意图是"通用"，说明原始查询缺乏话题关键词
        #    → 从"原始查询 + AI回复(前80字)"补充提取
        if intent_primary == "通用" and len(messages) >= 2:
            latest_text = messages[-1] if messages else ""
            if len(latest_text) > 80:
                latest_text = latest_text[:80]
            expanded_kw = _extract_keywords_with_embedding(latest_text, top_n=5)
            keywords = list(dict.fromkeys(primary_kw + expanded_kw))[:5]
            print(f"[Keywords] 原始查询意图=通用，补充 AI 上下文: {keywords}")
        else:
            keywords = primary_kw
            print(f"[Keywords] 从原始查询提取: {keywords}")

        try:
            # 优先使用 Chroma
            collection = _get_chroma_collection(vault_path) if vault_path else None
            
            if collection is not None and _chroma_available:
                # Chroma 查询
                results = collection.query(
                    query_embeddings=[fused],
                    n_results=top_k * 5,  # 多查一些，方便后续过滤
                    include=["metadatas", "distances"]
                )
                
                all_results = []
                if results and results["metadatas"] and results["metadatas"][0]:
                    for i, meta in enumerate(results["metadatas"][0]):
                        distance = results["distances"][0][i]
                        similarity = 1.0 / (1.0 + distance)
                        
                        all_results.append({
                            "path": meta.get("path", ""),
                            "fileName": meta.get("fileName", ""),
                            "similarity": similarity,
                            "chunkIdx": meta.get("chunkIdx", 0),
                            "chunkTotal": meta.get("chunkTotal", 1),
                            "chunkText": meta.get("chunkText", ""),
                            "charStart": meta.get("charStart", 0),
                            "charEnd": meta.get("charEnd", 0)
                        })
                
                # 按相似度排序
                all_results.sort(key=lambda x: x["similarity"], reverse=True)
                
                # 关键词加权排序（本地快速过滤）
                query_text = messages[-1]  # 最后一条消息是当前查询
                all_results = _filter_results_with_keywords(query_text, all_results, max_candidates=top_k * 2, jieba_keywords=keywords)                
                # 去重
                seen_files = {}
                top_results = []
                max_chunks_per_file = 2
                for r in all_results:
                    fp = r["path"]
                    cnt = seen_files.get(fp, 0)
                    if cnt >= max_chunks_per_file:
                        continue
                    seen_files[fp] = cnt + 1
                    top_results.append(r)
                    if len(top_results) >= top_k:
                        break
                
                return gw._ok(rid, {"results": top_results, "total": len(all_results)})
            
            else:
                # Chroma 不可用，回退到 JSON 模式
                if not _index_file.exists():
                    return gw._err(rid, 4004, "index not built, please call embedding.build_index first")
                
                _maybe_refresh_index()
                cache = _get_index_in_memory()
                if cache is None:
                    return gw._ok(rid, {"results": [], "total": 0})

                documents = cache["documents"]
                matrix = cache["matrix"]

                # 用融合向量搜索
                if matrix is not None and _numpy_available and np is not None:
                    q = np.array(fused, dtype=np.float32)
                    similarities = matrix @ q
                else:
                    similarities = [_cosine_similarity(fused, doc.get("embedding", [])) for doc in documents]

                all_results = []
                for i, doc in enumerate(documents):
                    sim = float(similarities[i]) if hasattr(similarities[i], '__float__') else float(similarities[i])
                    all_results.append({
                        "path": doc.get("path", ""),
                        "fileName": doc.get("fileName", ""),
                        "similarity": sim,
                        "chunkIdx": doc.get("chunkIdx", 0),
                        "chunkTotal": doc.get("chunkTotal", 1),
                        "chunkText": doc.get("chunkText", ""),
                        "charStart": doc.get("charStart", 0),
                        "charEnd": doc.get("charEnd", 0)
                    })

                all_results.sort(key=lambda x: x["similarity"], reverse=True)
                
                # 关键词加权排序（本地快速过滤）
                query_text = messages[-1]
                all_results = _filter_results_with_keywords(query_text, all_results, max_candidates=top_k * 2, jieba_keywords=keywords)
                
                seen_files = {}
                top_results = []
                max_chunks_per_file = 2
                for r in all_results:
                    fp = r["path"]
                    cnt = seen_files.get(fp, 0)
                    if cnt >= max_chunks_per_file:
                        continue
                    seen_files[fp] = cnt + 1
                    top_results.append(r)
                    if len(top_results) >= top_k:
                        break

                return gw._ok(rid, {"results": top_results, "total": len(all_results)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _embedding_get_chunk_neighbors(rid, params):
        """获取指定 chunk 的相邻片段（用于提供上下文）- Chroma 版本
        
        params:
          - path: str 文件路径
          - chunk_idx: int chunk 索引
          - neighbor_count: int 可选，前后各取多少个邻居，默认 1（即总共最多 3 个片段）
          - vault_path: str 可选，vault 路径
        """
        path = params.get("path", "")
        chunk_idx = params.get("chunk_idx", 0)
        neighbor_count = params.get("neighbor_count", 1)
        vault_path = params.get("vault_path", _current_vault_path)
        
        if not path:
            return gw._err(rid, 4000, "path required")
        
        try:
            # 优先使用 Chroma
            collection = _get_chroma_collection(vault_path) if vault_path else None
            
            if collection is not None and _chroma_available:
                # 从 Chroma 获取该文件的所有 chunks
                results = collection.get(
                    where={"path": path},
                    include=["metadatas"]
                )
                
                file_chunks = []
                if results and results["metadatas"]:
                    for meta in results["metadatas"]:
                        file_chunks.append({
                            "path": meta.get("path", ""),
                            "fileName": meta.get("fileName", ""),
                            "chunkIdx": meta.get("chunkIdx", 0),
                            "chunkTotal": meta.get("chunkTotal", 1),
                            "chunkText": meta.get("chunkText", ""),
                            "charStart": meta.get("charStart", 0),
                            "charEnd": meta.get("charEnd", 0)
                        })
                
                file_chunks.sort(key=lambda x: x.get("chunkIdx", 0))
                
                if not file_chunks:
                    return gw._ok(rid, {"chunks": []})
                
                # 找到目标 chunk
                target_idx = -1
                for i, c in enumerate(file_chunks):
                    if c.get("chunkIdx") == chunk_idx:
                        target_idx = i
                        break
                
                if target_idx == -1:
                    return gw._ok(rid, {"chunks": []})
                
                # 计算范围
                start_idx = max(0, target_idx - neighbor_count)
                end_idx = min(len(file_chunks), target_idx + neighbor_count + 1)
                
                result_chunks = []
                for i in range(start_idx, end_idx):
                    c = file_chunks[i]
                    result_chunks.append({
                        **c,
                        "isTarget": (i == target_idx)
                    })
                
                return gw._ok(rid, {"chunks": result_chunks, "count": len(result_chunks)})
            
            else:
                # Chroma 不可用，回退到 JSON 模式
                cache = _get_index_in_memory()
                if cache is None:
                    return gw._ok(rid, {"chunks": []})
                
                documents = cache["documents"]
                file_chunks = [d for d in documents if d.get("path") == path]
                file_chunks.sort(key=lambda x: x.get("chunkIdx", 0))
                
                if not file_chunks:
                    return gw._ok(rid, {"chunks": []})
                
                target_idx = -1
                for i, c in enumerate(file_chunks):
                    if c.get("chunkIdx") == chunk_idx:
                        target_idx = i
                        break
                
                if target_idx == -1:
                    return gw._ok(rid, {"chunks": []})
                
                start_idx = max(0, target_idx - neighbor_count)
                end_idx = min(len(file_chunks), target_idx + neighbor_count + 1)
                
                result_chunks = []
                for i in range(start_idx, end_idx):
                    c = file_chunks[i]
                    result_chunks.append({
                        "path": c.get("path", ""),
                        "fileName": c.get("fileName", ""),
                        "chunkIdx": c.get("chunkIdx", 0),
                        "chunkTotal": c.get("chunkTotal", 1),
                        "chunkText": c.get("chunkText", ""),
                        "charStart": c.get("charStart", 0),
                        "charEnd": c.get("charEnd", 0),
                        "isTarget": (i == target_idx)
                    })
                
                return gw._ok(rid, {"chunks": result_chunks, "count": len(result_chunks)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    gw._methods["embedding.compute"] = _embedding_compute
    gw._methods["embedding.similarity"] = _embedding_similarity
    gw._methods["embedding.search"] = _embedding_search
    gw._methods["embedding.build_index"] = _embedding_build_index
    gw._methods["embedding.query_index"] = _embedding_query_index
    gw._methods["embedding.query_index_with_context"] = _embedding_query_index_with_context
    gw._methods["embedding.get_chunk_neighbors"] = _embedding_get_chunk_neighbors
    gw._methods["embedding.status"] = _embedding_status
    
    print("[Embedding] RPC 方法已注册")
    print(f"[Embedding] 使用本地模型：{_embedding_model_name}")
    
    # 异步预加载模型，不影响 RPC 启动（带重试，DirectML 加载有时会概率性失败）
    def _preload():
        for attempt in range(3):
            if _load_model():
                break
            time.sleep(2)
    t = threading.Thread(target=_preload, daemon=True, name="embedding-preload")
    t.start()
