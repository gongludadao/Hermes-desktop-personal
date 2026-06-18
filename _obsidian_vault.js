// ── Obsidian Vault Module ──
    var _obsVaultActive = false;
    var obsTreeContainers = {};
    var obsRoot = null;
    var obsOpen = false;
    var _embeddingApiKey = '';
    var _embeddingBaseUrl = '';
    var _embeddingModel = 'text-embedding-3-small';

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
      wsObsBody.style.display = 'none';
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
        // 使用统一的 renderTree + loadDir，带自定义 containers 和 RPC 方法
        obsTreeContainers = {};
        loadDir(obsRoot, wsObsTree, 0, null, 'obsidian.list_files', obsTreeContainers);
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
      if (wsObsRefresh) {
        wsObsRefresh.onclick = function(e) {
          e.stopPropagation();
          if (obsRoot && wsObsTree) {
            _refreshVaultTree();
            console.log('[ObsVault] 手动刷新');
          }
        };
      }
      // Obsidian 树空白区域右键菜单 → 使用统一的 wsContextMenu
      if (wsObsTree) {
        wsObsTree.oncontextmenu = function(e) {
          // 如果点击的是文件/文件夹行，不处理（由行自己处理）
          if (e.target.closest('[data-path]')) return;
          e.preventDefault();
          e.stopPropagation();
          wsContextFile = null;
          wsContextDir = obsRoot;
          wsContextSource = 'obsidian';
          if (wsPathTip) { wsPathTip.textContent = obsRoot; wsPathTip.title = obsRoot; }
          var x = Math.min(e.clientX, window.innerWidth - 145);
          var y = Math.min(e.clientY, window.innerHeight - 120);
          wsContextMenu.style.left = x + 'px';
          wsContextMenu.style.top = y + 'px';
          wsContextMenu.style.display = '';
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
    
    // ── 文件变更检测 ────────────────────────────────────────────────
    // 后端 watchdog 检测到变化后，通过 WebSocket 推送通知。收到通知就刷新。
    function _refreshVaultTree() {
      if (!obsRoot || !wsObsTree) return;
      // 保存当前展开的路径
      var expandedPaths = [];
      for (var p in obsTreeContainers) {
        if (obsTreeContainers[p].container && obsTreeContainers[p].container.style.display !== 'none') {
          expandedPaths.push(p);
        }
      }
      console.log('[ObsVault] saving expanded paths:', expandedPaths.length, expandedPaths);
      var tempDiv = document.createElement('div');
      obsTreeContainers = {};
      var lid = String(++msgId);
      _rpcCallbacks[lid] = function(result) {
        if (result.error) return;
        renderTree(result.items || [], tempDiv, obsRoot, 0, obsTreeContainers, 'obsidian.list_files');
        wsObsTree.replaceChildren.apply(wsObsTree, tempDiv.children);
        console.log('[ObsVault] tree rendered, restoring expanded paths...');
        // 恢复展开状态（用离线加载避免闪烁）
        var idx = 0;
        function _findObsRow(p) {
          var all = wsObsTree.querySelectorAll('[data-path]');
          for (var i = 0; i < all.length; i++) {
            if (all[i].getAttribute('data-path') === p) return all[i];
          }
          return null;
        }
        function expandNext() {
          if (idx >= expandedPaths.length) {
            console.log('[ObsVault] all paths restored');
            return;
          }
          var tp = expandedPaths[idx++];
          var row = _findObsRow(tp);
          var entry = obsTreeContainers[tp];
          console.log('[ObsVault] restoring path:', tp, 'row found:', !!row, 'entry found:', !!entry);
          if (!row || !entry) { expandNext(); return; }
          if (entry.container.style.display !== 'none') { expandNext(); return; }
          entry.container.style.display = 'block';
          var iconSpan = row.querySelector('span');
          if (iconSpan) iconSpan.textContent = '\ud83d\udcc2';
          if (entry.container.children.length === 0) {
            var sid = String(++msgId);
            _rpcCallbacks[sid] = function(r2) {
              if (!r2.error) {
                var tc = document.createElement('div');
                renderTree(r2.items || [], tc, tp, entry.depth, obsTreeContainers, 'obsidian.list_files');
                entry.container.replaceChildren.apply(entry.container, tc.children);
              }
              expandNext();
            };
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: sid, method: 'obsidian.list_files', params: { path: tp } }));
          } else {
            expandNext();
          }
        }
        expandNext();
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: lid, method: 'obsidian.list_files', params: { path: obsRoot } }));
    }
    
    // 导出到全局，供 _chat_overlay.js 的 ws.onopen 调用
    window.autoActivateObsVault = autoActivateObsVault;
    window._refreshVaultTree = _refreshVaultTree;
    // 通过事件总线注册树刷新（无防抖）
    window._registerVaultHandler('tree', function() { _refreshVaultTree(); }, 0);
    console.log('[ObsVault] autoActivateObsVault / _refreshVaultTree exported to window');
