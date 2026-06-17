"""
Embedding RPC 模块 - 提供向量搜索功能
使用本地 model 实现语义搜索

依赖（可选）：
- numpy
- torch
- transformers
"""
import os
import json
import threading
import time
from pathlib import Path

# 后台构建状态
_index_build_status = {
    "building": False,
    "progress": 0,
    "total": 0,
    "error": None,
    "complete": False
}

# 模型加载状态
_model_loading = False

# 索引自动更新检查：记录上次检查时间，避免每次搜索都遍历文件
_last_index_check_time = 0
_INDEX_CHECK_INTERVAL = 300  # 5 分钟检查一次文件变化

# 索引内存缓存（避免每次搜索都读磁盘 + 解析 JSON）
_index_cache = None  # {"documents": [...], "matrix": np.array, "mtime": float, "vault_path": str}

# 尝试导入 numpy（可选）
try:
    import numpy as np
    _numpy_available = True
except ImportError:
    _numpy_available = False
    np = None

# Local Embedding Config
_embedding_model_name = "Qwen/Qwen3-Embedding-0.6B"
_embedding_cache_dir = Path(__file__).parent.resolve() / "cache" / "embeddings"
_index_file = _embedding_cache_dir / "vault_index.json"
_embedding_available = False
_INDEX_VERSION = 2  # 索引格式版本（v2=分块索引），不匹配时强制重建

# Local model (lazy load)
_embedding_model = None
_tokenizer = None
_device = "cpu"
_dml_device = None
_torch_directml = None  # 缓存 torch_directml 模块引用


