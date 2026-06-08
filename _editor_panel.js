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

    function _createTabId() {
      return 'tab-' + (++_tabIdCounter);
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
        diffMode: false,
        diffOriginal: '',
        originalContent: opts.content || ''
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
      diffOriginal = tab.diffOriginal;
      diffMode = tab.diffMode;
      isEditMode = tab.isEditMode;

      editorFilename.textContent = tab.title;
      editorTextarea.value = tab.content;

      diffOverlay.style.display = diffMode ? '' : 'none';
      diffActionBar.style.display = diffMode ? '' : 'none';
      diffBtn.style.display = tab.editable ? '' : 'none';
      editBtn.textContent = isEditMode ? '预览' : '编辑';
      editBtn.style.color = isEditMode ? 'var(--hdc-accent)' : 'var(--hdc-fg-dim)';
      editBtn.style.borderColor = isEditMode ? 'var(--hdc-accent)' : 'var(--hdc-border)';
      editBtn.style.display = tab.editable ? '' : 'none';
      document.getElementById('hdc-editor-save').style.display = 'none';

      if (isEditMode) {
        editorTextarea.style.display = '';
        editorPreview.style.display = 'none';
      } else {
        editorTextarea.style.display = 'none';
        editorPreview.style.display = '';
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
            diffBtn.style.display = 'none';
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
      diffMode = false;
      diffOriginal = '';
      diffOverlay.style.display = 'none';
      diffActionBar.style.display = 'none';
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
        editorPreview.innerHTML = '<div style="font-family:var(--hdc-font)">' + renderMarkdown(content) + '</div>';
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
        editorFilename.textContent = editorFilename.textContent.replace(' \u25cf', '');
        return;
      }
      if (currentFilePath) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'fs.write_file', params: { path: currentFilePath, content: content } }));
        currentFileContent = content;
        editorFilename.textContent = editorFilename.textContent.replace(' \u25cf', '');
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
      editBtn.textContent = '\u9884\u89c8';
      editBtn.style.color = 'var(--hdc-accent)';
      editBtn.style.borderColor = 'var(--hdc-accent)';
      document.getElementById('hdc-editor-save').style.display = '';
      // ✅ 显示工具栏
      var toolbar = document.getElementById('hdc-editor-toolbar');
      if (toolbar) toolbar.style.display = 'flex';
      if (diffMode) {
        diffMode = false;
        if (tab) tab.diffMode = false;
        diffBtn.textContent = '\u5bf9\u6bd4';
        diffBtn.style.background = 'transparent';
        diffBtn.style.color = 'var(--hdc-accent)';
        hideDiffView();
      }
    }

    function exitEditMode() {
      isEditMode = false;
      // ✅ 更新当前标签状态
      var tab = _editorTabs.find(function(t) { return t.id === _activeTabId; });
      if (tab) tab.isEditMode = false;
      editorTextarea.style.display = 'none';
      editorPreview.style.display = '';
      editBtn.textContent = '\u7f16\u8f91';
      editBtn.style.color = 'var(--hdc-fg-dim)';
      editBtn.style.borderColor = 'var(--hdc-border)';
      document.getElementById('hdc-editor-save').style.display = 'none';
      // ✅ 隐藏工具栏
      var toolbar = document.getElementById('hdc-editor-toolbar');
      if (toolbar) toolbar.style.display = 'none';
      var ext = getFileExt(currentFilePath || '');
      renderPreview(currentFileContent, ext || 'md', currentFilePath);
    }

    function openFile(path, name) {
      var ext = getFileExt(name);
      openPreview({
        title: name + ' \u52a0\u8f7d\u4e2d...',
        content: '',
        type: ext,
        filePath: path,
        rpc: {
          method: 'fs.read_file',
          params: { path: path },
          onResult: function(result) {
            if (result.error) return { error: '\u52a0\u8f7d\u5931\u8d25: ' + hdcEscape(result.error.message || '') };
            if (result.content_type === 'directory') {
              var items = result.items || [];
              var md = '# \ud83d\udcc1 ' + hdcEscape(result.name || name) + '\n\n';
              var dirs = items.filter(function(i) { return i.is_dir; });
              var files = items.filter(function(i) { return !i.is_dir; });
              if (dirs.length > 0) {
                md += '**\u6587\u4ef6\u5939**\n';
                for (var d = 0; d < dirs.length; d++) {
                  md += '- \ud83d\udcc1 ' + hdcEscape(dirs[d].name) + '\n';
                }
                md += '\n';
              }
              if (files.length > 0) {
                md += '**\u6587\u4ef6**\n';
                for (var f = 0; f < files.length; f++) {
                  var sizeStr = files[f].size > 1024 ? (files[f].size / 1024).toFixed(1) + ' KB' : files[f].size + ' B';
                  md += '- \ud83d\udcc4 ' + hdcEscape(files[f].name) + '  (' + sizeStr + ')\n';
                }
              }
              if (dirs.length === 0 && files.length === 0) {
                md += '*\u7a7a\u6587\u4ef6\u5939*\n';
              }
              md += '\n---\n\u5171 ' + dirs.length + ' \u4e2a\u6587\u4ef6\u5939\uff0c' + files.length + ' \u4e2a\u6587\u4ef6\n';
              return { title: '\ud83d\udcc1 ' + (result.name || name), content: md, type: 'md' };
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

    editorTextarea.oninput = function() {
      if (editorTextarea.value !== currentFileContent) {
        // ✅ 更新当前标签内容
        var tab = _editorTabs.find(function(t) { return t.id === _activeTabId; });
        if (tab) tab.content = editorTextarea.value;
        currentFileContent = editorTextarea.value;
        if (editorFilename.textContent.indexOf('\u25cf') < 0) {
          editorFilename.textContent += ' \u25cf';
        }
        if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
        _autoSaveTimer = setTimeout(function() {
          _doSave(editorTextarea.value);
        }, 800);
      }
    };

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

    var diffBtn = document.getElementById('hdc-editor-diff');
    var diffOverlay = document.createElement('div');
    diffOverlay.id = 'hdc-diff-overlay';
    diffOverlay.style.cssText = 'display:none;position:absolute;top:0;left:0;right:0;bottom:44px;overflow-y:auto;font-family:var(--hdc-mono);font-size:13px;line-height:1.6;z-index:5';
    document.getElementById('hdc-editor-body').appendChild(diffOverlay);

    var diffActionBar = document.createElement('div');
    diffActionBar.id = 'hdc-diff-actions';
    diffActionBar.style.cssText = 'display:none;position:absolute;bottom:0;left:0;right:0;height:44px;z-index:6;border-top:1px solid var(--hdc-border);background:var(--hdc-card);padding:6px 12px;gap:8px;align-items:center;justify-content:flex-end';

    var diffAcceptBtn = document.createElement('button');
    diffAcceptBtn.textContent = '\u2713 \u786e\u8ba4\u66f4\u6539';
    diffAcceptBtn.style.cssText = 'background:var(--hdc-accent);color:' + accentFg + ';border:none;border-radius:4px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer';

    var diffRevertBtn = document.createElement('button');
    diffRevertBtn.textContent = '\u21a9 \u64a4\u56de';
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
      diffBtn.textContent = '\u5bf9\u6bd4';
      diffBtn.style.background = 'transparent';
      diffBtn.style.color = 'var(--hdc-accent)';
      hideDiffView();
      var ext = getFileExt(currentFilePath || '');
      renderPreview(newContent, ext || 'md', currentFilePath);
      var label = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : (currentNoteId ? '\u7b14\u8bb0' : '');
      if (label) addMsg('\u2713 \u5df2\u786e\u8ba4\u66f4\u6539: ' + hdcEscape(label), 'sys');
    };

    diffRevertBtn.onclick = function() {
      if (diffOriginal === '') return;
      var revertContent = diffOriginal;
      editorTextarea.value = revertContent;
      _doSave(revertContent);
      _originalContent = revertContent;
      diffOriginal = '';
      diffMode = false;
      diffBtn.textContent = '\u5bf9\u6bd4';
      diffBtn.style.background = 'transparent';
      diffBtn.style.color = 'var(--hdc-accent)';
      hideDiffView();
      var ext = getFileExt(currentFilePath || '');
      renderPreview(revertContent, ext || 'md', currentFilePath);
      var label = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : (currentNoteId ? '\u7b14\u8bb0' : '');
      if (label) addMsg('\u21a9 \u5df2\u64a4\u56de\u66f4\u6539: ' + hdcEscape(label), 'sys');
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

    function renderDiff(diffResult) {
      var html = '';
      for (var i = 0; i < diffResult.length; i++) {
        var d = diffResult[i];
        var lineNum = d.type === 'remove' ? d.oldLine : d.newLine;
        var prefix = d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' ';
        var bgColor = d.type === 'add' ? 'rgba(80,200,120,0.15)' : d.type === 'remove' ? 'rgba(220,80,80,0.15)' : 'transparent';
        var fgColor = d.type === 'add' ? '#6ece6e' : d.type === 'remove' ? '#e06060' : 'var(--hdc-fg)';
        var lineNumStr = (lineNum || '').toString();
        var escapedText = hdcEscape(d.text);
        html += '<div style="background:' + bgColor + ';padding:0 8px;white-space:pre;display:flex;min-height:20px;align-items:center">';
        html += '<span style="color:var(--hdc-fg-dim);min-width:36px;text-align:right;padding-right:8px;flex-shrink:0;font-size:11px">' + lineNumStr + '</span>';
        html += '<span style="color:' + fgColor + ';flex-shrink:0;width:16px">' + hdcEscape(prefix) + '</span>';
        html += '<span style="color:' + fgColor + '">' + escapedText + '</span>';
        html += '</div>';
      }
      return html;
    }

    function showDiffView() {
      if (!diffMode) return;
      var diffResult = computeDiff(diffOriginal, editorTextarea.value);
      diffOverlay.innerHTML = renderDiff(diffResult);
      diffOverlay.style.display = 'block';
      diffActionBar.style.display = 'flex';
      editorPreview.style.display = 'none';
      editorTextarea.style.display = 'none';
    }

    function hideDiffView() {
      diffOverlay.style.display = 'none';
      diffActionBar.style.display = 'none';
      if (isEditMode) {
        editorTextarea.style.display = '';
      } else {
        editorPreview.style.display = '';
      }
    }

    diffBtn.onclick = function() {
      if (diffMode) {
        diffMode = false;
        diffBtn.textContent = '\u5bf9\u6bd4';
        diffBtn.style.background = 'transparent';
        diffBtn.style.color = 'var(--hdc-accent)';
        hideDiffView();
      } else {
        diffMode = true;
        diffOriginal = _originalContent;
        diffBtn.textContent = '\u7f16\u8f91';
        diffBtn.style.background = 'var(--hdc-accent)';
        diffBtn.style.color = '#000';
        showDiffView();
      }
    };

    function refreshEditorWithDiff() {
      if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
      if (currentNoteId) {
        var nid = String(++msgId);
        _rpcCallbacks[nid] = function(result) {
          if (result.error) return;
          var newContent = result.content;
          if (newContent === currentFileContent) return;
          diffOriginal = _originalContent;
          currentFileContent = newContent;
          editorTextarea.value = newContent;
          editorFilename.textContent = editorFilename.textContent.replace(' \u25cf', '');
          if (!isEditMode) {
            renderPreview(newContent, 'md', '');
          }
          if (!diffMode) {
            diffMode = true;
            diffBtn.textContent = '\u7f16\u8f91';
            diffBtn.style.background = 'var(--hdc-accent)';
            diffBtn.style.color = '#000';
            showDiffView();
          } else {
            showDiffView();
          }
          addMsg('\ud83d\udcdd \u7b14\u8bb0\u5df2\u66f4\u65b0', 'sys');
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
        diffOriginal = _originalContent;
        currentFileContent = newContent;
        editorTextarea.value = newContent;
        editorFilename.textContent = editorFilename.textContent.replace(' \u25cf', '');
        if (!isEditMode) {
          var ext = getFileExt(currentFilePath || '');
          renderPreview(newContent, ext, currentFilePath);
        }
        if (!diffMode) {
          diffMode = true;
          diffBtn.textContent = '\u7f16\u8f91';
          diffBtn.style.background = 'var(--hdc-accent)';
          diffBtn.style.color = '#000';
          showDiffView();
        } else {
          showDiffView();
        }
        addMsg('\ud83d\udcc4 \u6587\u4ef6\u5df2\u66f4\u65b0\uff1a' + hdcEscape(currentFilePath.split(/[\\/]/).pop()), 'sys');
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'fs.read_file', params: { path: currentFilePath } }));
    }
    _refreshEditorFn = refreshEditorWithDiff;

    var insertBtn = document.createElement('button');
    insertBtn.textContent = '\u2193 \u63d2\u5165\u5230\u5bf9\u8bdd';
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
          fname = editorFilename.textContent.replace(' \u25cf', '').trim();
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
          startLine = 1;
          endLine = sel.split('\n').length;
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
