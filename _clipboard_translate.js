// ── Clipboard & Translate Module ──

    var _clipPolling = false;

    function startClipboardWatcher() {
      if (_clipPolling) return;
      _clipPolling = true;
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'fs.clipboard_watch_start', params: {} }));
      _pollClipboardHistory();
    }

    function _pollClipboardHistory() {
      if (!ws || ws.readyState !== 1) return;
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (!result || result.error || !result.history) return;
        var serverHistory = result.history;
        var changed = false;
        for (var si = serverHistory.length - 1; si >= 0; si--) {
          var sitem = serverHistory[si];
          if (!sitem.text || !sitem.text.trim()) continue;
          var duplicate = false;
          for (var hi = 0; hi < clipboardHistory.length; hi++) {
            if (clipboardHistory[hi].text === sitem.text) { duplicate = true; break; }
          }
          if (!duplicate) {
            var contentLen = sitem.text.length;
            var preview = contentLen > 200 ? sitem.text.substring(0, 200).replace(/\n/g, ' ') + '...' : sitem.text.substring(0, 200).replace(/\n/g, ' ');
            clipboardHistory.unshift({ text: sitem.text, preview: preview, time: sitem.time || '', checked: false });
            changed = true;
          }
        }
        if (clipboardHistory.length > 10) clipboardHistory.length = 10;
        if (changed) {
          try {
            var saved = [];
            try { saved = JSON.parse(localStorage.getItem('desktop_clipboard_cache_10') || '[]'); } catch(e) {}
            for (var ci = 0; ci < clipboardHistory.length; ci++) {
              var citem = clipboardHistory[ci];
              var exists = false;
              for (var sj = 0; sj < saved.length; sj++) {
                if (saved[sj].text === citem.text) { exists = true; break; }
              }
              if (!exists) saved.unshift(citem);
            }
            if (saved.length > 10) saved.length = 10;
            localStorage.setItem('desktop_clipboard_cache_10', JSON.stringify(saved));
          } catch (e) {}
          renderClipboardHistory();
        }
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.clipboard_history', params: {} }));
    }

    function onClipboardChanged(text) {
      if (!text || !text.trim()) return;
      var contentLen = text.length;
      var preview = contentLen > 200 ? text.substring(0, 200).replace(/\n/g, ' ') + '...' : text.substring(0, 200).replace(/\n/g, ' ');
      var duplicate = false;
      for (var hi = 0; hi < clipboardHistory.length; hi++) {
        if (clipboardHistory[hi].text === text) { duplicate = true; break; }
      }
      if (!duplicate) {
        var newItem = { text: text, preview: preview, time: new Date().toLocaleTimeString(), checked: false };
        clipboardHistory.unshift(newItem);
        if (clipboardHistory.length > 10) clipboardHistory.length = 10;
        try {
          var saved = [];
          try { saved = JSON.parse(localStorage.getItem('desktop_clipboard_cache_10') || '[]'); } catch(e) {}
          var exists = false;
          for (var si = 0; si < saved.length; si++) {
            if (saved[si].text === newItem.text) { exists = true; break; }
          }
          if (!exists) {
            saved.unshift(newItem);
            if (saved.length > 10) saved.length = 10;
            localStorage.setItem('desktop_clipboard_cache_10', JSON.stringify(saved));
          }
        } catch (e) {}
      }
      renderClipboardHistory();
    }

    wsClipHeader.onclick = function(e) {
      toggleSection(wsClipBody, wsClipArrow);
      if (wsClipBody.style.display !== 'none') {
        startClipboardWatcher();
        _pollClipboardHistory();
      }
    };

    function fetchClipboard() {
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (result.error) { renderClipboardHistory(); return; }
        var content = result.content;
        if (!content || !content.trim()) { renderClipboardHistory(); return; }
        onClipboardChanged(content);
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.read_clipboard', params: {} }));
    }

    function renderClipboardHistory() {
      if (!wsClipList) return;
      if (wsClipCount) wsClipCount.textContent = clipboardHistory.length ? '(' + clipboardHistory.length + ')' : '';
      if (clipboardHistory.length === 0) {
        wsClipList.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u590d\u5236\u6587\u672c\u540e\u81ea\u52a8\u51fa\u73b0\u5728\u6b64\u5904</div>';
        return;
      }
      var html = '';
      for (var hi = 0; hi < clipboardHistory.length; hi++) {
        var hitem = clipboardHistory[hi];
        var ctype = '';
        if (hitem.text.indexOf('\t') >= 0 || hitem.text.indexOf(',') >= 0) ctype = ' [CSV]';
        else if (hitem.text.indexOf('<') >= 0 && hitem.text.indexOf('>') >= 0) ctype = ' [HTML]';
        else if (hitem.text.indexOf('```') >= 0 || hitem.text.indexOf('function') >= 0 || hitem.text.indexOf('def ') >= 0) ctype = ' [\u4ee3\u7801]';
        var checkedAttr = hitem.checked ? 'checked' : '';
        html += '<div data-clip-idx="' + hi + '" style="display:flex;align-items:center;gap:4px;padding:3px 6px;cursor:pointer;border-radius:3px;margin:1px 0" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">' +
          '<input type="checkbox" data-clip-check="' + hi + '" ' + checkedAttr + ' style="flex-shrink:0;margin:0;accent-color:var(--hdc-accent)">' +
          '<span style="flex-shrink:0;font-size:10px;color:var(--hdc-fg-dim)">' + hdcEscape(hitem.time) + '</span>' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:11px;color:var(--hdc-fg)" title="' + hdcEscape(hitem.text.substring(0, 500)) + '">' + hdcEscape(hitem.preview) + ctype + '</span>' +
        '</div>';
      }
      wsClipList.innerHTML = html;
    }

    function showClipContextMenu(e, idx) {
      wsClipContextIdx = idx;
      wsClipContextMenu.style.display = 'block';
      wsClipContextMenu.style.left = Math.min(e.clientX, window.innerWidth - 155) + 'px';
      wsClipContextMenu.style.top = Math.min(e.clientY, window.innerHeight - 150) + 'px';
    }

    function hideClipContextMenu() {
      wsClipContextMenu.style.display = 'none';
      wsClipContextIdx = -1;
    }

    wsClipRefresh.onclick = function(e) { e.stopPropagation(); fetchClipboard(); };

    wsClipContextMenu.querySelectorAll('div[data-action]').forEach(function(el) {
      el.onclick = function(e) {
        e.stopPropagation();
        var action = el.getAttribute('data-action');
        var idx = wsClipContextIdx;
        hideClipContextMenu();
        if (action === 'clip-select') {
          // 多选：切换当前项的选中状态
          if (idx >= 0 && idx < clipboardHistory.length) {
            clipboardHistory[idx].checked = !clipboardHistory[idx].checked;
            renderClipboardHistory();
          }
          return;
        }
        if (action === 'clip-clear') {
          clipboardHistory = [];
          renderClipboardHistory();
          return;
        }
        if (idx < 0 || idx >= clipboardHistory.length) return;
        if (action === 'clip-translate') translateClipItem(idx);
        if (action === 'clip-insert') {
          var item = clipboardHistory[idx];
          attachToAI({
            title: item.time,
            icon: '\ud83d\udccb',
            lang: 'txt',
            content: item.text
          });
        }
        if (action === 'clip-save-note') {
          var clipItem = clipboardHistory[idx];
          if (clipItem) {
            var noteId = String(++msgId);
            _rpcCallbacks[noteId] = function(result) {
              if (result && !result.error) {
                addMsg('\ud83d\udcdd \u5df2\u4fdd\u5b58\u5230\u7b14\u8bb0: ' + hdcEscape(result.title || result.id || ''), 'ok');
                if (typeof loadNotepadList === 'function') loadNotepadList();
              } else {
                addMsg('\u4fdd\u5b58\u7b14\u8bb0\u5931\u8d25', 'err');
              }
            };
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: noteId, method: 'notepad.create', params: { title: '\u526a\u8d34\u677f_' + clipItem.time, content: clipItem.text } }));
          }
        }
        if (action === 'clip-delete') {
          clipboardHistory.splice(idx, 1);
          renderClipboardHistory();
        }
      };
    });

    function translateClipItem(idx) {
      var item = clipboardHistory[idx];
      if (!item) return;
      openPreview({
        title: '\ud83c\udf10 \u7ffb\u8bd1\u7ed3\u679c | \u539f\u6587: ' + item.time,
        content: '',
        type: 'txt',
        editable: false,
        rpc: {
          method: 'fs.translate',
          params: { text: item.text },
          onResult: function(result) {
            if (result.error) return { error: '\u7ffb\u8bd1\u5931\u8d25: ' + result.error.message };
            var translatedContent = result.content;
            return {
              content: translatedContent,
              dualPanel: {
                primary: { label: '\ud83c\udf10 \u8bd1\u6587', content: translatedContent, highlight: true },
                secondary: { label: '\ud83d\udcc4 \u539f\u6587', content: item.text },
                actions: [{
                  label: '\ud83d\udce8 \u63d2\u5165\u5230AI\u5bf9\u8bdd',
                  onClick: function() {
                    attachToAI({ title: '\u7ffb\u8bd1\u7ed3\u679c', icon: '\ud83c\udf10', lang: 'txt', content: translatedContent });
                  }
                }]
              }
            };
          }
        }
      });
    }

    wsClipList.addEventListener('click', function(e) {
      if (e.target.type === 'checkbox') {
        var idx = parseInt(e.target.getAttribute('data-clip-check'));
        if (!isNaN(idx) && idx >= 0 && idx < clipboardHistory.length) {
          clipboardHistory[idx].checked = e.target.checked;
        }
        return;
      }
      var clipItem = e.target.closest('[data-clip-idx]');
      if (clipItem) {
        var idx = parseInt(clipItem.getAttribute('data-clip-idx'));
        if (!isNaN(idx) && idx >= 0 && idx < clipboardHistory.length) {
          openClipboardItem(idx);
        }
      }
    });

    wsClipList.addEventListener('contextmenu', function(e) {
      var clipItem = e.target.closest('[data-clip-idx]');
      if (!clipItem) return;
      e.preventDefault();
      e.stopPropagation();
      var idx = parseInt(clipItem.getAttribute('data-clip-idx'));
      if (!isNaN(idx) && idx >= 0 && idx < clipboardHistory.length) {
        showClipContextMenu(e, idx);
      }
    });

    function openClipboardItem(idx) {
      var item = clipboardHistory[idx];
      if (!item) return;
      openPreview({
        title: '\ud83d\udccb \u526a\u5207\u677f #' + (idx + 1) + ' | ' + item.time,
        content: item.text,
        type: 'txt',
        editable: true
      });
    }

    // 暴露函数到全局，供 _chat_overlay.js 的事件处理调用
    window.startClipboardWatcher = startClipboardWatcher;
    window.onClipboardChanged = onClipboardChanged;