def _load_model():
    """延迟加载本地 model"""
    global _embedding_model, _tokenizer, _model_loading, _embedding_available, _device, _dml_device, _torch_directml
    
    if _embedding_model is None:
        try:
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
    
    return True


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
            with open(_index_file, "r", encoding="utf-8") as f:
                index_data = json.load(f)
            
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
        global _index_build_status
        _index_build_status = {
            "building": True,
            "progress": 0,
            "total": len(all_files),
            "error": None,
            "complete": False
        }
        
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
                
                # Step 3: Merge results
                index_data = []
                for i, meta in enumerate(chunk_metadata):
                    index_data.append({
                        **meta,
                        "embedding": embeddings[i]
                    })
                
                _index_build_status["progress"] = len(all_files)
                
                # Save index
                _ensure_cache_dir()
                with open(_index_file, "w", encoding="utf-8") as f:
                    json.dump({
                        "vault_path": vault_path,
                        "model": _embedding_model_name,
                        "provider": "local",
                        "version": _INDEX_VERSION,
                        "count": len(index_data),
                        "fileCount": len(all_files),
                        "chunkCount": len(index_data),
                        "index": index_data
                    }, f, ensure_ascii=False)
                
                print(f"[Embedding] 后台构建完成，共 {len(index_data)} 个 chunk（来自 {len(all_files)} 个文件）")
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
        """构建 vault 的向量索引（后台运行，不阻塞主线程）"""
        vault_path = params.get("vault_path", "")
        if not vault_path or not os.path.isdir(vault_path):
            return gw._err(rid, 4004, f"vault path not found: {vault_path}")
        
        # If already building, return current status
        if _index_build_status["building"]:
            return gw._ok(rid, {
                "status": "building",
                "progress": _index_build_status["progress"],
                "total": _index_build_status["total"]
            })
        
        # Collect all files (exclude archive folders + main directory)
        # 排除归档文件夹和 main 目录（包含待处理文件）
        _EXCLUDE_DIRS = {'_archive', 'archive', '_archived', 'archived', '_old', 'old', 'trash', '.trash', '_archive_old', 'archive_old', 'main'}
        all_files = []
        for root, dirs, files in os.walk(vault_path):
            # 排除隐藏目录 + 归档目录 + main 目录
            dirs[:] = [d for d in dirs if not d.startswith('.') and d.lower() not in _EXCLUDE_DIRS]
            for f in files:
                if not f.startswith('.'):
                    all_files.append(os.path.join(root, f))
        
        # Check if index already exists
        if _index_file.exists():
            try:
                with open(_index_file, "r", encoding="utf-8") as f:
                    cached_index = json.load(f)
                
                # 检查索引版本，不匹配则强制重建
                cached_version = cached_index.get("version", 1)
                if cached_version != _INDEX_VERSION:
                    print(f"[Embedding] 索引版本不匹配（缓存 v{cached_version} ≠ 当前 v{_INDEX_VERSION}），强制重建...")
                    _start_background_build(vault_path, all_files)
                    return gw._ok(rid, {
                        "status": "building",
                        "total": len(all_files),
                        "reason": "index version mismatch, rebuilding"
                    })
                
                # Check if vault path and model match
                if cached_index.get("vault_path") == vault_path and cached_index.get("model") == _embedding_model_name:
                    cached_files = set(item.get("path") for item in cached_index.get("index", []))
                    current_files = set(all_files)
                    new_files = current_files - cached_files
                    deleted_files = cached_files - current_files
                    
                    # Check for modified files
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
                        print(f"[Embedding] 索引无变化，直接加载（{cached_index.get('count', 0)} 个文件）")
                        return gw._ok(rid, {
                            "count": cached_index.get("count", 0),
                            "index_file": str(_index_file),
                            "loaded_from_cache": True
                        })
                    
                    print(f"[Embedding] 发现文件变化：新增 {len(new_files)} 个，删除 {len(deleted_files)} 个，修改 {len(modified_files)} 个，后台更新...")
                    all_new_files = list(new_files) + modified_files
                    _start_background_update(vault_path, cached_index, all_new_files, deleted_files)
                    return gw._ok(rid, {
                        "status": "updating",
                        "new_files": len(new_files),
                        "deleted_files": len(deleted_files)
                    })
            except Exception as e:
                print(f"[Embedding] 加载缓存索引失败：{e}，将后台重新构建")
        
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
            with open(_index_file, "r", encoding="utf-8") as f:
                cached_index = json.load(f)
            vault_path = cached_index.get("vault_path", "")
            if not vault_path or not os.path.isdir(vault_path):
                return
            
            # 收集当前所有文件
            current_files = set()
            for root, dirs, files in os.walk(vault_path):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for fn in files:
                    if not fn.startswith('.'):
                        current_files.add(os.path.join(root, fn))
            
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
            with open(_index_file, "r", encoding="utf-8") as f:
                index_data = json.load(f)
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

    def _embedding_query_index(rid, params):
        """使用索引进行向量搜索（返回匹配的 chunk 片段）"""
        query = params.get("query", "")
        top_k = params.get("top_k", 5)
        
        if not query:
            return gw._err(rid, 4000, "query required")
        
        if _model_loading:
            return gw._err(rid, 5002, "model loading, please wait")
        
        if not _index_file.exists():
            return gw._err(rid, 4004, "index not built, please call embedding.build_index first")
        
        # 搜索前检查索引是否过期（轻量检查，每 5 分钟最多一次）
        _maybe_refresh_index()
        
        query_embedding = _compute_embedding(query)
        if query_embedding is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        try:
            # 从内存缓存获取索引（自动检测文件更新）
            cache = _get_index_in_memory()
            if cache is None:
                return gw._ok(rid, {"results": [], "total": 0})
            
            documents = cache["documents"]
            matrix = cache["matrix"]
            
            # 批量计算相似度（numpy 矩阵运算，比循环快 10-100 倍）
            if matrix is not None and _numpy_available and np is not None:
                q = np.array(query_embedding, dtype=np.float32)
                q_norm = np.linalg.norm(q)
                if q_norm > 0:
                    q = q / q_norm
                # 点积 = 余弦相似度（因为都已归一化）
                similarities = matrix @ q  # (N,) 向量
            else:
                # 无 numpy 时回退到逐个计算
                similarities = [_cosine_similarity(query_embedding, doc.get("embedding", [])) for doc in documents]
            
            # 构建结果并排序
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
            
            # 按相似度排序
            all_results.sort(key=lambda x: x["similarity"], reverse=True)
            
            # 去重：同一文件只保留相似度最高的 chunk
            # 但允许同一文件最多 2 个 chunk（如果都很相关）
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

    gw._methods["embedding.compute"] = _embedding_compute
    gw._methods["embedding.similarity"] = _embedding_similarity
    gw._methods["embedding.search"] = _embedding_search
    gw._methods["embedding.build_index"] = _embedding_build_index
    gw._methods["embedding.query_index"] = _embedding_query_index
    gw._methods["embedding.status"] = _embedding_status
    
    print("[Embedding] RPC 方法已注册")
    print(f"[Embedding] 使用本地模型：{_embedding_model_name}")
