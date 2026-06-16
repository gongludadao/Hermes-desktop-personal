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
      console.log('[ObsVault] activateObsVault called');
      wsObsHeader.style.display = 'flex';
      toggleSection(wsObsBody, wsObsArrow);
      wsObsTree.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">[ObsVault] 正在获取 vault 路径...</div>';
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        console.log('[ObsVault] obsidian.get_active result:', result);
        if (result.error || !result.path) {
          console.log('[ObsVault] no vault path found');
          wsObsTree.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">[ObsVault] 未配置任何 Obsidian 仓库<br><br>点击 [切换] 选择仓库路径</div>';
          return;
        }
        // 只有成功获取路径后才设置为激活状态
        _obsVaultActive = true;
        obsRoot = result.path;
        console.log('[ObsVault] vault activated:', result.path);
        // 设置全局变量和 localStorage，供自动引用知识库使用
        window._obsidianVaultPath = result.path;
        try { localStorage.setItem('hdc_obsidian_vault', result.path); } catch(e) {}
        // 自动启用自动引用知识库功能
        window._autoKbEnabled = true;
        console.log('[ObsVault] window._autoKbEnabled set to true');
        var autoKbCheck = document.getElementById('hdc-auto-kb-check');
        if (autoKbCheck) autoKbCheck.checked = true;
        // 触发向量索引构建（如果函数存在）
        if (typeof window.buildEmbeddingIndex === 'function') {
          console.log('[ObsVault] 开始构建向量索引...');
          window.buildEmbeddingIndex(function(success) {
            console.log('[ObsVault] 向量索引构建结果:', success);
          });
        }
        loadObsDir(obsRoot, wsObsTree, 0);
      };
      console.log('[ObsVault] sending obsidian.get_active request');
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
      console.log('[ObsVault] autoActivateObsVault called, _obsVaultActive:', _obsVaultActive, 'ws.readyState:', ws ? ws.readyState : 'no ws');
      if (!_obsVaultActive && ws && ws.readyState === WebSocket.OPEN) {
        console.log('[ObsVault] calling activateObsVault...');
        activateObsVault();
      } else {
        console.log('[ObsVault] skipping activateObsVault:', _obsVaultActive ? 'already active' : 'ws not ready');
      }
    }
    
    // 定期检查 vault 路径是否变化（每5秒检查一次）
    var _vaultCheckTimer = null;
    function startVaultPathMonitor() {
      if (_vaultCheckTimer) return; // 已经启动了
      _vaultCheckTimer = setInterval(function() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        var fid = String(++msgId);
        _rpcCallbacks[fid] = function(result) {
          if (result.error || !result.path) return;
          var newPath = result.path;
          var oldPath = window._obsidianVaultPath || localStorage.getItem('hdc_obsidian_vault');
          if (newPath !== oldPath) {
            console.log('[ObsVault] vault path changed:', oldPath, '->', newPath);
            // 更新全局变量和 localStorage
            window._obsidianVaultPath = newPath;
            try { localStorage.setItem('hdc_obsidian_vault', newPath); } catch(e) {}
            // 更新状态栏显示
            if (typeof statusEl !== 'undefined' && statusEl) {
              var kbStatus = window._autoKbEnabled ? ('[AutoKB] vault: ' + newPath) : '';
              statusEl.textContent = '就绪' + (kbStatus ? ' | ' + kbStatus : '');
            }
            // 重新加载 vault 目录
            if (wsObsTree) {
              wsObsTree.innerHTML = '';
              loadObsDir(newPath, wsObsTree, 0);
            }
          }
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'obsidian.get_active' }));
      }, 5000);
      console.log('[ObsVault] vault path monitor started');
    }
    
    // 导出到全局，供 _chat_overlay.js 的 ws.onopen 调用
    window.autoActivateObsVault = autoActivateObsVault;
    window.startVaultPathMonitor = startVaultPathMonitor;
    console.log('[ObsVault] autoActivateObsVault exported to window');