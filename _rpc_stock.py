from pathlib import Path
import json

_CACHE_DIR = Path(__file__).parent / "cache"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_stock_cfg_path = _CACHE_DIR / "stock_config.json"


def _fetch_stock_tencent(code, _ur):
    """从腾讯API获取股票数据"""
    try:
        prefix = "sh" if code.startswith("6") else "sz"
        url = "https://qt.gtimg.cn/q=" + prefix + code
        req = _ur.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with _ur.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode("gbk", errors="replace")
        parts = raw.split("~")
        if len(parts) > 35:
            p = lambda i: parts[i] if i < len(parts) else ""
            ts = p(30)
            dataTime = ""
            if len(ts) >= 14:
                dataTime = ts[:4] + "-" + ts[4:6] + "-" + ts[6:8] + " " + ts[8:10] + ":" + ts[10:12] + ":" + ts[12:14]
            return {
                "code": code,
                "name": parts[1],
                "price": parts[3],
                "change": parts[31],
                "changePercent": parts[32],
                "yesterdayClose": p(4),
                "todayOpen": p(5),
                "high": p(33),
                "low": p(34),
                "amplitude": p(43),
                "averagePrice": p(51),
                "limitUp": p(47),
                "limitDown": p(48),
                "volume": p(6),
                "turnover": p(37),
                "outerVolume": p(7),
                "innerVolume": p(8),
                "turnoverRate": p(38),
                "volumeRatio": p(49),
                "bidRatio": p(56),
                "peDynamic": p(52),
                "peStatic": p(53),
                "pb": p(46),
                "totalMarketCap": p(45),
                "circulatingMarketCap": p(44),
                "weekChange": p(62),
                "monthChange": p(63),
                "quarterChange": p(64),
                "halfYearChange": p(65),
                "yearChange": p(66),
                "week52High": p(67),
                "week52Low": p(68),
                "type": p(61),
                "currency": p(82),
                "dataTime": dataTime,
                "bidAsk": {
                    "sell5": {"price": p(27), "volume": p(28)},
                    "sell4": {"price": p(25), "volume": p(26)},
                    "sell3": {"price": p(23), "volume": p(24)},
                    "sell2": {"price": p(21), "volume": p(22)},
                    "sell1": {"price": p(19), "volume": p(20)},
                    "buy1": {"price": p(9), "volume": p(10)},
                    "buy2": {"price": p(11), "volume": p(12)},
                    "buy3": {"price": p(13), "volume": p(14)},
                    "buy4": {"price": p(15), "volume": p(16)},
                    "buy5": {"price": p(17), "volume": p(18)},
                },
            }
    except Exception:
        return None


def _fetch_stock_sina(code, _ur):
    """从新浪API获取股票数据（备选方案）"""
    try:
        prefix = "sh" if code.startswith("6") else "sz"
        url = f"http://hq.sinajs.cn/list={prefix}{code}"
        req = _ur.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "http://finance.sina.com.cn"
        })
        with _ur.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode("gbk", errors="replace")
        
        # 解析格式：var hq_str_sh600519="贵州茅台,1800.00,1790.00,..."
        import re
        match = re.search(r'="([^"]*)"', raw)
        if not match or not match.group(1):
            return None
        
        parts = match.group(1).split(",")
        if len(parts) < 32:
            return None
        
        name = parts[0]
        today_open = parts[1]
        yesterday_close = parts[2]
        price = parts[3]
        high = parts[4]
        low = parts[5]
        volume = parts[8]
        turnover = parts[9]
        
        # 计算涨跌
        try:
            price_f = float(price)
            yc_f = float(yesterday_close)
            change = price_f - yc_f
            change_percent = (change / yc_f * 100) if yc_f != 0 else 0
            change = f"{change:.2f}"
            change_percent = f"{change_percent:.2f}"
        except:
            change = "0"
            change_percent = "0"
        
        return {
            "code": code,
            "name": name,
            "price": price,
            "change": change,
            "changePercent": change_percent,
            "yesterdayClose": yesterday_close,
            "todayOpen": today_open,
            "high": high,
            "low": low,
            "volume": volume,
            "turnover": turnover,
        }
    except Exception:
        return None


