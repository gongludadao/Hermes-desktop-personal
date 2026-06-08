from pathlib import Path

_DESKTOP_DIR = Path(__file__).parent
_CACHE_DIR = _DESKTOP_DIR / "cache"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_stock_cfg_path = _CACHE_DIR / "stock_config.json"


def register(gw):
    """Register config RPC handlers."""

    def _load_stock_config(rid, params):
        try:
            if _stock_cfg_path.exists():
                import json as _json
                with open(_stock_cfg_path, "r", encoding="utf-8") as f:
                    data = _json.load(f)
                return gw._ok(rid, data)
            return gw._ok(rid, {})
        except Exception as e:
            return gw._ok(rid, {})

    gw._methods["stock.config.load"] = _load_stock_config

    def _save_stock_config(rid, params):
        try:
            import json as _json
            data = (params or {}).get("data", {})
            _stock_cfg_path.parent.mkdir(parents=True, exist_ok=True)
            if _stock_cfg_path.exists():
                try:
                    existing = _json.loads(_stock_cfg_path.read_text(encoding="utf-8"))
                    existing.update(data)
                    data = existing
                except Exception:
                    pass
            with open(_stock_cfg_path, "w", encoding="utf-8") as f:
                _json.dump(data, f, ensure_ascii=False, indent=2)
            return gw._ok(rid, {})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    gw._methods["stock.config.save"] = _save_stock_config
