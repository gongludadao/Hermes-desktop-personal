// ── Obsidian Vault Module ──
    var _obsVaultActive = false;
    var obsTreeContainers = {};
    var obsRoot = null;
    var obsOpen = true;

    function renderObsFileItems(items, container, parentPath, depth) {
      depth = depth || 0;
      container.innerHTML = '';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var pad = 8 + depth * 14;
        var row = document.createElement('div');
        row.setAttribute('data-path', item.path);
        row.style.cssText = 'padding:3px 8px 3px ' + pad + 'px;cursor:pointer;display:flex;align-items:center;gap:4px;color:var(--hdc-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;line-height:1.5';
        row.onmouseenter = function() { if (!this._selected) this.style.background = 'var(--hdc-muted)'; };
        row.onmouseleave = function() { if (!this._selected) this.style.background = 'transparent'; };

        var icon = item.is_dir ? '\ud83d\udcc1' : '\ud83d\udcc4';
        var iconSpan = document.createElement('span');
        iconSpan.textContent = icon;
        iconSpan.style.cssText = 'flex-shrink:0;font-size:13px;pointer-events:none';
        row.appendChild(iconSpan);

        var nameSpan = document.createElement('span');
        nameSpan.textContent = item.name;
        nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;pointer-events:none';
        row.appendChild(nameSpan);

        (function(path, name, isDir, el, iconEl) {
          el.oncontextmenu = function(e) {
            e.preventDefault();
            e.stopPropagation();
            wsContextFile = path;
            wsContextDir = isDir ? path : _dirOf(path);
            if (wsPathTip) { wsPathTip.textContent = wsContextDir; wsPathTip.title = wsContextDir; }
            var x = Math.min(e.clientX, window.innerWidth - 145);
            var y = Math.min(e.clientY, window.innerHeight - 120);
            wsContextMenu.style.left = x + 'px';
            wsContextMenu.style.top = y + 'px';
            wsContextMenu.style.display = '';
          };
          if (isDir) {
            var expanded = false;
            var childContainer = document.createElement('div');
            childContainer.style.display = 'none';
            obsTreeContainers[path] = { container: childContainer, depth: depth + 1 };
            el.onclick = function(e) {
              e.stopPropagation();
              wsContextDir = path;
              if (wsPathTip) { wsPathTip.textContent = path; wsPathTip.title = path; }
              expanded = !expanded;
              if (expanded) {
                childContainer.style.display = 'block';
                iconEl.textContent = '\ud83d\udcc2';
                if (childContainer.children.length === 0) {
                  loadObsDir(path, childContainer, depth + 1);
                }
              } else {
                childContainer.style.display = 'none';
                iconEl.textContent = '\ud83d\udcc1';
              }
            };
            container.appendChild(el);
            container.appendChild(childContainer);
          } else {
            el.onclick = function(e) {
              e.stopPropagation();
              openObsNote(path, name);
            };
            container.appendChild(el);
          }
        })(item.path, item.name, item.is_dir, row, iconSpan);
      }
    }

    function loadObsDir(dirPath, container, depth, callback) {
      depth = depth || 0;
      var lid = String(++msgId);
      container.innerHTML = '<div style="padding:8px 14px;color:var(--hdc-fg-dim)">加载中...</div>';
      _rpcCallbacks[lid] = function(result) {
        if (result.error) {
          container.innerHTML = '<div style="padding:8px 14px;color:#f66">错误: ' + result.error.message + '</div>';
          if (callback) callback();
          return;
        }
        renderObsFileItems(result.items || [], container, dirPath, depth);
        if (callback) callback();
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: lid, method: 'obsidian.list_files', params: { path: dirPath } }));
    }

    function openObsNote(fp, name) {
      // 复用项目模块的 openFile，直接用 fs.read_file 读取
      openFile(fp, name);
    }

    function toggleObsSection() {
      if (_obsVaultActive) {
        obsOpen = !obsOpen;
        wsObsBody.style.display = obsOpen ? 'flex' : 'none';
      } else {
        activateObsVault();
      }
    }

    function activateObsVault() {
      _obsVaultActive = true;
      wsObsHeader.style.display = 'flex';
      toggleSection(wsObsBody, wsObsArrow);
      wsObsTree.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u52a0\u8f7d\u4e2d...</div>';
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (result.error || !result.path) {
          wsObsTree.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u672a\u914d\u7f6e\u4efb\u4f55 Obsidian \u4ed3\u5e93<br><br>\u70b9\u51fb [\u5207\u6362] \u9009\u6291\u4ed3\u5e93\u8def\u5f84</div>';
          return;
        }
        obsRoot = result.path;
        // 设置全局变量和 localStorage，供自动引用知识库使用
        window._obsidianVaultPath = result.path;
        try { localStorage.setItem('hdc_obsidian_vault', result.path); } catch(e) {}
        // 自动启用自动引用知识库功能
        if (typeof _autoKbEnabled !== 'undefined') {
          _autoKbEnabled = true;
          var autoKbCheck = document.getElementById('hdc-auto-kb-check');
          if (autoKbCheck) autoKbCheck.checked = true;
        }
        loadObsDir(obsRoot, wsObsTree, 0);
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'obsidian.get_active' }));
    }

    function selectObsVault() {
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (result.error || !result.path) return;
        var sid = String(++msgId);
        _rpcCallbacks[sid] = function(resp) {
          if (resp.error) {
            addMsg('\u8bbe\u7f6e\u4ed3\u5e93\u5931\u8d25: ' + (resp.error ? resp.error.message : ''), 'err');
            return;
          }
          addMsg('\u5df2\u5207\u6362\u5230\u4ed3\u5e93: ' + result.path, 'ok');
          activateObsVault();
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: sid, method: 'obsidian.set_vault', params: { path: result.path } }));
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.select_folder' }));
    }

    // 初始化函数：在 DOM 元素定义后调用
    function initObsVaultEvents() {
      if (wsObsHeader) {
        wsObsHeader.onclick = function(e) {
          e.stopPropagation();
          toggleObsSection();
        };
      }
      if (wsObsSwitchVault) {
        wsObsSwitchVault.onclick = function(e) {
          e.stopPropagation();
          selectObsVault();
        };
      }
      // 不在这里自动激活，等 WebSocket 连接后再激活
    }
    
    // WebSocket 连接后自动激活 Obsidian Vault
    function autoActivateObsVault() {
      if (!_obsVaultActive && ws && ws.readyState === WebSocket.OPEN) {
        activateObsVault();
      }
    }