def _get_stock_config(code):
    try:
        if _stock_cfg_path.exists():
            data = json.loads(_stock_cfg_path.read_text("utf-8"))
            th = data.get("stockThresholds", {}).get(code)
            if th:
                cfg = {"code": code}
                cfg.update(th)
                return cfg
    except Exception:
        pass
    return {}


def _generate_stock_detail_report(code, stock_data):
    """生成股票详细报告的Markdown内容"""
    name = stock_data.get("name", code)
    _r = '<span style="color:#e06060">'
    _g = '<span style="color:#50c878">'
    _o = '<span style="color:#e6a800">'
    _e = '</span>'
    content = "# " + name + " (" + code + ")\n\n"

    cfg = _get_stock_config(code)
    buy_price = float(cfg.get("buy_price", 0))
    lots = int(cfg.get("lots", 0))
    sell_target = float(cfg.get("sell_target", 0))
    low_alert = float(cfg.get("low_alert", 0))
    current_price = 0.0
    try:
        current_price = float(stock_data.get("price", 0))
    except (ValueError, TypeError):
        pass

    if buy_price > 0 and current_price > 0:
        total_shares = lots * 100 if lots > 0 else 1
        cost = buy_price * total_shares
        current_value = current_price * total_shares
        pl_value = current_value - cost
        pl_pct = (pl_value / cost) * 100 if cost else 0
        pl_sign = "+" if pl_value > 0 else ""
        pl_color = _r if pl_value > 0 else (_g if pl_value < 0 else "")
        content += "## 盈亏计算\n\n"
        content += "| 指标 | 值 |\n|---|---|\n"
        content += "| 买入价 | " + f"{buy_price:.2f}" + " |\n"
        if lots > 0:
            content += "| 持有手数 | " + str(lots) + "手 (" + str(total_shares) + "股) |\n"
            content += "| 持仓成本 | " + f"{cost:.2f}" + "元 |\n"
            content += "| 当前市值 | " + f"{current_value:.2f}" + "元 |\n"
            content += "| 盈亏金额 | **" + pl_color + pl_sign + f"{pl_value:.2f}" + "元" + _e + "** |\n"
        else:
            content += "| 每股盈亏 | **" + pl_color + pl_sign + f"{pl_value:.2f}" + _e + "** |\n"
        content += "| 盈亏比例 | **" + pl_color + pl_sign + f"{pl_pct:.2f}" + "%" + _e + "** |\n"
        content += "\n"

    if sell_target > 0 or low_alert > 0:
        content += "## 价格预警\n\n"
        content += "| 指标 | 值 |\n|---|---|\n"
        if sell_target > 0:
            hit_sell = current_price >= sell_target if current_price > 0 else False
            val = f"{sell_target:.2f}"
            if hit_sell:
                val = _o + val + " ⚠️ 已达到" + _e
            content += "| 建议卖价 | " + val + " |\n"
        if low_alert > 0:
            hit_low = current_price <= low_alert if current_price > 0 else False
            val = f"{low_alert:.2f}"
            if hit_low:
                val = _r + val + " 🚨 已跌破" + _e
            content += "| 止损价格 | " + val + " |\n"
        content += "\n"

    content += "## 基础行情\n\n"
    content += "| 指标 | 值 |\n|---|---|\n"
    try:
        cp = float(stock_data.get("price", 0))
        cc = float(stock_data.get("change", 0))
        cp_color = _r if cc > 0 else (_g if cc < 0 else "")
        content += "| 当前价 | " + cp_color + stock_data.get("price", "--") + _e + " |\n"
        content += "| 涨跌额 | " + cp_color + stock_data.get("change", "0") + _e + " |\n"
        content += "| 涨跌幅 | " + cp_color + stock_data.get("changePercent", "0") + "%" + _e + " |\n"
    except (ValueError, TypeError):
        content += "| 当前价 | " + stock_data.get("price", "--") + " |\n"
        content += "| 涨跌额 | " + stock_data.get("change", "0") + " |\n"
        content += "| 涨跌幅 | " + stock_data.get("changePercent", "0") + "% |\n"

    content += "| 昨收 | " + stock_data.get("yesterdayClose", "--") + " |\n"
    content += "| 今开 | " + stock_data.get("todayOpen", "--") + " |\n"
    content += "| 最高 | " + stock_data.get("high", "--") + " |\n"
    content += "| 最低 | " + stock_data.get("low", "--") + " |\n"

    # 如果有更多数据（来自腾讯API）
    if "amplitude" in stock_data:
        content += "| 振幅 | " + stock_data.get("amplitude", "--") + "% |\n"
    if "averagePrice" in stock_data:
        content += "| 均价 | " + stock_data.get("averagePrice", "--") + " |\n"
    if "limitUp" in stock_data:
        content += "| 涨停价 | " + stock_data.get("limitUp", "--") + " |\n"
    if "limitDown" in stock_data:
        content += "| 跌停价 | " + stock_data.get("limitDown", "--") + " |\n"

    content += "\n## 成交数据\n\n"
    content += "| 指标 | 值 |\n|---|---|\n"
    content += "| 成交量(手) | " + stock_data.get("volume", "--") + " |\n"
    content += "| 成交额(万) | " + stock_data.get("turnover", "--") + " |\n"

    # 如果有更多数据（来自腾讯API）
    if "outerVolume" in stock_data:
        content += "| 外盘(手) | " + stock_data.get("outerVolume", "--") + " |\n"
    if "innerVolume" in stock_data:
        content += "| 内盘(手) | " + stock_data.get("innerVolume", "--") + " |\n"
    if "turnoverRate" in stock_data:
        content += "| 换手率 | " + stock_data.get("turnoverRate", "--") + "% |\n"
    if "volumeRatio" in stock_data:
        content += "| 量比 | " + stock_data.get("volumeRatio", "--") + " |\n"
    if "bidRatio" in stock_data:
        content += "| 委比 | " + stock_data.get("bidRatio", "--") + "% |\n"

    # 如果有五档盘口数据（来自腾讯API）
    if "bidAsk" in stock_data:
        content += "\n## 五档盘口\n\n"
        content += "| 档位 | 价格 | 挂单量 |\n|---|---|---|\n"
        bid_ask = stock_data["bidAsk"]
        for sid in range(5, 0, -1):
            sell_key = f"sell{sid}"
            if sell_key in bid_ask:
                sell = bid_ask[sell_key]
                content += "| 危" + str(sid) + " | " + _r + sell.get("price", "--") + _e + " | " + sell.get("volume", "--") + " |\n"
        for bid in range(1, 6):
            buy_key = f"buy{bid}"
            if buy_key in bid_ask:
                buy = bid_ask[buy_key]
                content += "| 买" + str(bid) + " | " + _g + buy.get("price", "--") + _e + " | " + buy.get("volume", "--") + " |\n"

    # 如果有估值指标（来自腾讯API）
    if "peDynamic" in stock_data:
        content += "\n## 估值指标\n\n"
        content += "| 指标 | 值 |\n|---|---|\n"
        content += "| 市盈率(动) | " + stock_data.get("peDynamic", "--") + " |\n"
        content += "| 市盈率(静) | " + stock_data.get("peStatic", "--") + " |\n"
        content += "| 市净率 | " + stock_data.get("pb", "--") + " |\n"
        content += "| 总市值(亿) | " + stock_data.get("totalMarketCap", "--") + " |\n"
        content += "| 流通市值(亿) | " + stock_data.get("circulatingMarketCap", "--") + " |\n"

    # 如果有多周期数据（来自腾讯API）
    if "weekChange" in stock_data:
        content += "\n## 多周期涨跌\n\n"
        content += "| 周期 | 涨跌幅 |\n|---|---|\n"
        for label, key in [("本周", "weekChange"), ("本月", "monthChange"), ("本季", "quarterChange"), ("半年", "halfYearChange"), ("本年", "yearChange")]:
            if key in stock_data:
                try:
                    v = float(stock_data[key])
                    c_color = _r if v > 0 else (_g if v < 0 else "")
                    content += "| " + label + " | " + c_color + stock_data[key] + "%" + _e + " |\n"
                except (ValueError, TypeError):
                    content += "| " + label + " | " + stock_data[key] + "% |\n"
        content += "| 52周最高 | " + stock_data.get("week52High", "--") + " |\n"
        content += "| 52周最低 | " + stock_data.get("week52Low", "--") + " |\n"

    # 如果有其他信息（来自腾讯API）
    if "type" in stock_data:
        content += "\n## 其他\n\n"
        content += "| 指标 | 值 |\n|---|---|\n"
        content += "| 品种 | " + stock_data.get("type", "--") + " |\n"
        content += "| 币种 | " + stock_data.get("currency", "--") + " |\n"
        if "dataTime" in stock_data and stock_data["dataTime"]:
            content += "| 数据时间 | " + stock_data["dataTime"] + " |\n"

    return content, name


