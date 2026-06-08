// ── Stock Sidebar Module ──
    var stockWatchList = [];
    var stockThresholds = {};
    var _stockCache = {};
    var _appConfig = {};
    var _configLoaded = false;
    var _configLoading = false;

    function initStockOnConnect() {
      if (stockWatchList.length > 0 && _stockCache && Object.keys(_stockCache).length > 0) {
        var cached = [];
        for (var ci = 0; ci < stockWatchList.length; ci++) {
          var cc = stockWatchList[ci];
          if (_stockCache[cc]) cached.push(_stockCache[cc]);
          else cached.push({ code: cc, name: cc, price: '--', change: '0', changePercent: '0' });
        }
        renderStockList(cached);
      }
      if (stockWatchList.length > 0 && wsStockBody.style.display !== 'none') {
        refreshStockData();
        startStockTimer();
      }
    }

    function loadAppConfig(cb) {
      if (_configLoaded || _configLoading) {
        if (cb) cb();
        return;
      }
      _configLoading = true;

      var cfgId = String(++msgId);
      _rpcCallbacks[cfgId] = function(result) {
        var data = result || {};
        stockWatchList = data.stockWatch || [];
        stockThresholds = data.stockThresholds || {};
        _stockCache = data.stockCache || {};
        _configLoaded = true;
        if (cb) cb();
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: cfgId, method: 'stock.config.load', params: {} }));
    }
    function saveStockConfig() {
      var data = {
        stockWatch: stockWatchList,
        stockThresholds: stockThresholds,
        stockCache: _stockCache
      };
      var saveId = String(++msgId);
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: saveId, method: 'stock.config.save', params: { data: data } }));
    }

    var _stockTimer = null;
    var _lastStockData = [];

    function isTradingTime() {
      var now = new Date();
      var day = now.getDay();
      if (day === 0 || day === 6) return false;
      var h = now.getHours();
      var m = now.getMinutes();
      var t = h * 60 + m;
      return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
    }

    wsStockHeader.onclick = function(e) {
      toggleSection(wsStockBody, wsStockArrow);
      if (wsStockBody.style.display !== 'none') {
        if (stockWatchList.length > 0) {
          refreshStockData();
          startStockTimer();
        } else {
          loadAppConfig(function() {
            if (stockWatchList.length > 0) {
              refreshStockData();
              startStockTimer();
            }
          });
        }
      } else {
        stopStockTimer();
      }
    };

    wsStockRefresh.onclick = function(e) {
      e.stopPropagation();
      refreshStockData();
    };

    function addStockCode(code) {
      code = code.trim();
      if (!code) return;
      if (stockWatchList.indexOf(code) !== -1) { addMsg('\u80a1\u7968 ' + code + ' \u5df2\u5728\u76d1\u63a7\u5217\u8868\u4e2d', 'warn'); return; }
      stockWatchList.push(code);
      saveStockConfig();
      wsStockInput.value = '';
      wsStockDropdown.style.display = 'none';
      refreshStockData();
      if (wsStockBody.style.display !== 'none') startStockTimer();
    }

    wsStockAdd.onclick = function(e) {
      e.stopPropagation();
      var val = wsStockInput.value.trim();
      if (!val) return;
      if (/^\d{6}$/.test(val)) {
        addStockCode(val);
      } else {
        doStockSearch(val);
      }
    };

    wsStockInput.onkeydown = function(e) {
      if (e.key === 'Enter') { e.preventDefault(); wsStockAdd.click(); }
      if (e.key === 'Escape') { wsStockDropdown.style.display = 'none'; }
    };

    wsStockInput.oninput = function() {
      if (_stockSearchTimer) clearTimeout(_stockSearchTimer);
      var val = wsStockInput.value.trim();
      if (!val) { wsStockDropdown.style.display = 'none'; return; }
      if (/^\d{6}$/.test(val)) { wsStockDropdown.style.display = 'none'; return; }
      _stockSearchTimer = setTimeout(function() { doStockSearch(val); }, 400);
    };

    wsStockInput.onfocus = function() {
      if (wsStockDropdown.children.length > 0 && wsStockInput.value.trim() && !/^\d{6}$/.test(wsStockInput.value.trim())) {
        wsStockDropdown.style.display = '';
      }
    };

    function doStockSearch(keyword) {
      var searchId = String(++msgId);
      _rpcCallbacks[searchId] = function(result) {
        var resp = result || {};
        if (resp.error) { wsStockDropdown.style.display = 'none'; return; }
        var results = resp.results || [];
        if (results.length === 0) {
          wsStockDropdown.innerHTML = '<div style="padding:8px 12px;color:var(--hdc-fg-dim);font-size:11px;text-align:center">\u672a\u627e\u5230\u5339\u914d\u80a1\u7968</div>';
          wsStockDropdown.style.display = '';
          return;
        }
        var html = '';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          html += '<div data-search-code="' + hdcEscape(r.code) + '" style="padding:6px 12px;cursor:pointer;font-size:11px;display:flex;justify-content:space-between;align-items:center" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">';
          html += '<span style="color:var(--hdc-fg)">' + hdcEscape(r.name) + '</span>';
          html += '<span style="color:var(--hdc-fg-dim);font-size:10px">' + hdcEscape(r.code) + '</span>';
          html += '</div>';
        }
        wsStockDropdown.innerHTML = html;
        wsStockDropdown.style.display = '';
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: searchId, method: 'stock.search', params: { keyword: keyword } }));
    }

    wsStockDropdown.addEventListener('click', function(e) {
      var item = e.target.closest('[data-search-code]');
      if (!item) return;
      var code = item.getAttribute('data-search-code');
      addStockCode(code);
    });

    document.addEventListener('click', function(e) {
      if (wsStockDropdown && wsStockDropdown.style.display !== 'none' && !wsStockDropdown.contains(e.target) && e.target !== wsStockInput) {
        wsStockDropdown.style.display = 'none';
      }
    });

    function startStockTimer() {
      stopStockTimer();
      if (stockWatchList.length === 0) return;
      // 只在交易时间刷新，非交易时间停止轮询
      if (!isTradingTime()) {
        if (wsStockStatusEl) wsStockStatusEl.textContent = '\u76d8\u540e';
        return;
      }
      if (wsStockStatusEl) wsStockStatusEl.textContent = '\u76d8\u4e2d';
      _stockTimer = setInterval(function() {
        if (wsStockBody.style.display === 'none') { stopStockTimer(); return; }
        if (!isTradingTime()) { stopStockTimer(); if (wsStockStatusEl) wsStockStatusEl.textContent = '\u76d8\u540e'; return; }
        refreshStockData(true);
        checkStockAlerts();
      }, 3000);
    }

    function stopStockTimer() {
      if (_stockTimer) { clearInterval(_stockTimer); _stockTimer = null; }
    }

    function refreshStockData(silent) {
      if (stockWatchList.length === 0) {
        wsStockList.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u6dfb\u52a0\u80a1\u7968\u4ee3\u7801\u67e5\u770b\u884c\u60c5</div>';
        return;
      }
      if (!silent && _stockCache && Object.keys(_stockCache).length > 0) {
        var cached = [];
        for (var ci = 0; ci < stockWatchList.length; ci++) {
          var cc = stockWatchList[ci];
          if (_stockCache[cc]) cached.push(_stockCache[cc]);
          else cached.push({ code: cc, name: cc, price: '--', change: '0', changePercent: '0' });
        }
        renderStockList(cached);
      } else if (!silent) {
        wsStockList.innerHTML = '<div style="padding:12px 8px;text-align:center;color:var(--hdc-fg-dim)">\u52a0\u8f7d\u4e2d...</div>';
      }
      var queryId = String(++msgId);
      _rpcCallbacks[queryId] = function(result) {
        var resp = result || {};
        if (resp.error) {
          if (!silent && !(_lastStockData && _lastStockData.length > 0)) {
            wsStockList.innerHTML = '<div style="padding:12px 8px;text-align:center;color:#e06060">\u83b7\u53d6\u5931\u8d25: ' + hdcEscape(resp.error) + '</div>';
          }
          return;
        }
        var stocks = resp.stocks || [];
        _stockCache = {};
        for (var si = 0; si < stocks.length; si++) {
          _stockCache[stocks[si].code] = stocks[si];
        }
        saveStockConfig();
        renderStockList(stocks);
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: queryId, method: 'stock.query', params: { codes: stockWatchList.join(',') } }));
    }

    function renderStockList(stocks) {
      if (!stocks || stocks.length === 0) {
        wsStockList.innerHTML = '<div style="padding:12px 8px;text-align:center;color:var(--hdc-fg-dim)">\u6682\u65e0\u6570\u636e</div>';
        return;
      }
      _lastStockData = stocks;
      var html = '';
      for (var si = 0; si < stocks.length; si++) {
        var s = stocks[si];
        var price = parseFloat(s.price) || 0;
        var change = parseFloat(s.change) || 0;
        var changePercent = parseFloat(s.changePercent) || 0;
        var changeColor = change > 0 ? '#e06060' : (change < 0 ? '#50c878' : 'var(--hdc-fg-dim)');
        var changeSign = change > 0 ? '+' : '';
        var th = stockThresholds[s.code] || {};
        var buyPrice = parseFloat(th.buy_price) || 0;
        var lots = parseInt(th.lots) || 0;
        var sellTarget = parseFloat(th.sell_target) || 0;
        var lowAlert = parseFloat(th.low_alert) || 0;
        var priceHighlight = '';
        if (sellTarget > 0 && price >= sellTarget) priceHighlight = 'color:#e6a800;font-weight:700';
        else if (lowAlert > 0 && price > 0 && price <= lowAlert) priceHighlight = 'color:#e06060;font-weight:700';
        html += '<div data-stock-idx="' + si + '" style="padding:6px 8px;border-bottom:1px solid var(--hdc-border);cursor:pointer" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center">';
        html += '<span style="color:var(--hdc-fg);font-weight:600">' + hdcEscape(s.name || s.code) + '</span>';
        html += '<span style="' + (priceHighlight || 'color:' + changeColor + ';font-weight:600') + '">' + (s.price || '--') + '</span>';
        html += '</div>';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">';
        html += '<span style="color:var(--hdc-fg-dim);font-size:10px">' + hdcEscape(s.code) + '</span>';
        html += '<span style="color:' + changeColor + ';font-size:10px">' + changeSign + change.toFixed(2) + ' ' + changeSign + changePercent.toFixed(2) + '%</span>';
        html += '</div>';
        if (buyPrice > 0 && price > 0) {
          var totalShares = lots > 0 ? lots * 100 : 1;
          var plValue = (price - buyPrice) * totalShares;
          var plPct = ((price - buyPrice) / buyPrice * 100);
          var plColor = plValue > 0 ? '#e06060' : (plValue < 0 ? '#50c878' : 'var(--hdc-fg-dim)');
          var plSign = plValue > 0 ? '+' : '';
          var plLabel = lots > 0 ? (plSign + plValue.toFixed(0) + '\u5143') : (plSign + plValue.toFixed(2) + '/');
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1px">';
          html += '<span style="color:var(--hdc-fg-dim);font-size:9px">\u4e70\u5165:' + buyPrice.toFixed(2) + (lots > 0 ? ' ' + lots + '\u624b' : '') + '</span>';
          html += '<span style="color:' + plColor + ';font-size:9px;font-weight:600">' + plLabel + ' ' + plSign + plPct.toFixed(2) + '%</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      wsStockList.innerHTML = html;
    }

    function checkStockAlerts() {
      if (!_lastStockData || _lastStockData.length === 0) return;
      for (var ai = 0; ai < _lastStockData.length; ai++) {
        var s = _lastStockData[ai];
        var price = parseFloat(s.price) || 0;
        if (price <= 0) continue;
        var th = stockThresholds[s.code] || {};
        var sellTarget = parseFloat(th.sell_target) || 0;
        var lowAlert = parseFloat(th.low_alert) || 0;
        var alerts = [];
        if (sellTarget > 0 && price >= sellTarget) {
          alerts.push('\u26a0\ufe0f ' + hdcEscape(s.name || s.code) + ' \u73b0\u4ef7 ' + price.toFixed(2) + ' \u5df2\u8fbe\u5230\u5efa\u8bae\u5356\u4ef7 ' + sellTarget.toFixed(2));
        }
        if (lowAlert > 0 && price <= lowAlert) {
          alerts.push('\ud83d\udea8 ' + hdcEscape(s.name || s.code) + ' \u73b0\u4ef7 ' + price.toFixed(2) + ' \u5df2\u8dcc\u7834\u6b62\u635f\u4ef7 ' + lowAlert.toFixed(2));
        }
        for (var aj = 0; aj < alerts.length; aj++) {
          showStockToast(alerts[aj]);
        }
      }
    }

    function showStockToast(msg) {
      var existing = document.getElementById('hdc-stock-toast');
      if (existing) existing.remove();
      var toast = document.createElement('div');
      toast.id = 'hdc-stock-toast';
      toast.style.cssText = 'position:fixed;top:12px;right:12px;z-index:10010;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;padding:10px 16px;font-size:12px;color:var(--hdc-fg);box-shadow:0 4px 16px rgba(0,0,0,0.4);max-width:320px;cursor:pointer;animation:hdcToastIn 0.3s ease';
      toast.textContent = msg;
      toast.onclick = function() { toast.remove(); };
      document.body.appendChild(toast);
      setTimeout(function() { if (toast.parentNode) toast.remove(); }, 8000);
    }

    wsStockList.addEventListener('click', function(e) {
      var stockItem = e.target.closest('[data-stock-idx]');
      if (!stockItem) return;
      var idx = parseInt(stockItem.getAttribute('data-stock-idx'));
      if (isNaN(idx) || idx < 0 || idx >= stockWatchList.length) return;
      var code = stockWatchList[idx];
      openPreview({
        title: '\ud83d\udcc8 ' + code + ' \u52a0\u8f7d\u4e2d...',
        content: '',
        type: 'md',
        editable: false,
        rpc: {
          method: 'stock.detail',
          params: { code: code },
          onResult: function(result) {
            var resp = result || {};
            if (resp.error) return { error: '\u83b7\u53d6\u80a1\u7968\u8be6\u60c5\u5931\u8d25: ' + resp.error };
            var detail = resp.detail || {};
            return {
              title: '\ud83d\udcc8 ' + hdcEscape(detail.name || code),
              content: detail.content || '',
              type: 'md'
            };
          }
        }
      });
    });

    wsStockList.addEventListener('contextmenu', function(e) {
      var stockItem = e.target.closest('[data-stock-idx]');
      if (!stockItem) return;
      e.preventDefault();
      e.stopPropagation();
      var idx = parseInt(stockItem.getAttribute('data-stock-idx'));
      if (isNaN(idx) || idx < 0 || idx >= stockWatchList.length) return;
      wsStockContextIdx = idx;
      wsStockContextMenu.style.display = 'block';
      wsStockContextMenu.style.left = e.clientX + 'px';
      wsStockContextMenu.style.top = e.clientY + 'px';
      var rect = wsStockContextMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) wsStockContextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
      if (rect.bottom > window.innerHeight) wsStockContextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    });

    function hideStockContextMenu() {
      wsStockContextMenu.style.display = 'none';
      wsStockContextIdx = -1;
    }

    wsStockContextMenu.querySelectorAll('div[data-action]').forEach(function(el) {
      el.onclick = function(e) {
        e.stopPropagation();
        var action = el.getAttribute('data-action');
        var idx = wsStockContextIdx;
        hideStockContextMenu();
        if (idx < 0 || idx >= stockWatchList.length) return;
        if (action === 'stock-delete') {
          stockWatchList.splice(idx, 1);
          saveStockConfig();
          if (stockWatchList.length === 0) stopStockTimer();
          refreshStockData();
        } else if (action === 'stock-insert') {
          var code = stockWatchList[idx];
          var insertId = String(++msgId);
          _rpcCallbacks[insertId] = function(result) {
            var resp = result || {};
            if (resp.error) { addMsg('\u83b7\u53d6\u80a1\u7968\u4fe1\u606f\u5931\u8d25: ' + resp.error, 'err'); return; }
            var detail = resp.detail || {};
            attachToAI({
              title: detail.name || code,
              icon: '\ud83d\udcc8',
              lang: 'md',
              content: detail.content || code
            });
          };
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: insertId, method: 'stock.detail', params: { code: code } }));
        } else if (action === 'stock-settings') {
          showStockSettings(idx);
        }
      };
    });

    function showStockSettings(idx) {
      var code = stockWatchList[idx];
      var th = stockThresholds[code] || {};
      var cached = _stockCache[code] || {};
      var name = cached.name || code;
      var price = parseFloat(cached.price) || 0;
      var old = document.getElementById('hdc-stock-settings-overlay');
      if (old) old.remove();
      var overlay = document.createElement('div');
      overlay.id = 'hdc-stock-settings-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10005;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
      var dialog = document.createElement('div');
      dialog.style.cssText = 'background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:12px;padding:20px 24px;min-width:300px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:var(--hdc-fg);font-size:13px';
      var titleStyle = 'font-size:15px;font-weight:700;margin-bottom:14px;color:var(--hdc-fg)';
      var labelStyle = 'display:block;margin-bottom:4px;font-size:11px;color:var(--hdc-fg-dim)';
      var inputStyle = 'width:100%;box-sizing:border-box;background:var(--hdc-muted);border:1px solid var(--hdc-border);border-radius:6px;padding:6px 10px;color:var(--hdc-fg);font-size:13px;outline:none;margin-bottom:12px';
      var btnRow = 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px';
      var btnStyle = 'border:none;border-radius:6px;padding:7px 18px;font-size:12px;cursor:pointer;font-weight:600';
      var plHtml = '';
      if (price > 0) {
        var buyP = parseFloat(th.buy_price) || 0;
        var lts = parseInt(th.lots) || 0;
        if (buyP > 0) {
          var shares = lts > 0 ? lts * 100 : 1;
          var plV = (price - buyP) * shares;
          var plP = ((price - buyP) / buyP * 100);
          var plC = plV > 0 ? '#e06060' : (plV < 0 ? '#50c878' : 'var(--hdc-fg-dim)');
          var plS = plV > 0 ? '+' : '';
          plHtml = '<div style="margin-bottom:12px;padding:8px 10px;background:var(--hdc-muted);border-radius:6px;font-size:12px">' +
            '<div style="color:var(--hdc-fg-dim);margin-bottom:4px">\u5f53\u524d\u76c8\u4e8f</div>' +
            '<div style="color:' + plC + ';font-weight:700;font-size:16px">' + plS + plV.toFixed(2) + '\u5143 (' + plS + plP.toFixed(2) + '%)</div>' +
            '</div>';
        }
      }
      dialog.innerHTML = '<div style="' + titleStyle + '">\u2699 ' + hdcEscape(name) + ' (' + hdcEscape(code) + ')</div>' +
        (price > 0 ? '<div style="margin-bottom:12px;font-size:12px;color:var(--hdc-fg-dim)">\u73b0\u4ef7: <span style="color:var(--hdc-fg);font-weight:700;font-size:16px">' + price.toFixed(2) + '</span></div>' : '') +
        plHtml +
        '<label style="' + labelStyle + '">\u4e70\u5165\u4ef7\u683c</label>' +
        '<input id="hdc-ss-buy" type="number" step="0.01" placeholder="0.00" value="' + (th.buy_price || '') + '" style="' + inputStyle + '">' +
        '<label style="' + labelStyle + '">\u624b\u6570 (1\u624b=100\u80a1)</label>' +
        '<input id="hdc-ss-lots" type="number" step="1" placeholder="0" value="' + (th.lots || '') + '" style="' + inputStyle + '">' +
        '<label style="' + labelStyle + '">\u5efa\u8bae\u5356\u4ef7 (\u8fbe\u5230\u65f6\u63d0\u9192)</label>' +
        '<input id="hdc-ss-sell" type="number" step="0.01" placeholder="0.00" value="' + (th.sell_target || '') + '" style="' + inputStyle + '">' +
        '<label style="' + labelStyle + '">\u6b62\u635f\u4ef7\u683c (\u8dcc\u7834\u65f6\u63d0\u9192)</label>' +
        '<input id="hdc-ss-stop" type="number" step="0.01" placeholder="0.00" value="' + (th.low_alert || '') + '" style="' + inputStyle + '">' +
        '<div style="' + btnRow + '">' +
        '<button id="hdc-ss-cancel" style="' + btnStyle + ';background:var(--hdc-muted);color:var(--hdc-fg-dim)">\u53d6\u6d88</button>' +
        '<button id="hdc-ss-ok" style="' + btnStyle + ';background:var(--hdc-accent);color:' + accentFg + '">\u4fdd\u5b58</button>' +
        '</div>';
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
      document.getElementById('hdc-ss-cancel').onclick = function() { overlay.remove(); };
      document.getElementById('hdc-ss-ok').onclick = function() {
        var bp = parseFloat(document.getElementById('hdc-ss-buy').value) || 0;
        var lt = parseInt(document.getElementById('hdc-ss-lots').value) || 0;
        var st = parseFloat(document.getElementById('hdc-ss-sell').value) || 0;
        var la = parseFloat(document.getElementById('hdc-ss-stop').value) || 0;
        stockThresholds[code] = { buy_price: bp, lots: lt, sell_target: st, low_alert: la };
        saveStockConfig();
        refreshStockData();
        overlay.remove();
      };
    }
