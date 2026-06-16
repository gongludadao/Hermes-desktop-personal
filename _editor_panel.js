// ── Editor Panel Module ──
    var _previewSession = 0;
    var _currentDualPanel = null;
    var _originalContent = '';
    var _autoSaveTimer = null;
    var _isPanelCollapsed = false; // ✅ 面板收起状态
    var _panelWidthBeforeCollapse = 0; // ✅ 收起前的宽度

    // ✅ 多标签系统
    var _editorTabs = [];
    var _activeTabId = null;
    var _tabIdCounter = 0;

    // ── 编辑器增强功能 ──
    // 1. 行号显示
    var _lineNumbersEl = null;
    // 2. 查找替换
    var _searchBox = null;
    var _searchMatches = [];
    var _searchCurrentIdx = -1;
    // 5. 多级撤销栈
    var _undoStack = [];
    var _redoStack = [];
    var _undoMaxSize = 200;
    var _lastUndoContent = null;
    var _undoTimer = null;

    function _createTabId() {
      return 'tab-' + (++_tabIdCounter);
    }

    // ── 行号显示 ──
    function _initLineNumbers() {
      if (_lineNumbersEl) return;
      var container = editorTextarea.parentElement;
      if (!container) return;
      _lineNumbersEl = document.createElement('div');
      _lineNumbersEl.id = 'hdc-editor-linenumbers';
      _lineNumbersEl.style.cssText = 'position:absolute;top:0;left:0;bottom:0;width:44px;overflow:hidden;background:var(--hdc-bg);border-right:1px solid var(--hdc-border);color:var(--hdc-fg-dim);font-family:var(--hdc-mono);font-size:13px;line-height:1.6;text-align:right;padding:12px 6px 12px 0;box-sizing:border-box;user-select:none;z-index:4;pointer-events:none;display:none';
      container.style.position = 'relative';
      container.insertBefore(_lineNumbersEl, editorTextarea);
      editorTextarea.style.paddingLeft = '56px';
      editorTextarea.addEventListener('scroll', _syncLineNumbersScroll);
      editorTextarea.addEventListener('input', _updateLineNumbers);
    }

    function _updateLineNumbers() {
      if (!_lineNumbersEl || editorTextarea.style.display === 'none') return;
      var lines = editorTextarea.value.split('\n');
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        html += '<div style="height:1.6em">' + (i + 1) + '</div>';
      }
      _lineNumbersEl.innerHTML = html;
    }

    function _syncLineNumbersScroll() {
      if (_lineNumbersEl) {
        _lineNumbersEl.scrollTop = editorTextarea.scrollTop;
      }
    }

    function _showLineNumbers(show) {
      if (!_lineNumbersEl) _initLineNumbers();
      if (_lineNumbersEl) {
        _lineNumbersEl.style.display = show ? 'block' : 'none';
        editorTextarea.style.paddingLeft = show ? '56px' : '12px';
      }
    }

    // ── 查找替换 ──
    function _initSearchBox() {
      if (_searchBox) return;
      _searchBox = document.createElement('div');
      _searchBox.id = 'hdc-editor-searchbox';
      _searchBox.style.cssText = 'display:none;position:absolute;top:8px;right:8px;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:6px;padding:8px;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,0.3);flex-direction:column;gap:6px;min-width:280px';
      _searchBox.innerHTML =
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<input id="hdc-search-input" placeholder="查找..." style="flex:1;background:var(--hdc-bg);border:1px solid var(--hdc-border);border-radius:4px;padding:4px 8px;color:var(--hdc-fg);font-size:12px;outline:none">' +
          '<span id="hdc-search-count" style="font-size:11px;color:var(--hdc-fg-dim);white-space:nowrap"></span>' +
        '</div>' +
        '<div id="hdc-replace-row" style="display:none;gap:6px;align-items:center">' +
          '<input id="hdc-replace-input" placeholder="替换为..." style="flex:1;background:var(--hdc-bg);border:1px solid var(--hdc-border);border-radius:4px;padding:4px 8px;color:var(--hdc-fg);font-size:12px;outline:none">' +
        '</div>' +
        '<div style="display:flex;gap:4px;justify-content:flex-end">' +
          '<button id="hdc-search-prev" style="background:var(--hdc-muted);border:1px solid var(--hdc-border);color:var(--hdc-fg);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer">↑</button>' +
          '<button id="hdc-search-next" style="background:var(--hdc-muted);border:1px solid var(--hdc-border);color:var(--hdc-fg);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer">↓</button>' +
          '<button id="hdc-search-replace" style="display:none;background:var(--hdc-muted);border:1px solid var(--hdc-border);color:var(--hdc-fg);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer">替换</button>' +
          '<button id="hdc-search-replaceall" style="display:none;background:var(--hdc-muted);border:1px solid var(--hdc-border);color:var(--hdc-fg);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer">全部</button>' +
          '<button id="hdc-search-close" style="background:transparent;border:1px solid var(--hdc-border);color:var(--hdc-fg-dim);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer">✕</button>' +
        '</div>';
      var body = document.getElementById('hdc-editor-body');
      if (body) body.appendChild(_searchBox);

      document.getElementById('hdc-search-close').onclick = _hideSearchBox;
      document.getElementById('hdc-search-prev').onclick = _searchPrev;
      document.getElementById('hdc-search-next').onclick = _searchNext;
      document.getElementById('hdc-search-replace').onclick = _searchReplace;
      document.getElementById('hdc-search-replaceall').onclick = _searchReplaceAll;
      document.getElementById('hdc-search-input').addEventListener('input', _doSearch);
      document.getElementById('hdc-search-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); _searchNext(); }
        if (e.key === 'Escape') { _hideSearchBox(); }
      });
      document.getElementById('hdc-replace-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); _searchReplace(); }
        if (e.key === 'Escape') { _hideSearchBox(); }
      });
    }

    function _showSearchBox(replace) {
      if (!_searchBox) _initSearchBox();
      if (!_searchBox) return;
      _searchBox.style.display = 'flex';
      var replaceRow = document.getElementById('hdc-replace-row');
      var replaceBtn = document.getElementById('hdc-search-replace');
      var replaceAllBtn = document.getElementById('hdc-search-replaceall');
      if (replace) {
        replaceRow.style.display = 'flex';
        replaceBtn.style.display = '';
        replaceAllBtn.style.display = '';
        document.getElementById('hdc-replace-input').focus();
      } else {
        replaceRow.style.display = 'none';
        replaceBtn.style.display = 'none';
        replaceAllBtn.style.display = 'none';
        document.getElementById('hdc-search-input').focus();
      }
      var sel = editorTextarea.value.substring(editorTextarea.selectionStart, editorTextarea.selectionEnd);
      if (sel) document.getElementById('hdc-search-input').value = sel;
      _doSearch();
    }

    function _hideSearchBox() {
      if (_searchBox) _searchBox.style.display = 'none';
      _clearSearchHighlights();
      editorTextarea.focus();
    }

    function _clearSearchHighlights() {
      _searchMatches = [];
      _searchCurrentIdx = -1;
    }

    function _doSearch() {
      var query = document.getElementById('hdc-search-input').value;
      _searchMatches = [];
      _searchCurrentIdx = -1;
      if (!query) {
        document.getElementById('hdc-search-count').textContent = '';
        return;
      }
      var text = editorTextarea.value;
      var idx = text.indexOf(query);
      while (idx >= 0) {
        _searchMatches.push({ start: idx, end: idx + query.length });
        idx = text.indexOf(query, idx + 1);
      }
      document.getElementById('hdc-search-count').textContent = _searchMatches.length + ' 个匹配';
      if (_searchMatches.length > 0) {
        _searchCurrentIdx = 0;
        _scrollToMatch(0);
      }
    }

    function _scrollToMatch(idx) {
      if (idx < 0 || idx >= _searchMatches.length) return;
      var m = _searchMatches[idx];
      editorTextarea.setSelectionRange(m.start, m.end);
      // 计算行号并滚动
      var lineStart = editorTextarea.value.lastIndexOf('\n', m.start) + 1;
      var lineNum = editorTextarea.value.substring(0, m.start).split('\n').length - 1;
      var lineHeight = parseFloat(getComputedStyle(editorTextarea).lineHeight) || 20.8;
      var scrollTop = lineNum * lineHeight - editorTextarea.clientHeight / 2;
      editorTextarea.scrollTop = Math.max(0, scrollTop);
      editorTextarea.focus();
      _syncLineNumbersScroll();
    }

    function _searchNext() {
      if (_searchMatches.length === 0) return;
      _searchCurrentIdx = (_searchCurrentIdx + 1) % _searchMatches.length;
      _scrollToMatch(_searchCurrentIdx);
    }

    function _searchPrev() {
      if (_searchMatches.length === 0) return;
      _searchCurrentIdx = (_searchCurrentIdx - 1 + _searchMatches.length) % _searchMatches.length;
      _scrollToMatch(_searchCurrentIdx);
    }

    function _searchReplace() {
      if (_searchCurrentIdx < 0 || _searchCurrentIdx >= _searchMatches.length) return;
      var replaceText = document.getElementById('hdc-replace-input').value;
      var m = _searchMatches[_searchCurrentIdx];
      var val = editorTextarea.value;
      editorTextarea.value = val.substring(0, m.start) + replaceText + val.substring(m.end);
      var diff = replaceText.length - (m.end - m.start);
      for (var i = _searchCurrentIdx + 1; i < _searchMatches.length; i++) {
        _searchMatches[i].start += diff;
        _searchMatches[i].end += diff;
      }
      _searchMatches.splice(_searchCurrentIdx, 1);
      if (_searchCurrentIdx >= _searchMatches.length) _searchCurrentIdx = 0;
      document.getElementById('hdc-search-count').textContent = _searchMatches.length + ' 个匹配';
      if (_searchMatches.length > 0) _scrollToMatch(_searchCurrentIdx);
      editorTextarea.dispatchEvent(new Event('input'));
    }

    function _searchReplaceAll() {
      var query = document.getElementById('hdc-search-input').value;
      var replaceText = document.getElementById('hdc-replace-input').value;
      if (!query) return;
      editorTextarea.value = editorTextarea.value.split(query).join(replaceText);
      _doSearch();
      editorTextarea.dispatchEvent(new Event('input'));
    }

    // ── 多级撤销栈 ──
    function _pushUndo() {
      var content = editorTextarea.value;
      if (_lastUndoContent === content) return;
      // 如果栈顶与当前内容相同，不重复入栈
      if (_undoStack.length > 0 && _undoStack[_undoStack.length - 1] === content) return;
      _undoStack.push(content);
      if (_undoStack.length > _undoMaxSize) _undoStack.shift();
      _redoStack = [];
      _lastUndoContent = content;
    }

    function _undo() {
      if (_undoStack.length <= 1) return;
      var current = _undoStack.pop();
      _redoStack.push(current);
      var prev = _undoStack[_undoStack.length - 1];
      editorTextarea.value = prev;
      _lastUndoContent = prev;
      editorTextarea.dispatchEvent(new Event('input'));
    }

    function _redo() {
      if (_redoStack.length === 0) return;
      var next = _redoStack.pop();
      _undoStack.push(next);
      editorTextarea.value = next;
      _lastUndoContent = next;
      editorTextarea.dispatchEvent(new Event('input'));
    }

    function _initUndoStack() {
      _undoStack = [editorTextarea.value];
      _redoStack = [];
      _lastUndoContent = editorTextarea.value;
    }

    // ── 字符级 diff 辅助函数 ──
    function _computeCharDiff(oldText, newText) {
      // 简单的LCS-based字符差异
      var maxLen = Math.max(oldText.length, newText.length);
      if (maxLen === 0) return { removed: [], added: [] };
      // 找公共前缀
      var prefix = 0;
      while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix++;
      // 找公共后缀
      var suffix = 0;
      while (suffix < oldText.length - prefix && suffix < newText.length - prefix &&
             oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
      var removed = [];
      var added = [];
      if (prefix + suffix < oldText.length) {
        removed.push({ start: prefix, end: oldText.length - suffix });
      }
      if (prefix + suffix < newText.length) {
        added.push({ start: prefix, end: newText.length - suffix });
      }
      return { removed: removed, added: added };
    }

    function _renderCharDiff(oldText, newText) {
      var diff = _computeCharDiff(oldText, newText);
      var result = { oldHtml: '', newHtml: '' };
      var last = 0;
      for (var i = 0; i < diff.removed.length; i++) {
        var r = diff.removed[i];
        result.oldHtml += hdcEscape(oldText.substring(last, r.start));
        result.oldHtml += '<span style="background:rgba(220,80,80,0.35);text-decoration:line-through">' + hdcEscape(oldText.substring(r.start, r.end)) + '</span>';
        last = r.end;
      }
      result.oldHtml += hdcEscape(oldText.substring(last));
      last = 0;
      for (var i = 0; i < diff.added.length; i++) {
        var a = diff.added[i];
        result.newHtml += hdcEscape(newText.substring(last, a.start));
        result.newHtml += '<span style="background:rgba(80,200,120,0.35)">' + hdcEscape(newText.substring(a.start, a.end)) + '</span>';
        last = a.end;
      }
      result.newHtml += hdcEscape(newText.substring(last));
      return result;
    }

    function _addTab(opts) {
      var tabId = _createTabId();
      var tab = {
        id: tabId,
        title: opts.title || '未命名',
        filePath: opts.filePath || null,
        noteId: opts.noteId || null,
        content: opts.content || '',
        type: opts.type || 'txt',
        editable: opts.editable !== false,
        rawHtml: opts.rawHtml || null,
        dualPanel: opts.dualPanel || null,
        rpc: opts.rpc || null,
        isEditMode: false,
        originalContent: opts.content || '',
        scrollTop: 0,
        selectionStart: 0,
        selectionEnd: 0,
        diffMode: false,
        diffOriginal: ''
      };
      _editorTabs.push(tab);
      _renderTabs();
      return tabId;
    }

    function _removeTab(tabId) {
      var idx = _editorTabs.findIndex(function(t) { return t.id === tabId; });
      if (idx < 0) return;
      _editorTabs.splice(idx, 1);
      if (_activeTabId === tabId) {
        if (_editorTabs.length > 0) {
          var newIdx = Math.min(idx, _editorTabs.length - 1);
          _switchToTab(_editorTabs[newIdx].id);
        } else {
          _activeTabId = null;
          closePreview();
        }
      }
      _renderTabs();
    }

    function _switchToTab(tabId) {
      // 保存当前标签页的状态
      if (_activeTabId) {
        var currentTab = _editorTabs.find(function(t) { return t.id === _activeTabId; });
        if (currentTab) {
          // 保存编辑模式状态
          currentTab.isEditMode = isEditMode;
          // 保存diff状态
          currentTab.diffMode = diffMode;
          currentTab.diffOriginal = diffOriginal;
          // 保存编辑器状态
          if (isEditMode) {
            currentTab.scrollTop = editorTextarea.scrollTop;
            currentTab.selectionStart = editorTextarea.selectionStart;
            currentTab.selectionEnd = editorTextarea.selectionEnd;
            currentTab.content = editorTextarea.value;
          }
          // 如果当前在diff模式，先退出diff视图再切换
          if (diffMode) {
            hideDiffView();
            diffMode = false;
            diffOriginal = '';
          }
        }
      }
      
      var tab = _editorTabs.find(function(t) { return t.id === tabId; });
      if (!tab) return;
      _activeTabId = tabId;
      _loadTabContent(tab);
      _renderTabs();
    }

    function _loadTabContent(tab) {
      currentFilePath = tab.filePath;
      currentNoteId = tab.noteId;
      currentFileContent = tab.content;
      _originalContent = tab.originalContent;
      _currentDualPanel = tab.dualPanel;
      isEditMode = tab.isEditMode || false;
      diffMode = tab.diffMode || false;
      diffOriginal = tab.diffOriginal || '';

      editorFilename.textContent = tab.title;
      editorTextarea.value = tab.content;
      
      // 恢复滚动位置和选中状态
      if (isEditMode) {
        editorTextarea.scrollTop = tab.scrollTop || 0;
        editorTextarea.selectionStart = tab.selectionStart || 0;
        editorTextarea.selectionEnd = tab.selectionEnd || 0;
      }

      editBtn.textContent = isEditMode ? '预览' : '编辑';
      editBtn.style.color = isEditMode ? 'var(--hdc-accent)' : 'var(--hdc-fg-dim)';
      editBtn.style.borderColor = isEditMode ? 'var(--hdc-accent)' : 'var(--hdc-border)';
      editBtn.style.display = tab.editable ? '' : 'none';
      document.getElementById('hdc-editor-save').style.display = isEditMode ? '' : 'none';

      if (isEditMode) {
        editorTextarea.style.display = '';
        editorPreview.style.display = 'none';
        // 显示工具栏
        var toolbar = document.getElementById('hdc-editor-toolbar');
        if (toolbar) toolbar.style.display = 'flex';
        // 初始化增强功能
        _showLineNumbers(true);
        _updateLineNumbers();
        _initUndoStack();
        // 显示状态栏
        _showStatusBar(true);
        _updateStatusBar();
      } else {
        editorTextarea.style.display = 'none';
        editorPreview.style.display = '';
        // 隐藏工具栏
        var toolbar = document.getElementById('hdc-editor-toolbar');
        if (toolbar) toolbar.style.display = 'none';
        _showLineNumbers(false);
        // 隐藏状态栏
        _showStatusBar(false);
        if (tab.dualPanel) {
          renderDualPanel(tab.dualPanel);
        } else if (tab.rawHtml !== null) {
          editorPreview.innerHTML = tab.rawHtml;
        } else if (tab.content) {
          renderPreview(tab.content, tab.type, tab.filePath || '');
        } else {
          editorPreview.innerHTML = '<div style="color:var(--hdc-fg-dim);padding:20px;text-align:center">加载中...</div>';
        }
      }
    }

    function _renderTabs() {
      var tabsContainer = document.getElementById('hdc-editor-tabs');
      if (!tabsContainer) return;
      tabsContainer.innerHTML = '';
      _editorTabs.forEach(function(tab) {
        var tabEl = document.createElement('div');
        tabEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis';
        if (tab.id === _activeTabId) {
          tabEl.style.background = 'var(--hdc-accent)';
          tabEl.style.color = '#000';
        } else {
          tabEl.style.background = 'var(--hdc-muted)';
          tabEl.style.color = 'var(--hdc-fg)';
        }
        tabEl.title = tab.title;
        var titleSpan = document.createElement('span');
        titleSpan.textContent = tab.title;
        titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
        var closeBtn = document.createElement('span');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'margin-left:4px;font-size:14px;opacity:0.7;flex-shrink:0';
        closeBtn.onclick = function(e) {
          e.stopPropagation();
          _removeTab(tab.id);
        };
        tabEl.appendChild(titleSpan);
        tabEl.appendChild(closeBtn);
        tabEl.onclick = function() { _switchToTab(tab.id); };
        tabsContainer.appendChild(tabEl);
      });
    }

    function openPreview(opts) {
      var title = opts.title || '';
      var content = opts.content || '';
      var type = opts.type || 'txt';
      var filePath = opts.filePath || null;
      var editable = opts.editable !== false;
      var rawHtml = opts.rawHtml || null;
      var noteId = opts.noteId || null;
      var rpc = opts.rpc || null;
      var dualPanel = opts.dualPanel || null;

      // ✅ 如果面板是收起状态，先展开
      if (_isPanelCollapsed) {
        expandPanel();
      }

      // ✅ 统一检查是否已有相同内容的标签
      var existingTab = _editorTabs.find(function(t) {
        // 1. 文件路径匹配
        if (filePath && t.filePath === filePath) return true;
        // 2. 笔记ID匹配
        if (noteId && t.noteId === noteId) return true;
        // 3. RPC调用匹配
        if (rpc && t.rpc && t.rpc.method === rpc.method && JSON.stringify(t.rpc.params) === JSON.stringify(rpc.params)) return true;
        // 4. 标题匹配（无其他标识符时）
        if (!filePath && !noteId && !rpc && t.title === title && !t.filePath && !t.noteId && !t.rpc) return true;
        return false;
      });

      // ✅ 如果已有标签，切换到该标签
      if (existingTab) {
        _switchToTab(existingTab.id);
        return;
      }

      // ✅ 创建新标签
      var tabId = _addTab({
        title: title,
        content: content,
        type: type,
        filePath: filePath,
        editable: editable,
        rawHtml: rawHtml,
        noteId: noteId,
        rpc: rpc,
        dualPanel: dualPanel
      });

      _previewSession++;
      var sessionId = _previewSession;
      _switchToTab(tabId);

      if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }

      var header = document.getElementById('hdc-editor-header');
      if (header) header.style.display = '';
      var body = document.getElementById('hdc-editor-body');
      if (body && !body.contains(editorPreview)) {
        body.innerHTML = '';
        body.appendChild(editorPreview);
        body.appendChild(editorTextarea);
      }

      editorPanel.style.display = 'flex';
      editorPanel.style.flex = '1';
      editorPanel.style.width = '';
      if (editorResizerEl) editorResizerEl.style.display = '';
      if (msgsEl) { msgsEl.style.flex = '1'; msgsEl.style.width = ''; }
      if (rpc) {
        var rpcId = String(++msgId);
        _rpcCallbacks[rpcId] = function(result) {
          if (sessionId !== _previewSession) return;
          if (!rpc.onResult) return;
          var updated = rpc.onResult(result);
          if (!updated) return;
          var tab = _editorTabs.find(function(t) { return t.id === tabId; });
          if (!tab) return;
          if (updated.error) {
            editorPreview.innerHTML = '<div style="color:#f66;padding:20px">' + hdcEscape(updated.error) + '</div>';
            return;
          }
          if (updated.title) {
            tab.title = updated.title;
            editorFilename.textContent = updated.title;
          }
          if (updated.content !== undefined) {
            tab.content = updated.content;
            tab.originalContent = updated.content;
            currentFileContent = updated.content;
            editorTextarea.value = updated.content;
            _originalContent = updated.content;
          }
          if (updated.filePath) {
            tab.filePath = updated.filePath;
            currentFilePath = updated.filePath;
          }
          if (updated.noteId) {
            tab.noteId = updated.noteId;
            currentNoteId = updated.noteId;
          }
          if (updated.editable === false) {
            tab.editable = false;
            editBtn.style.display = 'none';
          }
          if (updated.dualPanel) {
            tab.dualPanel = updated.dualPanel;
            _currentDualPanel = updated.dualPanel;
            renderDualPanel(updated.dualPanel);
          } else if (updated.content) {
            renderPreview(updated.content, updated.type || type, updated.filePath || filePath || '');
          }
          _renderTabs();
          if (rpc.onLoaded) rpc.onLoaded(updated);
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: rpcId, method: rpc.method, params: rpc.params || {} }));
      }
    }

    function closePreview() {
      // ✅ 如果有活动标签，关闭当前标签
      if (_activeTabId) {
        _removeTab(_activeTabId);
        return;
      }
      // ✅ 如果没有标签，关闭整个面板
      _isPanelCollapsed = false; // 重置收起状态
      editorPanel.style.display = 'none';
      editorPanel.style.flex = '';
      editorPanel.style.width = '';
      editorPanel.style.opacity = '';
      editorPanel.style.overflow = '';
      if (msgsEl) { msgsEl.style.flex = '1'; msgsEl.style.width = ''; }
      currentFilePath = null;
      currentNoteId = null;
      currentFileContent = '';
      _currentDualPanel = null;
      _originalContent = '';
      if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
      if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
      if (editorResizerEl) editorResizerEl.style.display = 'none';
      // ✅ 隐藏展开按钮条
      var expandBar = document.getElementById('hdc-editor-expand-bar');
      if (expandBar) expandBar.style.display = 'none';
      // ✅ 重置收起按钮
      var collapseBtn = document.getElementById('hdc-editor-collapse');
      if (collapseBtn) {
        collapseBtn.textContent = '▶';
        collapseBtn.title = '收起面板';
      }
    }

    function getFileExt(name) {
      var s = name || '';
      var i = s.lastIndexOf('.');
      return i >= 0 ? s.slice(i + 1).toLowerCase() : '';
    }

    function getFileType(ext) {
      var imgExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
      if (imgExts.indexOf(ext) >= 0) return 'image';
      if (ext === 'md' || ext === 'markdown') return 'markdown';
      if (ext === 'html' || ext === 'htm') return 'html';
      if (ext === 'pdf') return 'pdf';
      if (ext === 'csv') return 'csv';
      var audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
      if (audioExts.indexOf(ext) >= 0) return 'audio';
      var videoExts = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v'];
      if (videoExts.indexOf(ext) >= 0) return 'video';
      return 'code';
    }

    // 加载 Markdown 中的本地图片，通过 RPC 读取转为 base64
    function _loadLocalImages(container, filePath) {
      var imgs = container.querySelectorAll('img');
      imgs.forEach(function(img) {
        var src = img.getAttribute('src');
        if (!src) return;
        // 跳过已经是 data URL 或 http URL 的图片
        if (src.indexOf('data:') === 0 || src.indexOf('http') === 0) return;
        // 解析本地路径
        var imgPath = src;
        if (imgPath.indexOf('/') === 0 || imgPath.indexOf('\\') === 0) {
          // 绝对路径直接使用
        } else if (filePath) {
          // 相对路径，基于当前文件目录
          var lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
          if (lastSlash >= 0) {
            imgPath = filePath.substring(0, lastSlash + 1) + imgPath;
          }
        }
        // 通过 RPC 读取图片
        var rpcId = String(++msgId);
        _rpcCallbacks[rpcId] = function(result) {
          if (result && result.error) return;
          if (result && result.content) {
            var ext = (imgPath.split('.').pop() || 'png').toLowerCase();
            var mime = ext === 'jpg' ? 'jpeg' : ext;
            img.src = 'data:image/' + mime + ';base64,' + result.content;
          }
        };
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          method: 'fs.read_file',
          params: { path: imgPath }
        }));
      });
    }

    function renderPreview(content, ext, path) {
      if (!editorPreview) return;
      editorPreview.innerHTML = '';
      editorPreview.style.display = '';
      editorPreview.style.alignItems = '';
      editorPreview.style.justifyContent = '';
      var ftype = getFileType(ext);

      if (ftype === 'image') {
        if (ext === 'svg') {
          editorPreview.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">' + content + '</div>';
        } else {
          var mime = ext === 'jpg' ? 'jpeg' : ext;
          var img = document.createElement('img');
          img.src = 'data:image/' + mime + ';base64,' + content;
          img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
          editorPreview.appendChild(img);
        }
        return;
      }

      if (ftype === 'markdown') {
        var rendered = renderMarkdown(content);
        editorPreview.innerHTML = '<div style="font-family:var(--hdc-font)">' + rendered + '</div>';
        // 处理本地图片路径：通过 RPC 读取并转为 base64
        _loadLocalImages(editorPreview, path);
        return;
      }

      if (ftype === 'html') {
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff';
        iframe.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation allow-downloads';
        iframe.srcdoc = content;
        editorPreview.appendChild(iframe);
        return;
      }

      if (ftype === 'pdf') {
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff';
        iframe.src = 'data:application/pdf;base64,' + content;
        editorPreview.appendChild(iframe);
        return;
      }

      if (ftype === 'csv') {
        // ✅ 改进的 CSV 解析逻辑
        var rows = [];
        var lines = content.split('\n');
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line) continue;
          var cells = [];
          var currentCell = '';
          var inQuotes = false;
          for (var ci = 0; ci < line.length; ci++) {
            var char = line[ci];
            if (char === '"') {
              if (inQuotes && line[ci + 1] === '"') {
                currentCell += '"';
                ci++;
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              cells.push(currentCell.trim());
              currentCell = '';
            } else {
              currentCell += char;
            }
          }
          cells.push(currentCell.trim());
          rows.push(cells);
        }
        if (rows.length === 0) {
          editorPreview.innerHTML = '<div style="padding:20px;color:var(--hdc-fg-dim)">空文件</div>';
          return;
        }
        var html = '<div style="padding:10px;overflow:auto;max-height:100%"><table style="border-collapse:collapse;font-size:12px;width:100%">';
        for (var ri = 0; ri < rows.length; ri++) {
          var cells = rows[ri];
          html += '<tr>';
          for (var ci = 0; ci < cells.length; ci++) {
            var tag = ri === 0 ? 'th' : 'td';
            var style = ri === 0 ? 'background:var(--hdc-bg-alt);font-weight:600' : '';
            html += '<' + tag + ' style="border:1px solid var(--hdc-border);padding:6px 10px;text-align:left;' + style + '">' + hdcEscape(cells[ci]) + '</' + tag + '>';
          }
          html += '</tr>';
        }
        html += '</table></div>';
        editorPreview.innerHTML = html;
        return;
      }

      if (ftype === 'audio') {
        var mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma' };
        var audioMime = mimeMap[ext] || 'audio/mpeg';
        var audio = document.createElement('audio');
        audio.controls = true;
        audio.autoplay = false;
        audio.style.cssText = 'width:100%;max-width:600px;margin:20px auto;display:block';
        audio.src = 'data:' + audioMime + ';base64,' + content;
        editorPreview.style.display = 'flex';
        editorPreview.style.alignItems = 'center';
        editorPreview.style.justifyContent = 'center';
        editorPreview.appendChild(audio);
        return;
      }

      if (ftype === 'video') {
        var vMimeMap = { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', m4v: 'video/mp4' };
        var videoMime = vMimeMap[ext] || 'video/mp4';
        var video = document.createElement('video');
        video.controls = true;
        video.autoplay = false;
        video.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
        video.src = 'data:' + videoMime + ';base64,' + content;
        editorPreview.appendChild(video);
        return;
      }

      var lines = content.split('\n');
      var html = '<div style="font-family:var(--hdc-mono);font-size:13px;line-height:1.6;tab-size:2">';
      for (var i = 0; i < lines.length; i++) {
        html += '<div style="display:flex;min-height:1.6em">';
        html += '<span style="color:var(--hdc-fg-dim);min-width:44px;text-align:right;padding-right:12px;flex-shrink:0;user-select:none;font-size:11px">' + (i + 1) + '</span>';
        html += '<span style="color:var(--hdc-fg);white-space:pre-wrap;word-break:break-all">' + hdcEscape(lines[i] || ' ') + '</span>';
        html += '</div>';
      }
      html += '</div>';
      editorPreview.innerHTML = html;
    }

    function renderDualPanel(panel) {
      if (!editorPreview) return;
      var html = '<div style="padding:16px;display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:1.7">';
      if (panel.primary) {
        var pStyle = panel.primary.highlight
          ? 'padding:10px 14px;border-radius:8px;background:rgba(80,200,120,0.08);border:1px solid rgba(80,200,120,0.2)'
          : 'padding:10px 14px;border-radius:8px;background:var(--hdc-muted);border:1px solid var(--hdc-border)';
        html += '<div style="' + pStyle + '">';
        if (panel.primary.label) {
          html += '<div style="font-size:11px;color:var(--hdc-fg-dim);margin-bottom:6px">' + hdcEscape(panel.primary.label) + '</div>';
        }
        html += '<div style="white-space:pre-wrap;color:var(--hdc-fg)">' + hdcEscape(panel.primary.content) + '</div>';
        html += '</div>';
      }
      if (panel.secondary) {
        html += '<div style="padding:10px 14px;border-radius:8px;background:var(--hdc-muted);border:1px solid var(--hdc-border)">';
        if (panel.secondary.label) {
          html += '<div style="font-size:11px;color:var(--hdc-fg-dim);margin-bottom:6px">' + hdcEscape(panel.secondary.label) + '</div>';
        }
        html += '<div style="white-space:pre-wrap;color:var(--hdc-fg-dim)">' + hdcEscape(panel.secondary.content) + '</div>';
        html += '</div>';
      }
      if (panel.actions && panel.actions.length > 0) {
        for (var ai = 0; ai < panel.actions.length; ai++) {
          var act = panel.actions[ai];
          html += '<button data-dp-action="' + ai + '" style="align-self:flex-end;background:var(--hdc-accent);color:' + accentFg + ';border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">' + hdcEscape(act.label) + '</button>';
        }
      }
      html += '</div>';
      editorPreview.innerHTML = html;
      if (panel.actions && panel.actions.length > 0) {
        for (var bi = 0; bi < panel.actions.length; bi++) {
          var btn = editorPreview.querySelector('[data-dp-action="' + bi + '"]');
          if (btn && panel.actions[bi].onClick) {
            btn.onclick = panel.actions[bi].onClick;
          }
        }
      }
    }

    function updatePreviewMeta(opts) {
      if (opts.title) editorFilename.textContent = opts.title;
      if (opts.filePath) currentFilePath = opts.filePath;
      if (opts.noteId) currentNoteId = opts.noteId;
      if (opts.content !== undefined) {
        currentFileContent = opts.content;
        editorTextarea.value = opts.content;
      }
    }

    function _doSave(content) {
      if (currentNoteId) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'notepad.update', params: { id: currentNoteId, content: content } }));
        currentFileContent = content;
        editorFilename.textContent = editorFilename.textContent.replace(' ●', '');
        return;
      }
      if (currentFilePath) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'fs.write_file', params: { path: currentFilePath, content: content } }));
        currentFileContent = content;
        editorFilename.textContent = editorFilename.textContent.replace(' ●', '');
      }
    }

    function enterEditMode() {
      isEditMode = true;
      // ✅ 更新当前标签状态
      var tab = _editorTabs.find(function(t) { return t.id === _activeTabId; });
      if (tab) tab.isEditMode = true;
      editorPreview.style.display = 'none';
      editorTextarea.style.display = '';
      editorTextarea.value = currentFileContent;
      editBtn.textContent = '预览';
      editBtn.style.color = 'var(--hdc-accent)';
      editBtn.style.borderColor = 'var(--hdc-accent)';
      document.getElementById('hdc-editor-save').style.display = '';
      // ✅ 显示工具栏
      var toolbar = document.getElementById('hdc-editor-toolbar');
      if (toolbar) toolbar.style.display = 'flex';
      // ✅ 初始化编辑器增强功能
      _showLineNumbers(true);
      _updateLineNumbers();
      _initUndoStack();
      // 显示状态栏
      _showStatusBar(true);
      _updateStatusBar();
    }

    function exitEditMode() {
      isEditMode = false;
      // ✅ 更新当前标签状态
      var tab = _editorTabs.find(function(t) { return t.id === _activeTabId; });
      if (tab) tab.isEditMode = false;
      editorTextarea.style.display = 'none';
      editorPreview.style.display = '';
      editBtn.textContent = '编辑';
      editBtn.style.color = 'var(--hdc-fg-dim)';
      editBtn.style.borderColor = 'var(--hdc-border)';
      document.getElementById('hdc-editor-save').style.display = 'none';
      // ✅ 隐藏工具栏
      var toolbar = document.getElementById('hdc-editor-toolbar');
      if (toolbar) toolbar.style.display = 'none';
      _showLineNumbers(false);
      // 隐藏状态栏
      _showStatusBar(false);
      var ext = getFileExt(currentFilePath || '');
      renderPreview(currentFileContent, ext || 'md', currentFilePath);
    }

    function openFile(path, name) {
      var ext = getFileExt(name);
      openPreview({
        title: name + ' 加载中...',
        content: '',
        type: ext,
        filePath: path,
        rpc: {
          method: 'fs.read_file',
          params: { path: path },
          onResult: function(result) {
            if (result.error) return { error: '加载失败: ' + hdcEscape(result.error.message || '') };
            if (result.content_type === 'directory') {
              var items = result.items || [];
              var md = '# 📁 ' + hdcEscape(result.name || name) + '\n\n';
              var dirs = items.filter(function(i) { return i.is_dir; });
              var files = items.filter(function(i) { return !i.is_dir; });
              if (dirs.length > 0) {
                md += '**文件夹**\n';
                for (var d = 0; d < dirs.length; d++) {
                  md += '- 📁 ' + hdcEscape(dirs[d].name) + '\n';
                }
                md += '\n';
              }
              if (files.length > 0) {
                md += '**文件**\n';
                for (var f = 0; f < files.length; f++) {
                  var sizeStr = files[f].size > 1024 ? (files[f].size / 1024).toFixed(1) + ' KB' : files[f].size + ' B';
                  md += '- 📄 ' + hdcEscape(files[f].name) + '  (' + sizeStr + ')\n';
                }
              }
              if (dirs.length === 0 && files.length === 0) {
                md += '*空文件夹*\n';
              }
              md += '\n---\n共 ' + dirs.length + ' 个文件夹，' + files.length + ' 个文件\n';
              return { title: '📁 ' + (result.name || name), content: md, type: 'md' };
            }
            var resultType = result.content_type === 'pdf' ? 'pdf'
              : result.content_type === 'audio' ? 'audio'
              : result.content_type === 'video' ? 'video'
              : result.content_type === 'image' ? 'image'
              : ext;
            var isBinary = result.content_type === 'pdf' || result.content_type === 'audio' || result.content_type === 'video' || result.content_type === 'image';
            var previewExt = isBinary ? ext : resultType;
            return { title: name, content: result.content, type: previewExt, filePath: result.path, editable: !isBinary };
          }
        }
      });
    }

    editBtn.onclick = function() {
      if (isEditMode) {
        exitEditMode();
      } else {
        enterEditMode();
      }
    };

    document.getElementById('hdc-editor-close').onclick = function() {
      closePreview();
    };

    // ✅ 创建收起按钮（在关闭按钮右边）
    var collapseBtn = document.createElement('button');
    collapseBtn.id = 'hdc-editor-collapse';
    collapseBtn.textContent = '▶';
    collapseBtn.title = '收起面板';
    collapseBtn.style.cssText = 'background:transparent;color:var(--hdc-fg-dim);border:1px solid var(--hdc-border);border-radius:4px;padding:2px 8px;font-size:12px;cursor:pointer;margin-left:4px';
    collapseBtn.onmouseover = function() { this.style.color = 'var(--hdc-accent)'; this.style.borderColor = 'var(--hdc-accent)'; };
    collapseBtn.onmouseout = function() { this.style.color = 'var(--hdc-fg-dim)'; this.style.borderColor = 'var(--hdc-border)'; };
    document.getElementById('hdc-editor-close').parentNode.appendChild(collapseBtn);

    // ✅ 创建展开按钮条（在消息区域和预览面板之间）
    var expandBar = document.createElement('div');
    expandBar.id = 'hdc-editor-expand-bar';
    expandBar.style.cssText = 'display:none;width:28px;background:var(--hdc-card);border-right:1px solid var(--hdc-border);flex-shrink:0;cursor:pointer;align-items:center;justify-content:center;flex-direction:column;gap:4px';
    expandBar.innerHTML = '<div style="font-size:14px;color:var(--hdc-accent)">◀</div><div style="writing-mode:vertical-rl;font-size:11px;color:var(--hdc-fg-dim);padding:4px 0">展开</div>';
    // 插入到消息区域和调整器之间
    var contentEl = document.getElementById('hdc-content');
    if (contentEl) {
      contentEl.insertBefore(expandBar, editorResizerEl);
    }

    // ✅ 收起面板函数
    function collapsePanel() {
      if (_isPanelCollapsed) return;
      _isPanelCollapsed = true;
      _panelWidthBeforeCollapse = editorPanel.offsetWidth;
      
      // 隐藏状态栏
      _showStatusBar(false);
      
      // 隐藏调整器
      if (editorResizerEl) editorResizerEl.style.display = 'none';
      
      // 设置过渡动画
      editorPanel.style.transition = 'flex 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      editorPanel.style.flex = '0 0 0px';
      editorPanel.style.minWidth = '0';
      
      // 显示展开按钮条
      setTimeout(function() {
        expandBar.style.display = 'flex';
        expandBar.style.transition = 'opacity 0.15s ease';
        expandBar.style.opacity = '0';
        requestAnimationFrame(function() {
          expandBar.style.opacity = '1';
        });
      }, 150);
      
      // 更新收起按钮
      collapseBtn.textContent = '◀';
      collapseBtn.title = '展开面板';
      
      // 恢复消息区域宽度
      if (msgsEl) {
        msgsEl.style.transition = 'flex 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        msgsEl.style.flex = '1';
        setTimeout(function() {
          msgsEl.style.transition = '';
        }, 300);
      }
      
      // 清理过渡
      setTimeout(function() {
        editorPanel.style.transition = '';
        editorPanel.style.display = 'none';
      }, 300);
    }

    // ✅ 展开面板函数
    function expandPanel() {
      if (!_isPanelCollapsed) return;
      _isPanelCollapsed = false;
      
      // 显示面板
      editorPanel.style.display = 'flex';
      
      // 隐藏展开按钮条
      expandBar.style.transition = 'opacity 0.15s ease';
      expandBar.style.opacity = '0';
      setTimeout(function() {
        expandBar.style.display = 'none';
        expandBar.style.transition = '';
        expandBar.style.opacity = '';
      }, 150);
      
      // 设置过渡动画
      editorPanel.style.transition = 'flex 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      
      // 恢复宽度
      var targetWidth = _panelWidthBeforeCollapse > 0 ? _panelWidthBeforeCollapse : 400;
      editorPanel.style.flex = '0 0 ' + targetWidth + 'px';
      editorPanel.style.minWidth = '180px';
      
      // 显示调整器
      if (editorResizerEl) editorResizerEl.style.display = '';
      
      // 更新收起按钮
      collapseBtn.textContent = '▶';
      collapseBtn.title = '收起面板';
      
      // 恢复消息区域
      if (msgsEl) {
        msgsEl.style.transition = 'flex 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        msgsEl.style.flex = '1';
        setTimeout(function() {
          msgsEl.style.transition = '';
        }, 300);
      }
      
      // 清理过渡，恢复弹性布局
      setTimeout(function() {
        editorPanel.style.transition = '';
        editorPanel.style.flex = '1';
      }, 300);
      
      // 恢复状态栏（如果在编辑模式且非diff模式）
      if (isEditMode && !diffMode) {
        _showStatusBar(true);
        _updateStatusBar();
      }
    }

    // ✅ 收起按钮点击事件
    collapseBtn.onclick = function() {
      if (_isPanelCollapsed) {
        expandPanel();
      } else {
        collapsePanel();
      }
    };

    // ✅ 展开按钮条点击事件
    expandBar.onclick = function() {
      expandPanel();
    };

    function initResizer(resizerEl, targetEl, minSize, maxPctFn, direction) {
      var isResizing = false;
      var startX = 0;
      var startWidth = 0;
      resizerEl.addEventListener('mousedown', function(e) {
        isResizing = true;
        startX = e.clientX;
        startWidth = targetEl.offsetWidth;
        targetEl.style.flex = 'none';
        targetEl.style.width = startWidth + 'px';
        targetEl.style.minWidth = (minSize || 150) + 'px';
        document.body.style.cursor = direction + '-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        var delta = e.clientX - startX;
        var newSize;
        if (direction === 'col') {
          newSize = startWidth - delta;
        } else {
          newSize = startWidth + delta;
        }
        if (newSize < (minSize || 150)) newSize = minSize || 150;
        var maxSize = maxPctFn ? maxPctFn() : 9999;
        if (newSize > maxSize) newSize = maxSize;
        targetEl.style.width = newSize + 'px';
        targetEl.style.transition = 'none';
      });
      document.addEventListener('mouseup', function() {
        if (isResizing) {
          isResizing = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          targetEl.style.transition = '';
        }
      });
    }

    initResizer(editorResizerEl, editorPanel, 180, function() {
      var contentEl = document.getElementById('hdc-content');
      return contentEl ? contentEl.getBoundingClientRect().width * 0.7 : 9999;
    }, 'col');

    document.getElementById('hdc-editor-save').onclick = function() {
      _doSave(editorTextarea.value);
      exitEditMode();
    };

    // ── 字数统计状态栏 ──
    var _statusBarEl = null;

    function _initStatusBar() {
      if (_statusBarEl) return;
      _statusBarEl = document.createElement('div');
      _statusBarEl.id = 'hdc-editor-statusbar';
      _statusBarEl.style.cssText = 'display:none;position:absolute;bottom:0;left:0;right:0;height:24px;background:var(--hdc-card);border-top:1px solid var(--hdc-border);font-size:11px;color:var(--hdc-fg-dim);padding:0 10px;line-height:24px;text-align:right;z-index:4;flex-shrink:0;user-select:none';
      var body = document.getElementById('hdc-editor-body');
      if (body) {
        body.style.position = 'relative';
        body.appendChild(_statusBarEl);
      }
    }

    function _updateStatusBar() {
      if (!_statusBarEl) return;
      if (!isEditMode || diffMode || _isPanelCollapsed) {
        _statusBarEl.style.display = 'none';
        return;
      }
      _statusBarEl.style.display = 'block';
      var text = editorTextarea.value || '';
      var lineCount = text.split('\n').length;
      var charCount = text.replace(/\n/g, '').length;
      // 中文字符计数
      var chineseMatches = text.match(/[\u4e00-\u9fff]/g);
      var chineseCount = chineseMatches ? chineseMatches.length : 0;
      // 英文单词计数
      var englishMatches = text.match(/[a-zA-Z]+/g);
      var englishCount = englishMatches ? englishMatches.length : 0;
      var wordCount = chineseCount + englishCount;
      _statusBarEl.textContent = '\u884c ' + lineCount + '  \u00b7  \u5b57 ' + wordCount + '  \u00b7  \u5b57\u7b26 ' + charCount;
    }

    function _showStatusBar(show) {
      if (!_statusBarEl) _initStatusBar();
      if (_statusBarEl) {
        _statusBarEl.style.display = show ? 'block' : 'none';
        // 给 textarea 底部留出空间，避免被状态栏遮挡
        editorTextarea.style.paddingBottom = show ? '30px' : '';
        editorTextarea.style.boxSizing = show ? 'border-box' : '';
      }
    }

    // ── 图片粘贴功能 ──
    function _initImagePaste() {
      editorTextarea.addEventListener('paste', function(e) {
        var clipboardData = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
        if (!clipboardData) return;
        var items = clipboardData.items;
        if (!items) return;

        // 检查是否有图片类型
        var imageItem = null;
        var imageType = '';
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image/') === 0) {
            imageItem = items[i];
            imageType = items[i].type;
            break;
          }
        }

        if (!imageItem) return; // 没有图片，让默认粘贴行为继续

        e.preventDefault();

        var blob = imageItem.getAsFile();
        if (!blob) return;

        var reader = new FileReader();
        reader.onload = function() {
          var dataUrl = reader.result;
          // dataUrl 格式: data:image/png;base64,xxxxx
          var base64Index = dataUrl.indexOf(',');
          var base64Data = dataUrl.substring(base64Index + 1);

          // 确定文件扩展名
          var ext = 'png';
          if (imageType === 'image/jpeg') ext = 'jpg';
          else if (imageType === 'image/gif') ext = 'gif';
          else if (imageType === 'image/webp') ext = 'webp';

          // 生成文件名
          var now = new Date();
          var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
          var filename = 'paste_' + now.getFullYear() +
            pad(now.getMonth() + 1) +
            pad(now.getDate()) + '_' +
            pad(now.getHours()) +
            pad(now.getMinutes()) +
            pad(now.getSeconds()) + '.' + ext;

          // 确定保存路径
          var savePath = '';
          if (currentFilePath) {
            var lastSlash = Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\'));
            if (lastSlash >= 0) {
              savePath = currentFilePath.substring(0, lastSlash + 1) + filename;
            } else {
              savePath = filename;
            }
          } else {
            savePath = filename;
          }

          // 通过 fs.write_file RPC 保存图片
          var rpcId = String(++msgId);
          _rpcCallbacks[rpcId] = function(result) {
            if (result && result.error) {
              // 保存失败，插入提示
              var insertText = '![paste_image](' + savePath + ')';
              _insertTextAtCursor(insertText);
              return;
            }
            // 保存成功，插入 Markdown 图片语法
            var insertText = '![paste_image](' + savePath + ')';
            _insertTextAtCursor(insertText);
          };
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            method: 'fs.write_file',
            params: { path: savePath, content: base64Data, encoding: 'base64' }
          }));
        };
        reader.readAsDataURL(blob);
      });
    }

    function _insertTextAtCursor(text) {
      var start = editorTextarea.selectionStart;
      var end = editorTextarea.selectionEnd;
      var value = editorTextarea.value;
      editorTextarea.value = value.substring(0, start) + text + value.substring(end);
      var newPos = start + text.length;
      editorTextarea.setSelectionRange(newPos, newPos);
      editorTextarea.dispatchEvent(new Event('input'));
      editorTextarea.focus();
    }

    // 初始化图片粘贴
    _initImagePaste();
    // 初始化状态栏
    _initStatusBar();

    editorTextarea.oninput = function() {
      if (editorTextarea.value !== currentFileContent) {
        // ✅ 更新当前标签内容
        var tab = _editorTabs.find(function(t) { return t.id === _activeTabId; });
        if (tab) tab.content = editorTextarea.value;
        currentFileContent = editorTextarea.value;
        if (editorFilename.textContent.indexOf('●') < 0) {
          editorFilename.textContent += ' ●';
        }
        // diff模式下禁用自动保存，避免diff基准被破坏
        if (diffMode) {
          if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
          _autoSaveTimer = null;
          return;
        }
        if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
        _autoSaveTimer = setTimeout(function() {
          _doSave(editorTextarea.value);
        }, 800);
        // 更新行号
        _updateLineNumbers();
        // 更新状态栏
        _updateStatusBar();
        // 延迟入栈撤销
        if (_undoTimer) clearTimeout(_undoTimer);
        _undoTimer = setTimeout(function() {
          _pushUndo();
        }, 300);
      } else {
        // 即使内容没变化也更新状态栏（如初始加载时）
        _updateStatusBar();
      }
    };

    // 键盘快捷键：查找替换、撤销重做
    editorTextarea.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        _showSearchBox(false);
      } else if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        _showSearchBox(true);
      } else if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        _undo();
      } else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        _redo();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        var start = editorTextarea.selectionStart;
        var end = editorTextarea.selectionEnd;
        editorTextarea.value = editorTextarea.value.substring(0, start) + '  ' + editorTextarea.value.substring(end);
        editorTextarea.setSelectionRange(start + 2, start + 2);
        editorTextarea.dispatchEvent(new Event('input'));
      }
    });

    // ✅ Markdown 工具栏
    var _mdToolbar = document.getElementById('hdc-editor-toolbar');
    if (_mdToolbar) {
      var _mdButtons = [
        { icon: 'B', title: '粗体', prefix: '**', suffix: '**', placeholder: '粗体文本' },
        { icon: 'I', title: '斜体', prefix: '*', suffix: '*', placeholder: '斜体文本' },
        { icon: 'H1', title: '标题1', prefix: '# ', suffix: '', placeholder: '标题' },
        { icon: 'H2', title: '标题2', prefix: '## ', suffix: '', placeholder: '标题' },
        { icon: 'H3', title: '标题3', prefix: '### ', suffix: '', placeholder: '标题' },
        { icon: '🔗', title: '链接', prefix: '[', suffix: '](url)', placeholder: '链接文本' },
        { icon: '🖼', title: '图片', prefix: '![', suffix: '](url)', placeholder: '图片描述' },
        { icon: '</>', title: '代码', prefix: '`', suffix: '`', placeholder: '代码' },
        { icon: '```', title: '代码块', prefix: '```\n', suffix: '\n```', placeholder: '代码' },
        { icon: '•', title: '列表', prefix: '- ', suffix: '', placeholder: '列表项' },
        { icon: '1.', title: '有序列表', prefix: '1. ', suffix: '', placeholder: '列表项' },
        { icon: '❯', title: '引用', prefix: '> ', suffix: '', placeholder: '引用文本' },
        { icon: '—', title: '分割线', prefix: '\n---\n', suffix: '', placeholder: '' },
        { icon: '☑', title: '任务', prefix: '- [ ] ', suffix: '', placeholder: '任务项' },
        { icon: '表', title: '表格', prefix: '\n| 列1 | 列2 | 列3 |\n|------|------|------|\n| 数据 | 数据 | 数据 |\n', suffix: '', placeholder: '' }
      ];

      _mdButtons.forEach(function(btn) {
        var btnEl = document.createElement('button');
        btnEl.textContent = btn.icon;
        btnEl.title = btn.title;
        btnEl.style.cssText = 'background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:3px;padding:2px 6px;font-size:11px;cursor:pointer;color:var(--hdc-fg);font-family:var(--hdc-mono)';
        btnEl.onmouseover = function() { this.style.background = 'var(--hdc-accent)'; this.style.color = '#000'; };
        btnEl.onmouseout = function() { this.style.background = 'var(--hdc-card)'; this.style.color = 'var(--hdc-fg)'; };
        btnEl.onclick = function() {
          var textarea = editorTextarea;
          // ✅ 保存滚动位置
          var scrollTop = textarea.scrollTop;
          var scrollLeft = textarea.scrollLeft;
          
          var start = textarea.selectionStart;
          var end = textarea.selectionEnd;
          var selectedText = textarea.value.substring(start, end);
          var text = selectedText || btn.placeholder;
          var newText = btn.prefix + text + btn.suffix;
          textarea.value = textarea.value.substring(0, start) + newText + textarea.value.substring(end);
          
          // ✅ 设置光标位置
          var newPos = start + btn.prefix.length + text.length;
          textarea.setSelectionRange(newPos, newPos);
          
          // ✅ 恢复滚动位置
          textarea.scrollTop = scrollTop;
          textarea.scrollLeft = scrollLeft;
          
          // 触发 input 事件
          textarea.dispatchEvent(new Event('input'));
        };
        _mdToolbar.appendChild(btnEl);
      });
    }

    // Diff功能（对比按钮已移除，但功能保留）
    var diffMode = false;
    var diffOriginal = '';
    var _preDiffEditMode = false;  // 进入diff前的编辑/预览模式
    var _preDiffScrollTop = 0;    // 进入diff前的滚动位置
    var _preDiffSaved = false;    // 是否已保存进入diff前的状态
    
    var diffOverlay = document.createElement('div');
    diffOverlay.id = 'hdc-diff-overlay';
    diffOverlay.style.cssText = 'display:none;position:absolute;top:0;left:0;right:0;bottom:44px;overflow-y:auto;font-family:var(--hdc-mono);font-size:13px;line-height:1.6;z-index:5';
    document.getElementById('hdc-editor-body').appendChild(diffOverlay);

    var diffActionBar = document.createElement('div');
    diffActionBar.id = 'hdc-diff-actions';
    diffActionBar.style.cssText = 'display:none;position:absolute;bottom:0;left:0;right:0;height:44px;z-index:6;border-top:1px solid var(--hdc-border);background:var(--hdc-card);padding:6px 12px;gap:8px;align-items:center;justify-content:flex-end';

    var diffAcceptBtn = document.createElement('button');
    diffAcceptBtn.textContent = '✓ 确认更改';
    diffAcceptBtn.style.cssText = 'background:var(--hdc-accent);color:' + accentFg + ';border:none;border-radius:4px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer';

    var diffRevertBtn = document.createElement('button');
    diffRevertBtn.textContent = '↩ 撤回';
    diffRevertBtn.style.cssText = 'background:transparent;color:var(--hdc-fg-dim);border:1px solid var(--hdc-border);border-radius:4px;padding:5px 14px;font-size:12px;cursor:pointer';

    diffActionBar.appendChild(diffRevertBtn);
    diffActionBar.appendChild(diffAcceptBtn);
    document.getElementById('hdc-editor-body').appendChild(diffActionBar);

    diffAcceptBtn.onclick = function() {
      var newContent = editorTextarea.value;
      _doSave(newContent);
      _originalContent = newContent;
      diffOriginal = '';
      diffMode = false;
      confirmedDiffBlocks = {};
      hideDiffView();
      var ext = getFileExt(currentFilePath || '');
      renderPreview(newContent, ext || 'md', currentFilePath);
    };

    diffRevertBtn.onclick = function() {
      if (diffOriginal === '') return;
      var revertContent = diffOriginal;
      editorTextarea.value = revertContent;
      _doSave(revertContent);
      _originalContent = revertContent;
      diffOriginal = '';
      diffMode = false;
      confirmedDiffBlocks = {};
      hideDiffView();
      var ext = getFileExt(currentFilePath || '');
      renderPreview(revertContent, ext || 'md', currentFilePath);
    };

    function computeDiff(oldText, newText) {
      var oldLines = oldText.split('\n');
      var newLines = newText.split('\n');
      var result = [];
      var oi = 0, ni = 0;
      
      while (oi < oldLines.length || ni < newLines.length) {
        if (oi < oldLines.length && ni < newLines.length) {
          if (oldLines[oi] === newLines[ni]) {
            result.push({ type: 'equal', oldLine: oi + 1, newLine: ni + 1, text: oldLines[oi] });
            oi++; ni++;
          } else {
            var removeCount = 0;
            var addCount = 0;
            var tempOi = oi;
            var tempNi = ni;
            
            var maxLookahead = 20;
            while (tempOi < oldLines.length && tempNi < newLines.length && 
                   oldLines[tempOi] !== newLines[tempNi] && 
                   removeCount + addCount < maxLookahead) {
              var foundInNew = false;
              for (var s = ni; s < Math.min(ni + maxLookahead, newLines.length); s++) {
                if (newLines[s] === oldLines[tempOi]) { foundInNew = true; break; }
              }
              var foundInOld = false;
              for (var s2 = oi; s2 < Math.min(oi + maxLookahead, oldLines.length); s2++) {
                if (oldLines[s2] === newLines[tempNi]) { foundInOld = true; break; }
              }
              
              if (!foundInNew && foundInOld) {
                removeCount++;
                tempOi++;
              } else if (foundInNew && !foundInOld) {
                addCount++;
                tempNi++;
              } else {
                removeCount++;
                addCount++;
                tempOi++;
                tempNi++;
              }
            }
            
            if (removeCount > 0 || addCount > 0) {
              for (var r = 0; r < removeCount && oi < oldLines.length; r++) {
                result.push({ type: 'remove', oldLine: oi + 1, text: oldLines[oi] });
                oi++;
              }
              for (var a = 0; a < addCount && ni < newLines.length; a++) {
                result.push({ type: 'add', newLine: ni + 1, text: newLines[ni] });
                ni++;
              }
            } else {
              var foundInNew = -1;
              for (var s = ni + 1; s < Math.min(ni + 5, newLines.length); s++) {
                if (newLines[s] === oldLines[oi]) { foundInNew = s; break; }
              }
              if (foundInNew >= 0) {
                while (ni < foundInNew) {
                  result.push({ type: 'add', newLine: ni + 1, text: newLines[ni] });
                  ni++;
                }
              } else {
                var foundInOld = -1;
                for (var s2 = oi + 1; s2 < Math.min(oi + 5, oldLines.length); s2++) {
                  if (oldLines[s2] === newLines[ni]) { foundInOld = s2; break; }
                }
                if (foundInOld >= 0) {
                  while (oi < foundInOld) {
                    result.push({ type: 'remove', oldLine: oi + 1, text: oldLines[oi] });
                    oi++;
                  }
                } else {
                  result.push({ type: 'remove', oldLine: oi + 1, text: oldLines[oi] });
                  result.push({ type: 'add', newLine: ni + 1, text: newLines[ni] });
                  oi++; ni++;
                }
              }
            }
          }
        } else if (oi < oldLines.length) {
          result.push({ type: 'remove', oldLine: oi + 1, text: oldLines[oi] });
          oi++;
        } else {
          result.push({ type: 'add', newLine: ni + 1, text: newLines[ni] });
          ni++;
        }
      }
      return result;
    }

    var diffBlockStates = {};
    var diffBlockData = {};
    var diffBlockIdCounter = 0;
    var confirmedDiffBlocks = {}; // blockId → true  (confirmed, skip on re-render)

    function renderDiff(diffResult) {
      var html = '';
      diffBlockData = {};
      diffBlockStates = {};
      diffBlockIdCounter = 0;
      
      var blocks = [];
      var i = 0;
      while (i < diffResult.length) {
        var d = diffResult[i];
        
        if (d.type === 'remove') {
          var removeBlock = [];
          var addBlock = [];
          
          while (i < diffResult.length && diffResult[i].type === 'remove') {
            removeBlock.push(diffResult[i]);
            i++;
          }
          
          // 限制 add 数量（最多 remove 的 5 倍），避免贪婪吞掉后续独立 add 块
          var maxAdds = removeBlock.length * 5;
          while (i < diffResult.length && diffResult[i].type === 'add' && addBlock.length < maxAdds) {
            addBlock.push(diffResult[i]);
            i++;
          }
          
          if (removeBlock.length > 0) {
            blocks.push({
              type: 'change',
              removes: removeBlock,
              adds: addBlock
            });
          }
        } else if (d.type === 'add') {
          var addBlock = [];
          while (i < diffResult.length && diffResult[i].type === 'add') {
            addBlock.push(diffResult[i]);
            i++;
          }
          blocks.push({
            type: 'add',
            adds: addBlock
          });
        } else {
          blocks.push({
            type: 'equal',
            line: d
          });
          i++;
        }
      }
      
      for (var j = 0; j < blocks.length; j++) {
        var block = blocks[j];
        
        if (block.type === 'equal') {
          var d = block.line;
          var lineNum = d.oldLine;
          var escapedText = hdcEscape(d.text);
          html += '<div style="padding:0 8px;white-space:pre;display:flex;min-height:20px;align-items:center">';
          html += '<span style="color:var(--hdc-fg-dim);min-width:36px;text-align:right;padding-right:8px;flex-shrink:0;font-size:11px">' + lineNum + '</span>';
          html += '<span style="color:var(--hdc-fg-dim);flex-shrink:0;width:16px"> </span>';
          html += '<span style="color:var(--hdc-fg)">' + escapedText + '</span>';
          html += '</div>';
        } else if (block.type === 'add') {
          var blockId = 'diff-block-' + diffBlockIdCounter++;
          diffBlockStates[blockId] = 'pending';
          diffBlockData[blockId] = { type: 'add', adds: block.adds };
          
          var newStartLine = block.adds[0].newLine;
          var newEndLine = block.adds[block.adds.length - 1].newLine;
          
          html += '<div id="' + blockId + '" class="diff-block" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.1);border-left:3px solid #6ece6e;padding:4px 8px;margin:2px 0;font-size:11px;display:flex;justify-content:space-between;align-items:center">';
          html += '<span style="color:var(--hdc-fg-dim)">';
          html += '➕ 新增: 行 ' + newStartLine;
          if (block.adds.length > 1) {
            html += '-' + newEndLine;
          }
          html += ' (' + block.adds.length + ' 行)';
          html += '</span>';
          html += '<span class="diff-block-actions" style="display:flex;gap:4px;">';
          html += '<button class="diff-btn-confirm" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.3);border:none;color:#6ece6e;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">✓</button>';
          html += '<button class="diff-btn-revert" data-block-id="' + blockId + '" style="background:rgba(220,80,80,0.3);border:none;color:#e06060;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">✖</button>';
          html += '</span>';
          html += '</div>';
          
          for (var k = 0; k < block.adds.length; k++) {
            var d = block.adds[k];
            var escapedText = hdcEscape(d.text);
            html += '<div class="diff-block-content" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.15);padding:0 8px;white-space:pre;display:flex;min-height:20px;align-items:center">';
            html += '<span style="color:var(--hdc-fg-dim);min-width:36px;text-align:right;padding-right:8px;flex-shrink:0;font-size:11px">' + d.newLine + '</span>';
            html += '<span style="color:#6ece6e;flex-shrink:0;width:16px">+</span>';
            html += '<span style="color:#6ece6e">' + escapedText + '</span>';
            html += '</div>';
          }
        } else if (block.type === 'change') {
          var hasRemove = block.removes.length > 0;
          var hasAdd = block.adds.length > 0;
          var blockId = 'diff-block-' + diffBlockIdCounter++;
          diffBlockStates[blockId] = 'pending';
          diffBlockData[blockId] = { type: 'change', removes: block.removes, adds: block.adds };
          
          if (hasRemove && hasAdd) {
            var oldStartLine = block.removes[0].oldLine;
            var oldEndLine = block.removes[block.removes.length - 1].oldLine;
            var newStartLine = block.adds[0].newLine;
            var newEndLine = block.adds[block.adds.length - 1].newLine;
            
            html += '<div id="' + blockId + '" class="diff-block" data-block-id="' + blockId + '" style="background:rgba(255,200,80,0.1);border-left:3px solid #f0a020;padding:4px 8px;margin:2px 0;font-size:11px;display:flex;justify-content:space-between;align-items:center">';
            html += '<span style="color:var(--hdc-fg-dim)">';
            html += '📄 修改块: 行 ' + oldStartLine;
            if (block.removes.length > 1) {
              html += '-' + oldEndLine;
            }
            html += ' → 行 ' + newStartLine;
            if (block.adds.length > 1) {
              html += '-' + newEndLine;
            }
            html += ' (' + block.removes.length + ' 行→' + block.adds.length + ' 行)';
            html += '</span>';
            html += '<span class="diff-block-actions" style="display:flex;gap:4px;">';
            html += '<button class="diff-btn-confirm" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.3);border:none;color:#6ece6e;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">✓</button>';
            html += '<button class="diff-btn-revert" data-block-id="' + blockId + '" style="background:rgba(220,80,80,0.3);border:none;color:#e06060;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">↩</button>';
            html += '</span>';
            html += '</div>';
            
            html += '<div class="diff-block-content" data-block-id="' + blockId + '" style="background:rgba(220,80,80,0.08);padding:2px 8px;border-left:3px solid #e06060">';
            for (var k = 0; k < block.removes.length; k++) {
              var d = block.removes[k];
              // 字符级差异高亮
              var addLine = block.adds[k];
              var charDiff = addLine ? _renderCharDiff(d.text, addLine.text) : { oldHtml: hdcEscape(d.text) };
              html += '<div style="white-space:pre;display:flex;min-height:20px;align-items:center">';
              html += '<span style="color:var(--hdc-fg-dim);min-width:36px;text-align:right;padding-right:8px;flex-shrink:0;font-size:11px">' + d.oldLine + '</span>';
              html += '<span style="color:#e06060;flex-shrink:0;width:16px">-</span>';
              html += '<span style="color:#e06060">' + charDiff.oldHtml + '</span>';
              html += '</div>';
            }
            html += '</div>';
            
            html += '<div class="diff-block-content" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.08);padding:2px 8px;border-left:3px solid #6ece6e">';
            for (var k = 0; k < block.adds.length; k++) {
              var d = block.adds[k];
              var removeLine = block.removes[k];
              var charDiff = removeLine ? _renderCharDiff(removeLine.text, d.text) : { newHtml: hdcEscape(d.text) };
              html += '<div style="white-space:pre;display:flex;min-height:20px;align-items:center">';
              html += '<span style="color:var(--hdc-fg-dim);min-width:36px;text-align:right;padding-right:8px;flex-shrink:0;font-size:11px">' + d.newLine + '</span>';
              html += '<span style="color:#6ece6e;flex-shrink:0;width:16px">+</span>';
              html += '<span style="color:#6ece6e">' + charDiff.newHtml + '</span>';
              html += '</div>';
            }
            html += '</div>';
          } else if (hasRemove) {
            var oldStartLine = block.removes[0].oldLine;
            var oldEndLine = block.removes[block.removes.length - 1].oldLine;
            
            html += '<div id="' + blockId + '" class="diff-block" data-block-id="' + blockId + '" style="background:rgba(220,80,80,0.1);border-left:3px solid #e06060;padding:4px 8px;margin:2px 0;font-size:11px;display:flex;justify-content:space-between;align-items:center">';
            html += '<span style="color:var(--hdc-fg-dim)">';
            html += '✖ 删除: 行 ' + oldStartLine;
            if (block.removes.length > 1) {
              html += '-' + oldEndLine;
            }
            html += ' (' + block.removes.length + ' 行)';
            html += '</span>';
            html += '<span class="diff-block-actions" style="display:flex;gap:4px;">';
            html += '<button class="diff-btn-confirm" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.3);border:none;color:#6ece6e;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">✓</button>';
            html += '<button class="diff-btn-revert" data-block-id="' + blockId + '" style="background:rgba(100,150,220,0.3);border:none;color:#6496dc;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">↩</button>';
            html += '</span>';
            html += '</div>';
            
            for (var k = 0; k < block.removes.length; k++) {
              var d = block.removes[k];
              var escapedText = hdcEscape(d.text);
              html += '<div class="diff-block-content" data-block-id="' + blockId + '" style="background:rgba(220,80,80,0.15);padding:0 8px;white-space:pre;display:flex;min-height:20px;align-items:center">';
              html += '<span style="color:var(--hdc-fg-dim);min-width:36px;text-align:right;padding-right:8px;flex-shrink:0;font-size:11px">' + d.oldLine + '</span>';
              html += '<span style="color:#e06060;flex-shrink:0;width:16px">-</span>';
              html += '<span style="color:#e06060">' + escapedText + '</span>';
              html += '</div>';
            }
          } else if (hasAdd) {
            var newStartLine = block.adds[0].newLine;
            var newEndLine = block.adds[block.adds.length - 1].newLine;
            
            html += '<div id="' + blockId + '" class="diff-block" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.1);border-left:3px solid #6ece6e;padding:4px 8px;margin:2px 0;font-size:11px;display:flex;justify-content:space-between;align-items:center">';
            html += '<span style="color:var(--hdc-fg-dim)">';
            html += '➕ 新增: 行 ' + newStartLine;
            if (block.adds.length > 1) {
              html += '-' + newEndLine;
            }
            html += ' (' + block.adds.length + ' 行)';
            html += '</span>';
            html += '<span class="diff-block-actions" style="display:flex;gap:4px;">';
            html += '<button class="diff-btn-confirm" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.3);border:none;color:#6ece6e;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">✓</button>';
            html += '<button class="diff-btn-revert" data-block-id="' + blockId + '" style="background:rgba(220,80,80,0.3);border:none;color:#e06060;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">✖</button>';
            html += '</span>';
            html += '</div>';
            
            for (var k = 0; k < block.adds.length; k++) {
              var d = block.adds[k];
              var escapedText = hdcEscape(d.text);
              html += '<div class="diff-block-content" data-block-id="' + blockId + '" style="background:rgba(80,200,120,0.15);padding:0 8px;white-space:pre;display:flex;min-height:20px;align-items:center">';
              html += '<span style="color:var(--hdc-fg-dim);min-width:36px;text-align:right;padding-right:8px;flex-shrink:0;font-size:11px">' + d.newLine + '</span>';
              html += '<span style="color:#6ece6e;flex-shrink:0;width:16px">+</span>';
              html += '<span style="color:#6ece6e">' + escapedText + '</span>';
              html += '</div>';
            }
          }
        }
      }
      return html;
    }
    
    function confirmDiffBlock(blockId) {
      if (diffBlockStates[blockId] !== 'pending') return;

      // 确认修改：标记为已确认
      diffBlockStates[blockId] = 'confirmed';
      confirmedDiffBlocks[blockId] = true;

      var blockData = diffBlockData[blockId];

      // 隐藏头部栏（标题+按钮）
      var blockEl = document.getElementById(blockId);
      if (blockEl) { blockEl.style.display = 'none'; }

      // 隐藏删除内容（红色部分），保留新增内容并改为普通文本样式
      var contentEls = diffOverlay.querySelectorAll('.diff-block-content[data-block-id="' + blockId + '"]');
      contentEls.forEach(function(el) {
        // 判断是否为删除内容：包含红色 - 标记的子元素
        var minusSpans = el.querySelectorAll('span[style*="color:#e06060"]');
        var plusSpans = el.querySelectorAll('span[style*="color:#6ece6e"]');
        if (minusSpans.length > 0 && plusSpans.length === 0) {
          // 纯删除内容，隐藏
          el.style.display = 'none';
        } else if (plusSpans.length > 0) {
          // 包含新增内容，改为普通文本样式
          el.style.background = 'transparent';
          el.style.borderLeft = 'none';
          el.style.padding = '0 8px';
          el.querySelectorAll('span[style*="color:#6ece6e"]').forEach(function(s) {
            s.style.color = 'var(--hdc-fg)';
          });
          el.querySelectorAll('span[style*="color:var(--hdc-fg-dim)"]').forEach(function(s) {
            // 保留行号颜色不变
          });
        }
      });

      // 检查是否所有修改块都已处理
      var allProcessed = true;
      for (var id in diffBlockStates) {
        if (diffBlockStates[id] === 'pending') {
          allProcessed = false;
          break;
        }
      }

      // 如果所有修改块都已处理，退出diff模式
      if (allProcessed) {
        _originalContent = editorTextarea.value;
        diffOriginal = '';
        diffMode = false;
        confirmedDiffBlocks = {};
        hideDiffView();
      }
    }
    
    function revertDiffBlock(blockId) {
      if (diffBlockStates[blockId] !== 'pending') return;
      
      var blockData = diffBlockData[blockId];
      if (!blockData) return;
      
      // 获取当前编辑器内容
      var currentLines = editorTextarea.value.split('\n');
      var newLines = [];
      
      if (blockData.type === 'change') {
        // 撤回修改：删除新增的行，恢复删除的行
        var addTexts = blockData.adds.map(function(a) { return a.text; });
        var removeTexts = blockData.removes.map(function(r) { return r.text; });
        
        // 找到新增内容在当前编辑器中的位置（从后往前找，避免行号变化影响）
        var addStartIdx = -1;
        for (var i = currentLines.length - addTexts.length; i >= 0; i--) {
          var match = true;
          for (var j = 0; j < addTexts.length; j++) {
            if (currentLines[i + j] !== addTexts[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            addStartIdx = i;
            break;
          }
        }
        
        // 如果没找到匹配，使用原始行号
        if (addStartIdx === -1) {
          addStartIdx = blockData.adds[0].newLine - 1;
        }
        
        // 构建新内容
        for (var i = 0; i < currentLines.length; i++) {
          if (i >= addStartIdx && i < addStartIdx + addTexts.length) {
            // 这是新增的行，跳过（不加入newLines）
            continue;
          }
          newLines.push(currentLines[i]);
        }
        
        // 在删除位置插入原来的行
        if (removeTexts.length > 0) {
          // 在addStartIdx位置插入原来的行
          var before = newLines.slice(0, addStartIdx);
          var after = newLines.slice(addStartIdx);
          newLines = before.concat(removeTexts).concat(after);
        }
        
        editorTextarea.value = newLines.join('\n');
      } else if (blockData.type === 'add') {
        // 撤回新增：删除新增的行
        var addTexts = blockData.adds.map(function(a) { return a.text; });
        
        // 找到新增内容在当前编辑器中的位置（从后往前找）
        var addStartIdx = -1;
        for (var i = currentLines.length - addTexts.length; i >= 0; i--) {
          var match = true;
          for (var j = 0; j < addTexts.length; j++) {
            if (currentLines[i + j] !== addTexts[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            addStartIdx = i;
            break;
          }
        }
        
        // 如果没找到匹配，使用原始行号
        if (addStartIdx === -1) {
          addStartIdx = blockData.adds[0].newLine - 1;
        }
        
        // 删除新增的行
        for (var i = 0; i < currentLines.length; i++) {
          if (i >= addStartIdx && i < addStartIdx + addTexts.length) {
            continue;
          }
          newLines.push(currentLines[i]);
        }
        
        editorTextarea.value = newLines.join('\n');
      }
      
      diffBlockStates[blockId] = 'reverted';
      
      // 从DOM中隐藏该修改块的所有元素（不影响其他块）
      var blockEl = document.getElementById(blockId);
      if (blockEl) { blockEl.style.display = 'none'; }
      var contentEls = diffOverlay.querySelectorAll('.diff-block-content[data-block-id="' + blockId + '"]');
      contentEls.forEach(function(el) { el.style.display = 'none'; });
      
      // 检查是否所有修改块都已处理
      var allProcessed = true;
      for (var id in diffBlockStates) {
        if (diffBlockStates[id] === 'pending') {
          allProcessed = false;
          break;
        }
      }
      
      // 如果所有修改块都已处理，退出diff模式
      if (allProcessed) {
        _originalContent = editorTextarea.value;
        diffOriginal = '';
        diffMode = false;
        confirmedDiffBlocks = {};
        hideDiffView();
      }
    }

    function bindDiffButtonEvents() {
      diffOverlay.querySelectorAll('.diff-btn-confirm').forEach(function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          var blockId = this.getAttribute('data-block-id');
          confirmDiffBlock(blockId);
        };
      });
      
      diffOverlay.querySelectorAll('.diff-btn-revert').forEach(function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          var blockId = this.getAttribute('data-block-id');
          revertDiffBlock(blockId);
        };
      });
      
      diffOverlay.querySelectorAll('.diff-block').forEach(function(block) {
        block.onclick = function(e) {
          if (e.target.tagName === 'BUTTON') return;
          diffOverlay.querySelectorAll('.diff-block').forEach(function(b) {
            b.style.outline = '';
          });
          this.style.outline = '2px solid var(--hdc-accent)';
        };
      });
    }
    
    function handleDiffKeydown(e) {
      if (!diffMode) return;
      
      if (e.key === 'Enter' && !e.ctrlKey) {
        var highlighted = diffOverlay.querySelector('.diff-block[style*="outline"]');
        if (highlighted) {
          var blockId = highlighted.getAttribute('data-block-id');
          confirmDiffBlock(blockId);
          e.preventDefault();
        }
      } else if (e.key === 'Enter' && e.ctrlKey) {
        for (var blockId in diffBlockStates) {
          if (diffBlockStates[blockId] === 'pending') {
            confirmDiffBlock(blockId);
          }
        }
        e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        var highlighted = diffOverlay.querySelector('.diff-block[style*="outline"]');
        if (highlighted) {
          var blockId = highlighted.getAttribute('data-block-id');
          revertDiffBlock(blockId);
        }
      }
      
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var blocks = Array.from(diffOverlay.querySelectorAll('.diff-block'));
        var highlighted = diffOverlay.querySelector('.diff-block[style*="outline"]');
        var currentIndex = highlighted ? blocks.indexOf(highlighted) : -1;
        
        blocks.forEach(function(b) { b.style.outline = ''; });
        
        var nextIndex;
        if (e.key === 'ArrowDown') {
          nextIndex = currentIndex < blocks.length - 1 ? currentIndex + 1 : 0;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : blocks.length - 1;
        }
        
        if (blocks[nextIndex]) {
          blocks[nextIndex].style.outline = '2px solid var(--hdc-accent)';
          blocks[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        e.preventDefault();
      }
      
      if (e.key === 'Escape') {
        hideDiffView();
        diffMode = false;
        confirmedDiffBlocks = {};
      }
    }

    function showDiffView() {
      if (!diffMode) return;

      // 首次进入diff时保存当前状态
      if (!_preDiffSaved) {
        _preDiffEditMode = !!isEditMode;
        if (isEditMode) {
          _preDiffScrollTop = editorTextarea.scrollTop;
        } else {
          _preDiffScrollTop = editorPreview.scrollTop || 0;
        }
        _preDiffSaved = true;
      }

      var diffResult = computeDiff(diffOriginal, editorTextarea.value);
      diffOverlay.innerHTML = renderDiff(diffResult);
      diffOverlay.style.display = 'block';
      diffActionBar.style.display = 'flex';
      editorPreview.style.display = 'none';
      editorTextarea.style.display = 'none';
      // 进入diff时隐藏工具栏，避免与diff视图重叠
      var toolbar = document.getElementById('hdc-editor-toolbar');
      if (toolbar) toolbar.style.display = 'none';
      // 隐藏行号
      _showLineNumbers(false);
      // 隐藏状态栏
      _showStatusBar(false);
      bindDiffButtonEvents();
      document.addEventListener('keydown', handleDiffKeydown);
    }

    function hideDiffView() {
      diffOverlay.style.display = 'none';
      diffActionBar.style.display = 'none';
      document.removeEventListener('keydown', handleDiffKeydown);

      // 恢复进入diff前的模式
      if (_preDiffEditMode) {
        // 恢复编辑模式
        isEditMode = true;
        editorTextarea.style.display = '';
        editorPreview.style.display = 'none';
        var toolbar = document.getElementById('hdc-editor-toolbar');
        if (toolbar) toolbar.style.display = 'flex';
        editBtn.textContent = '预览';
        editBtn.style.color = 'var(--hdc-accent)';
        editBtn.style.borderColor = 'var(--hdc-accent)';
        document.getElementById('hdc-editor-save').style.display = '';
        // 恢复增强功能
        _showLineNumbers(true);
        _updateLineNumbers();
        // 恢复状态栏
        _showStatusBar(true);
        _updateStatusBar();
        // 恢复滚动位置
        editorTextarea.scrollTop = _preDiffScrollTop;
      } else {
        // 恢复预览模式
        isEditMode = false;
        editorTextarea.style.display = 'none';
        editorPreview.style.display = '';
        var toolbar = document.getElementById('hdc-editor-toolbar');
        if (toolbar) toolbar.style.display = 'none';
        _showLineNumbers(false);
        // 渲染预览并恢复滚动位置
        var ext = getFileExt(currentFilePath || '');
        renderPreview(editorTextarea.value, ext || 'md', currentFilePath);
        editorPreview.scrollTop = _preDiffScrollTop;
      }

      // 重置保存状态
      _preDiffSaved = false;
    }

    function refreshEditor() {
      if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
      if (currentNoteId) {
        var nid = String(++msgId);
        _rpcCallbacks[nid] = function(result) {
          if (result.error) return;
          var newContent = result.content;
          if (newContent === currentFileContent) return;
          
          // 检测到文件变化，触发 diff 模式（如果不在 diff 模式中）
          if (!diffMode) {
            diffOriginal = _originalContent;
            diffMode = true;
          }
          currentFileContent = newContent;
          editorTextarea.value = newContent;
          editorFilename.textContent = editorFilename.textContent.replace(' ●', '');
          
          // 更新完编辑器内容后再显示 diff
          if (diffMode) {
            showDiffView();
          }
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: nid, method: 'notepad.read', params: { id: currentNoteId } }));
        return;
      }
      if (!currentFilePath) return;
      var rid = String(++msgId);
      _rpcCallbacks[rid] = function(result) {
        if (result.error) return;
        var newContent = result.content;
        if (newContent === currentFileContent) return;
        
        // diff模式下只更新编辑器内容，不重置diff状态
        currentFileContent = newContent;
        editorTextarea.value = newContent;
        editorFilename.textContent = editorFilename.textContent.replace(' ●', '');

        // 进入diff模式或刷新已有diff视图
        if (!diffMode) {
          diffOriginal = _originalContent;
          diffMode = true;
        }
        if (diffMode) {
          showDiffView();
        }
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'fs.read_file', params: { path: currentFilePath } }));
    }
    _refreshEditorFn = refreshEditor;

    var insertBtn = document.createElement('button');
    insertBtn.textContent = '↓ 插入到对话';
    insertBtn.style.cssText = 'position:absolute;display:none;background:var(--hdc-accent);color:' + accentFg + ';border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;z-index:10;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap';
    insertBtn.onmousedown = function(e) {
      e.preventDefault();
      e.stopPropagation();
      var sel = '';
      if (isEditMode) {
        sel = editorTextarea.value.substring(editorTextarea.selectionStart, editorTextarea.selectionEnd);
      } else {
        var domSel = window.getSelection();
        sel = domSel ? domSel.toString() : '';
      }
      if (sel) {
        var fname, langHint;
        if (currentFilePath) {
          fname = currentFilePath.split(/[\\/]/).pop();
          var dotIdx = fname.lastIndexOf('.');
          langHint = dotIdx > 0 ? fname.slice(dotIdx + 1) : fname;
        } else if (currentNoteId) {
          fname = editorFilename.textContent.replace(' ●', '').trim();
          langHint = 'md';
        } else {
          fname = 'file';
          langHint = '';
        }
        var startLine = 1;
        var endLine = 1;
        if (isEditMode) {
          startLine = editorTextarea.value.substring(0, editorTextarea.selectionStart).split('\n').length;
          endLine = startLine + sel.split('\n').length - 1;
        } else {
          // 预览模式下根据选区在DOM中的位置计算行号
          var domSel = window.getSelection();
          if (domSel && domSel.rangeCount > 0) {
            var range = domSel.getRangeAt(0);
            var startNode = range.startContainer;
            // 向上找到包含行号的元素
            var lineEl = startNode.parentElement;
            while (lineEl && lineEl !== editorPreview) {
              var lineNumMatch = lineEl.textContent.match(/^(\d+)/);
              if (lineNumMatch) {
                startLine = parseInt(lineNumMatch[1], 10);
                break;
              }
              lineEl = lineEl.parentElement;
            }
            endLine = startLine + sel.split('\n').length - 1;
          }
        }
        attachments.push({
          type: 'snippet',
          fileName: fname,
          filePath: currentFilePath || '',
          lang: langHint,
          content: sel,
          startLine: startLine,
          endLine: endLine,
          preview: fname + ':' + startLine + '-' + endLine
        });
        renderAttachments();
        if (inpEl) inpEl.focus();
      }
      insertBtn.style.display = 'none';
    };
    document.getElementById('hdc-editor-body').appendChild(insertBtn);

    // 点击其他区域时隐藏插入按钮
    document.addEventListener('mousedown', function(e) {
      if (insertBtn.contains(e.target)) return;
      var body = document.getElementById('hdc-editor-body');
      if (body && body.contains(e.target)) return;
      insertBtn.style.display = 'none';
    });

    // 编辑器/预览失焦时隐藏插入按钮
    editorTextarea.addEventListener('blur', function() {
      setTimeout(function() {
        if (!insertBtn.contains(document.activeElement)) {
          insertBtn.style.display = 'none';
        }
      }, 100);
    });
    // 预览面板是div，不会触发blur，用mousedown在预览面板内非选区点击时隐藏
    editorPreview.addEventListener('mousedown', function(e) {
      var domSel = window.getSelection();
      var selText = domSel ? domSel.toString() : '';
      if (!selText || !selText.trim()) {
        insertBtn.style.display = 'none';
      }
    });

    var lastMouseY = 0;
    editorTextarea.onmouseup = function(e) { lastMouseY = e.offsetY; showInsertBtn(); };
    editorTextarea.onkeyup = function(e) { if (e.shiftKey || e.key === 'Shift') showInsertBtn(); };

    editorPreview.onmouseup = function(e) { lastMouseY = e.offsetY; showPreviewInsertBtn(e); };
    editorPreview.onkeyup = function(e) { if (e.shiftKey || e.key === 'Shift') showPreviewInsertBtn(e); };

    function showInsertBtn() {
      var sel = editorTextarea.value.substring(editorTextarea.selectionStart, editorTextarea.selectionEnd);
      if (sel && sel.trim()) {
        insertBtn.style.display = 'block';
        var bodyRect = document.getElementById('hdc-editor-body').getBoundingClientRect();
        var taRect = editorTextarea.getBoundingClientRect();
        var offsetY = taRect.top - bodyRect.top;
        var btnTop = Math.max(4, Math.min(lastMouseY + offsetY - 30, editorTextarea.offsetHeight - 28));
        insertBtn.style.left = '12px';
        insertBtn.style.top = btnTop + 'px';
        insertBtn.style.right = 'auto';
      } else {
        insertBtn.style.display = 'none';
      }
    }

    function showPreviewInsertBtn(e) {
      var domSel = window.getSelection();
      var selText = domSel ? domSel.toString() : '';
      if (selText && selText.trim()) {
        insertBtn.style.display = 'block';
        var bodyRect = document.getElementById('hdc-editor-body').getBoundingClientRect();
        var previewRect = editorPreview.getBoundingClientRect();
        var selRange = domSel.getRangeAt(0);
        var selRect = selRange.getBoundingClientRect();
        var btnTop = Math.max(4, Math.min(selRect.top - bodyRect.top - 30, previewRect.height - 28));
        insertBtn.style.left = '12px';
        insertBtn.style.top = btnTop + 'px';
        insertBtn.style.right = 'auto';
      } else {
        insertBtn.style.display = 'none';
      }
    }