def register(gw):
    """Register all stock RPC handlers."""
    # stock.config.load 和 stock.config.save 方法
    def _stock_config_load(rid, params):
        try:
            if _stock_cfg_path.exists():
                data = json.loads(_stock_cfg_path.read_text(encoding="utf-8"))
            else:
                data = {}
            return gw._ok(rid, data)
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _stock_config_save(rid, params):
        try:
            data = params.get("data", {})
            _stock_cfg_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            return gw._ok(rid, {"success": True})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    gw._methods["stock.config.load"] = _stock_config_load
    gw._methods["stock.config.save"] = _stock_config_save

    def _stock_query(rid, params):
        codes = (params or {}).get("codes", "")
        if not codes:
            return gw._err(rid, 4001, "缺少股票代码")
        try:
            import urllib.request as _ur
            code_list = [c.strip() for c in codes.split(",") if c.strip()]
            stocks = []
            for code in code_list:
                try:
                    # 尝试腾讯API
                    stock = _fetch_stock_tencent(code, _ur)
                    if not stock or stock.get("price") == "--":
                        # 腾讯失败，尝试新浪API
                        stock = _fetch_stock_sina(code, _ur)
                    stocks.append(stock if stock else {"code": code, "name": code, "price": "--", "change": "0", "changePercent": "0"})
                except Exception:
                    stocks.append({"code": code, "name": code, "price": "--", "change": "0", "changePercent": "0"})
            return gw._ok(rid, {"stocks": stocks})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _stock_detail(rid, params):
        code = (params or {}).get("code", "")
        if not code:
            return gw._err(rid, 4001, "缺少股票代码")
        try:
            import urllib.request as _ur
            # 尝试腾讯API
            stock = _fetch_stock_tencent(code, _ur)
            if not stock or stock.get("price") == "--":
                # 腾讯失败，尝试新浪API
                stock = _fetch_stock_sina(code, _ur)
            
            if not stock or stock.get("price") == "--":
                return gw._err(rid, 5000, "获取股票数据失败")
            
            content, name = _generate_stock_detail_report(code, stock)
            return gw._ok(rid, {"detail": {"name": name, "code": code, "content": content}})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    def _stock_search(rid, params):
        keyword = (params or {}).get("keyword", "").strip()
        if not keyword:
            return gw._ok(rid, {"results": []})
        try:
            import urllib.request as _ur
            import re as _re
            url = "https://smartbox.gtimg.cn/s3/?q=" + _ur.quote(keyword) + "&t=all"
            req = _ur.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with _ur.urlopen(req, timeout=5) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            m = _re.search(r'v_hint="(.+)"', raw)
            if not m:
                return gw._ok(rid, {"results": []})
            content = m.group(1)
            content = _re.sub(r'\\u([0-9a-fA-F]{4})', lambda x: chr(int(x.group(1), 16)), content)
            entries = content.split("^")
            results = []
            for entry in entries:
                parts = entry.split("~")
                if len(parts) >= 5:
                    market = parts[0].strip()
                    code = parts[1].strip()
                    name = parts[2].strip()
                    stype = parts[4].strip()
                    if market in ("sh", "sz") and stype == "GP-A" and code and name:
                        results.append({"code": code, "name": name, "market": market})
                        if len(results) >= 10:
                            break
            return gw._ok(rid, {"results": results})
        except Exception as e:
            return gw._err(rid, 5000, str(e))

    gw._methods["stock.query"] = _stock_query
    gw._methods["stock.detail"] = _stock_detail
    gw._methods["stock.search"] = _stock_search
