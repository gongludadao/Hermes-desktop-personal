// ── Notepad Module ──

    var _notepadLoaded = false;
    var _notepadList = [];
    var _noteContextIdx = -1;

    function loadNotepadList() {
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (!result || result.error || !result.notes) return;
        _notepadList = result.notes;
        if (wsNoteCount) wsNoteCount.textContent = _notepadList.length ? '(' + _notepadList.length + ')' : '';
        renderNotepadList();
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'notepad.list', params: {} }));
    }

    function renderNotepadList() {
      if (!wsNoteList) return;
      if (_notepadList.length === 0) {
        wsNoteList.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u53f3\u952e\u65b0\u5efa\u7b14\u8bb0</div>';
        return;
      }
      var html = '';
      for (var ni = 0; ni < _notepadList.length; ni++) {
        var note = _notepadList[ni];
        html += '<div data-note-idx="' + ni + '" style="display:flex;align-items:center;gap:4px;padding:4px 6px;cursor:pointer;border-radius:3px;margin:1px 0" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:11px;color:var(--hdc-fg)" title="' + hdcEscape(note.title) + '">' + hdcEscape(note.title) + '</span>' +
          '<span style="flex-shrink:0;font-size:9px;color:var(--hdc-fg-dim)">' + hdcEscape(note.mtime ? note.mtime.substring(5, 10) : '') + '</span>' +
        '</div>';
      }
      wsNoteList.innerHTML = html;
    }

    function openNotepadItem(idx) {
      var note = _notepadList[idx];
      if (!note) return;
      openPreview({
        title: '\ud83d\udcdd ' + note.title,
        content: '',
        type: 'md',
        editable: true,
        noteId: note.id,
        rpc: {
          method: 'notepad.read',
          params: { id: note.id },
          onResult: function(result) {
            if (!result || result.error) return null;
            return { title: '\ud83d\udcdd ' + result.title, content: result.content || '', type: 'md' };
          }
        }
      });
    }

    function createNotepad() {
      openPreview({
        title: '\ud83d\udcdd \u65b0\u7b14\u8bb0',
        content: '',
        type: 'md',
        editable: true,
        rpc: {
          method: 'notepad.create',
          params: { title: '', content: '' },
          onResult: function(result) {
            if (!result || result.error) return null;
            loadNotepadList();
            return { title: '\ud83d\udcdd ' + result.title, content: '', type: 'md', noteId: result.id };
          }
        }
      });
    }

    function deleteNotepad(idx) {
      var note = _notepadList[idx];
      if (!note) return;
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (!result || result.error) return;
        loadNotepadList();
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'notepad.delete', params: { id: note.id } }));
    }

    function renameNotepad(idx) {
      var note = _notepadList[idx];
      if (!note) return;
      var newTitle = prompt('\u91cd\u547d\u540d\u7b14\u8bb0:', note.title);
      if (!newTitle || newTitle.trim() === '' || newTitle.trim() === note.title) return;
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (!result || result.error) {
          addMsg('\u91cd\u547d\u540d\u5931\u8d25: ' + (result.error ? result.error.message : ''), 'err');
          return;
        }
        loadNotepadList();
        addMsg('\u5df2\u91cd\u547d\u540d\u4e3a "' + result.title + '"', 'ok');
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'notepad.rename', params: { id: note.id, title: newTitle.trim() } }));
    }

    function sendNotepadToAI(idx) {
      var note = _notepadList[idx];
      if (!note) return;
      // 先读取笔记内容以获取完整路径
      var rid = String(++msgId);
      _rpcCallbacks[rid] = function(result) {
        if (!result || result.error) {
          addMsg('读取笔记失败', 'err');
          return;
        }
        attachToAI({
          title: result.title || note.title,
          icon: '\ud83d\udcdd',
          lang: 'md',
          content: result.content || '',
          filePath: result.path || ''  // ✅ 包含完整路径
        });
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'notepad.read', params: { id: note.id } }));
    }

    function showNoteContextMenu(e, idx) {
      _noteContextIdx = idx;
      wsNoteContextMenu.style.display = 'block';
      wsNoteContextMenu.style.left = Math.min(e.clientX, window.innerWidth - 155) + 'px';
      wsNoteContextMenu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
    }

    function hideNoteContextMenu() {
      wsNoteContextMenu.style.display = 'none';
      _noteContextIdx = -1;
    }

    wsNoteHeader.onclick = function(e) {
      toggleSection(wsNoteBody, wsNoteArrow);
      if (wsNoteBody.style.display !== 'none' && !_notepadLoaded) {
        _notepadLoaded = true;
        loadNotepadList();
      }
    };

    wsNoteRefresh.onclick = function(e) { e.stopPropagation(); loadNotepadList(); };

    wsNoteList.addEventListener('click', function(e) {
      var noteItem = e.target.closest('[data-note-idx]');
      if (noteItem) {
        var idx = parseInt(noteItem.getAttribute('data-note-idx'));
        if (!isNaN(idx) && idx >= 0 && idx < _notepadList.length) {
          openNotepadItem(idx);
        }
      }
    });

    wsNoteList.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var noteItem = e.target.closest('[data-note-idx]');
      if (noteItem) {
        var idx = parseInt(noteItem.getAttribute('data-note-idx'));
        if (!isNaN(idx) && idx >= 0 && idx < _notepadList.length) {
          showNoteContextMenu(e, idx);
        }
      } else {
        // 右键空白区域：显示菜单用于新建
        _noteContextIdx = -1;
        wsNoteContextMenu.style.display = 'block';
        wsNoteContextMenu.style.left = Math.min(e.clientX, window.innerWidth - 155) + 'px';
        wsNoteContextMenu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
      }
    });

    wsNoteContextMenu.querySelectorAll('div[data-action]').forEach(function(el) {
      el.onclick = function(e) {
        e.stopPropagation();
        var action = el.getAttribute('data-action');
        var idx = _noteContextIdx;
        hideNoteContextMenu();
        if (action === 'note-create') { createNotepad(); return; }
        if (idx < 0 || idx >= _notepadList.length) return;
        if (action === 'note-send-ai') sendNotepadToAI(idx);
      if (action === 'note-rename') renameNotepad(idx);
      if (action === 'note-delete') deleteNotepad(idx);
      };
    });
