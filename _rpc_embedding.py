"""
Embedding RPC 模块 - 提供向量搜索功能
使用 sentence-transformers 实现语义搜索

依赖（可选）：
- numpy
- sentence-transformers

如果依赖未安装，向量搜索功能将不可用，但仍可使用 BM25 搜索。
"""
import os
import json
import threading
from pathlib import Path

# 设置 HuggingFace 镜像（国内网络优化）
# 使用 hf-mirror.com 镜像站点
if "HF_ENDPOINT" not in os.environ:
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
    print("[Embedding] 使用 HuggingFace 镜像: https://hf-mirror.com")

# 后台构建状态
_index_build_status = {
    "building": False,
    "progress": 0,
    "total": 0,
    "error": None,
    "complete": False
}

# 尝试导入 numpy（可选）
try:
    import numpy as np
    _numpy_available = True
except ImportError:
    _numpy_available = False
    np = None

# 全局模型实例（延迟加载）
_embedding_model = None
# 使用多语言小模型（下载更快）
# paraphrase-multilingual-MiniLM-L12-v2: 多语言，约 470MB
# all-MiniLM-L6-v2: 英文专用，约 80MB（最小）
# text2vec-base-chinese: 中文专用，约 400MB
_embedding_model_name = "sentence-transformers/all-MiniLM-L6-v2"
_embedding_cache_dir = Path(__file__).parent.resolve() / "cache" / "embeddings"
_index_file = _embedding_cache_dir / "vault_index.json"
_embedding_available = False  # 标记 embedding 功能是否可用


def _get_model():
    """延迟加载 embedding 模型"""
    global _embedding_model, _embedding_available
    if _embedding_model is None:
        if not _numpy_available:
            print("[Embedding] numpy 未安装，向量搜索功能不可用")
            print("[Embedding] 请运行: uv pip install numpy sentence-transformers")
            return None
        try:
            from sentence_transformers import SentenceTransformer
            print(f"[Embedding] 正在加载模型: {_embedding_model_name}")
            print(f"[Embedding] 模型加载可能需要几秒到几十秒，请耐心等待...")
            _embedding_model = SentenceTransformer(_embedding_model_name)
            _embedding_available = True
            print(f"[Embedding] 模型加载完成！")
        except ImportError:
            print("[Embedding] sentence-transformers 未安装，请运行: uv pip install sentence-transformers")
            return None
        except Exception as e:
            print(f"[Embedding] 模型加载失败: {e}")
            return None
    return _embedding_model


def _ensure_cache_dir():
    """确保缓存目录存在"""
    if not _embedding_cache_dir.exists():
        _embedding_cache_dir.mkdir(parents=True, exist_ok=True)


def _compute_embedding(text):
    """计算单个文本的 embedding 向量"""
    model = _get_model()
    if model is None:
        return None
    try:
        embedding = model.encode(text, convert_to_numpy=True)
        return embedding.tolist()  # 转为 list 以便 JSON 序列化
    except Exception as e:
        print(f"[Embedding] 计算向量失败: {e}")
        return None


def _cosine_similarity(vec1, vec2):
    """计算两个向量的余弦相似度"""
    if vec1 is None or vec2 is None:
        return 0.0
    if not _numpy_available or np is None:
        # 如果 numpy 不可用，使用纯 Python 计算
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


