// ── Event Bus Module ──
// 统一事件分发：接收 vault_changed 事件，推送到所有注册的模块处理器
    var _vaultHandlers = {};

    /**
     * 注册 vault_changed 事件处理器
     * @param {string} key   - 唯一标识（如 'preview', 'todo', 'tree'）
     * @param {function} handler - 处理器函数，接收 payload 参数
     * @param {number} debounceMs - 去抖毫秒数（0 表示不去抖）
     */
    window._registerVaultHandler = function(key, handler, debounceMs) {
      _vaultHandlers[key] = {
        handler: handler,
        debounce: debounceMs || 0,
        _last: 0
      };
    };

    /**
     * 由 _chat_overlay.js 的 ws.onmessage 调用（通过 window 导出）
     * 向所有注册的处理器分发 vault_changed 事件
     */
    window._dispatchVaultChanged = function(payload) {
      var now = Date.now();
      console.log('[EventBus] dispatching to handlers:', Object.keys(_vaultHandlers));
      for (var key in _vaultHandlers) {
        var h = _vaultHandlers[key];
        if (h.debounce <= 0 || now - h._last >= h.debounce) {
          h._last = now;
          try {
            console.log('[EventBus] calling handler:', key);
            h.handler(payload);
          } catch(e) {
            console.error('[EventBus] handler error: ' + key, e);
          }
        } else {
          console.log('[EventBus] debounced:', key);
        }
      }
    };