def register(gw):
    """注册 RPC 方法"""
    _ensure_cache_dir()

    def _embedding_compute(rid, params):
        """计算文本的 embedding 向量"""
        texts = params.get("texts", [])
        if not texts:
            return gw._err(rid, 4000, "texts required")
        
        model = _get_model()
        if model is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        try:
            embeddings = model.encode(texts, convert_to_numpy=True)
            # 转为 list 以便 JSON 序列化
            embeddings_list = [e.tolist() for e in embeddings]
            return gw._ok(rid, {"embeddings": embeddings_list, "count": len(embeddings_list)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _embedding_similarity(rid, params):
        """计算两个文本的相似度"""
        text1 = params.get("text1", "")
        text2 = params.get("text2", "")
        if not text1 or not text2:
            return gw._err(rid, 4000, "text1 and text2 required")
        
        model = _get_model()
        if model is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        try:
            embeddings = model.encode([text1, text2], convert_to_numpy=True)
            similarity = _cosine_similarity(embeddings[0], embeddings[1])
            return gw._ok(rid, {"similarity": float(similarity)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _embedding_search(rid, params):
        """使用向量搜索文件"""
        query = params.get("query", "")
        documents = params.get("documents", [])  # [{path, content}, ...]
        top_k = params.get("top_k", 5)
        
        if not query or not documents:
            return gw._err(rid, 4000, "query and documents required")
        
        model = _get_model()
        if model is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        try:
            # 计算查询向量
            query_embedding = model.encode(query, convert_to_numpy=True)
            
            # 计算所有文档向量
            texts = [d.get("content", "") for d in documents]
            doc_embeddings = model.encode(texts, convert_to_numpy=True)
            
            # 计算相似度并排序
            results = []
            for i, doc in enumerate(documents):
                similarity = _cosine_similarity(query_embedding, doc_embeddings[i])
                results.append({
                    "path": doc.get("path", ""),
                    "similarity": float(similarity),
                    "fileName": doc.get("fileName", "")
                })
            
            # 按相似度排序
            results.sort(key=lambda x: x["similarity"], reverse=True)
            
            # 返回 top_k 个结果
            top_results = results[:top_k]
            return gw._ok(rid, {"results": top_results, "total": len(results)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    # 后台构建函数
    def _start_background_build(vault_path, md_files):
        """后台完整构建索引"""
        global _index_build_status
        _index_build_status = {
            "building": True,
            "progress": 0,
            "total": len(md_files),
            "error": None,
            "complete": False
        }
        
        def build_thread():
            try:
                model = _get_model()
                if model is None:
                    _index_build_status["error"] = "embedding model not available"
                    _index_build_status["building"] = False
                    return
                
                index_data = []
                for i, fp in enumerate(md_files):
                    try:
                        content = Path(fp).read_text(encoding="utf-8")
                        content_preview = content[:2000]
                        fileName = os.path.basename(fp)
                        combined = fileName + " " + fileName + " " + content_preview
                        embedding = model.encode(combined, convert_to_numpy=True)
                        index_data.append({
                            "path": fp,
                            "fileName": fileName,
                            "embedding": embedding.tolist(),
                            "length": len(content)
                        })
                        _index_build_status["progress"] = i + 1
                        if (i + 1) % 10 == 0:
                            print(f"[Embedding] 后台构建进度: {i + 1}/{len(md_files)}")
                    except Exception as e:
                        print(f"[Embedding] 读取文件失败: {fp}, {e}")
                        continue
                
                # 保存索引
                _ensure_cache_dir()
                with open(_index_file, "w", encoding="utf-8") as f:
                    json.dump({
                        "vault_path": vault_path,
                        "model": _embedding_model_name,
                        "count": len(index_data),
                        "index": index_data
                    }, f, ensure_ascii=False)
                
                print(f"[Embedding] 后台构建完成，共 {len(index_data)} 个文件")
                _index_build_status["building"] = False
                _index_build_status["complete"] = True
            except Exception as e:
                print(f"[Embedding] 后台构建失败: {e}")
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
                model = _get_model()
                if model is None:
                    _index_build_status["error"] = "embedding model not available"
                    _index_build_status["building"] = False
                    return
                
                index_data = cached_index.get("index", [])
                # 删除已删除的文件
                index_data = [item for item in index_data if item.get("path") not in deleted_files]
                
                # 添加新增的文件
                for i, fp in enumerate(new_files):
                    try:
                        content = Path(fp).read_text(encoding="utf-8")
                        content_preview = content[:2000]
                        fileName = os.path.basename(fp)
                        combined = fileName + " " + fileName + " " + content_preview
                        embedding = model.encode(combined, convert_to_numpy=True)
                        index_data.append({
                            "path": fp,
                            "fileName": fileName,
                            "embedding": embedding.tolist(),
                            "length": len(content)
                        })
                        _index_build_status["progress"] = i + 1
                        print(f"[Embedding] 后台更新: {fileName}")
                    except Exception as e:
                        print(f"[Embedding] 处理新增文件失败: {fp}, {e}")
                        continue
                
                # 保存更新后的索引
                _ensure_cache_dir()
                with open(_index_file, "w", encoding="utf-8") as f:
                    json.dump({
                        "vault_path": vault_path,
                        "model": _embedding_model_name,
                        "count": len(index_data),
                        "index": index_data
                    }, f, ensure_ascii=False)
                
                print(f"[Embedding] 后台更新完成，共 {len(index_data)} 个文件")
                _index_build_status["building"] = False
                _index_build_status["complete"] = True
            except Exception as e:
                print(f"[Embedding] 后台更新失败: {e}")
                _index_build_status["error"] = str(e)
                _index_build_status["building"] = False
        
        thread = threading.Thread(target=update_thread, daemon=True)
        thread.start()

    def _embedding_build_index(rid, params):
        """构建 vault 的向量索引（后台运行，不阻塞主线程）"""
        vault_path = params.get("vault_path", "")
        if not vault_path or not os.path.isdir(vault_path):
            return gw._err(rid, 4004, f"vault path not found: {vault_path}")
        
        # 如果已经在构建中，返回当前状态
        if _index_build_status["building"]:
            return gw._ok(rid, {
                "status": "building",
                "progress": _index_build_status["progress"],
                "total": _index_build_status["total"]
            })
        
        # 收集所有 .md 文件
        md_files = []
        for root, dirs, files in os.walk(vault_path):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.endswith('.md'):
                    md_files.append(os.path.join(root, f))
        
        # 检查索引是否已存在
        if _index_file.exists():
            try:
                with open(_index_file, "r", encoding="utf-8") as f:
                    cached_index = json.load(f)
                if cached_index.get("vault_path") == vault_path:
                    cached_files = set(item.get("path") for item in cached_index.get("index", []))
                    current_files = set(md_files)
                    new_files = current_files - cached_files
                    deleted_files = cached_files - current_files
                    
                    if len(new_files) == 0 and len(deleted_files) == 0:
                        # 没有变化，直接加载
                        print(f"[Embedding] 索引无变化，直接加载（{cached_index.get('count', 0)} 个文件）")
                        return gw._ok(rid, {
                            "count": cached_index.get("count", 0),
                            "index_file": str(_index_file),
                            "loaded_from_cache": True
                        })
                    
                    # 有变化，后台增量更新
                    print(f"[Embedding] 发现文件变化：新增 {len(new_files)} 个，删除 {len(deleted_files)} 个，后台更新...")
                    _start_background_update(vault_path, cached_index, new_files, deleted_files)
                    return gw._ok(rid, {
                        "status": "updating",
                        "new_files": len(new_files),
                        "deleted_files": len(deleted_files)
                    })
            except Exception as e:
                print(f"[Embedding] 加载缓存索引失败: {e}，将后台重新构建")
        
        # 索引不存在，后台完整构建
        print(f"[Embedding] 找到 {len(md_files)} 个 .md 文件，开始后台构建...")
        _start_background_build(vault_path, md_files)
        return gw._ok(rid, {
            "status": "building",
            "total": len(md_files)
        })
    
    def _embedding_query_index(rid, params):
        """使用索引进行向量搜索"""
        query = params.get("query", "")
        top_k = params.get("top_k", 5)
        
        if not query:
            return gw._err(rid, 4000, "query required")
        
        # 检查索引是否存在
        if not _index_file.exists():
            return gw._err(rid, 4004, "index not built, please call embedding.build_index first")
        
        model = _get_model()
        if model is None:
            return gw._err(rid, 5001, "embedding model not available")
        
        try:
            # 加载索引
            with open(_index_file, "r", encoding="utf-8") as f:
                index_data = json.load(f)
            
            index = index_data.get("index", [])
            if not index:
                return gw._err(rid, 4004, "index is empty")
            
            # 计算查询向量
            query_embedding = model.encode(query, convert_to_numpy=True)
            
            # 计算相似度并排序
            results = []
            for item in index:
                doc_embedding = item.get("embedding", [])
                # 如果 numpy 可用，转换为 numpy 数组
                if _numpy_available and np is not None:
                    doc_embedding = np.array(doc_embedding)
                similarity = _cosine_similarity(query_embedding, doc_embedding)
                results.append({
                    "path": item.get("path", ""),
                    "fileName": item.get("fileName", ""),
                    "similarity": float(similarity)
                })
            
            # 按相似度排序
            results.sort(key=lambda x: x["similarity"], reverse=True)
            
            # 返回 top_k 个结果
            top_results = results[:top_k]
            return gw._ok(rid, {"results": top_results, "total": len(results)})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    # 注册方法
    gw._methods["embedding.compute"] = _embedding_compute
    gw._methods["embedding.similarity"] = _embedding_similarity
    gw._methods["embedding.search"] = _embedding_search
    gw._methods["embedding.build_index"] = _embedding_build_index
    gw._methods["embedding.query_index"] = _embedding_query_index
    print("[Embedding] RPC 方法已注册")