// ── File Manager Module ──
    var projectTabs = [];  // [{path, name, expandedPaths, scrollPos}]
    var activeTabIndex = -1;
    var wsContextSource = 'project';  // 'project' 或 'obsidian'，右键菜单来源

    function _getProjectIndex(path) {
      for (var i = 0; i < projectTabs.length; i++) {
        if (projectTabs[i].path === path) return i;
      }
      return -1;
    }

    function renderProjectTabs() {
      if (!wsProjectTabs) return;
      wsProjectTabs.innerHTML = '';
      if (projectTabs.length <= 1) {
        wsProjectTabs.style.display = 'none';
        return;
      }
      wsProjectTabs.style.display = 'flex';
      for (var i = 0; i < projectTabs.length; i++) {
        (function(idx) {
          var tab = projectTabs[idx];
          var isActive = idx === activeTabIndex;
          var tabEl = document.createElement('div');
          tabEl.style.cssText = 'display:flex;align-items:center;gap:2px;padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;max-width:120px;flex-shrink:0;border-bottom:2px solid ' + (isActive ? 'var(--hdc-accent)' : 'transparent') + ';color:' + (isActive ? 'var(--hdc-fg)' : 'var(--hdc-fg-dim)') + ';background:' + (isActive ? 'var(--hdc-muted)' : 'transparent');
          var nameSpan = document.createElement('span');
          nameSpan.textContent = tab.name;
          nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
          tabEl.appendChild(nameSpan);
          if (projectTabs.length > 1) {
            var closeBtn = document.createElement('span');
            closeBtn.textContent = '\u2715';
            closeBtn.style.cssText = 'flex-shrink:0;font-size:9px;margin-left:2px;color:var(--hdc-fg-dim);padding:1px 2px;border-radius:2px;cursor:pointer';
            closeBtn.onclick = function(e) {
              e.stopPropagation();
              closeProjectTab(idx);
            };
            tabEl.appendChild(closeBtn);
          }
          tabEl.onclick = function() {
            switchToTab(idx);
          };
          wsProjectTabs.appendChild(tabEl);
        })(i);
      }
    }

    function switchToTab(idx) {
      if (idx < 0 || idx >= projectTabs.length || idx === activeTabIndex) return;
      // save current tab state
      _saveCurrentTabState();
      activeTabIndex = idx;
      var tab = projectTabs[idx];
      projectRoot = tab.path;
      wsProjectName.textContent = tab.name;
      wsPathTip.textContent = tab.path;
      renderProjectTabs();
      // restore tree
      wsTree.innerHTML = '';
      _treeContainers = {};
      loadDir(projectRoot, wsTree, 0, function() {
        if (tab.expandedPaths && tab.expandedPaths.length > 0) {
          _expandPaths(tab.expandedPaths);
        }
      });
      wsProjectBody.style.display = 'flex';
      wsProjectArrow.style.transform = 'rotate(90deg)';
      wsPathTip.style.display = 'block';
    }

    function _saveCurrentTabState() {
      if (activeTabIndex < 0 || activeTabIndex >= projectTabs.length) return;
      var expandedPaths = [];
      for (var p in _treeContainers) {
        if (_treeContainers[p].container && _treeContainers[p].container.style.display !== 'none') {
          expandedPaths.push(p);
        }
      }
      projectTabs[activeTabIndex].expandedPaths = expandedPaths;
    }

    function _expandPaths(paths) {
      if (!paths || paths.length === 0) return;
      var idx = 0;
      function expandNext() {
        if (idx >= paths.length) return;
        var targetPath = paths[idx++];
        var row = _findRowByPath(targetPath);
        var entry = _treeContainers[targetPath];
        if (!row || !entry || entry.container.style.display !== 'none') {
          expandNext();
          return;
        }
        // 直接展开，不经过 onclick 处理器（避免 "加载中..." 闪烁）
        entry.container.style.display = 'block';
        var iconSpan = row.querySelector('span');
        if (iconSpan) iconSpan.textContent = '\ud83d\udcc2';
        if (entry.container.children.length === 0) {
          // 静默加载：用临时容器建好子树再一次性移入
          var lid = String(++msgId);
          _rpcCallbacks[lid] = function(result) {
             if (!result.error) {
               var tc = document.createElement('div');
               renderTree(result.items || [], tc, targetPath, entry.depth);
               entry.container.replaceChildren.apply(entry.container, tc.children);
             }
             expandNext();
          };
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: lid, method: 'fs.list_dir', params: { path: targetPath } }));
        } else {
          expandNext();
        }
      }
      expandNext();
    }

    function closeProjectTab(idx) {
      if (projectTabs.length <= 1) return;
      projectTabs.splice(idx, 1);
      if (activeTabIndex === idx) {
        // Switch to nearest tab
        activeTabIndex = Math.min(idx, projectTabs.length - 1);
        var tab = projectTabs[activeTabIndex];
        projectRoot = tab.path;
        wsProjectName.textContent = tab.name;
        wsPathTip.textContent = tab.path;
        renderProjectTabs();
        wsTree.innerHTML = '';
        _treeContainers = {};
        loadDir(projectRoot, wsTree, 0, function() {
          if (tab.expandedPaths && tab.expandedPaths.length > 0) {
            _expandPaths(tab.expandedPaths);
          }
        });
        wsProjectBody.style.display = 'flex';
        wsProjectArrow.style.transform = 'rotate(90deg)';
        wsPathTip.style.display = 'block';
      } else if (activeTabIndex > idx) {
        activeTabIndex--;
        renderProjectTabs();
      } else {
        renderProjectTabs();
      }
    }

    function openProjectTab(path) {
      var name = path.split(/[\\/]/).pop();
      var existing = _getProjectIndex(path);
      if (existing >= 0) {
        switchToTab(existing);
        return;
      }
      // save current tab state
      _saveCurrentTabState();
      projectTabs.push({ path: path, name: name, expandedPaths: [] });
      activeTabIndex = projectTabs.length - 1;
      projectRoot = path;
      wsProjectName.textContent = name;
      wsPathTip.textContent = path;
      renderProjectTabs();
      wsTree.innerHTML = '';
      _treeContainers = {};
      wsProjectBody.style.display = 'flex';
      wsProjectArrow.style.transform = 'rotate(90deg)';
      wsPathTip.style.display = 'block';
      loadDir(projectRoot, wsTree);
    }

    wsProjectHeader.onclick = function(e) {
      if (e.target.closest('#hdc-ws-switch-project')) return;
      if (!projectRoot) { selectProject(); return; }
      var isExpanded = wsProjectBody.style.display === 'flex';
      toggleSection(wsProjectBody, wsProjectArrow);
      // 只在展开状态显示地址
      if (isExpanded) {
        wsPathTip.style.display = 'none';
      } else {
        wsPathTip.style.display = 'block';
      }
    };

    wsSwitchProject.onclick = function(e) {
      e.stopPropagation();
      selectProject();
    };

    // 空白区域右键菜单
    wsTree.oncontextmenu = function(e) {
      // 如果点击的是文件/文件夹行，不处理（由行自己处理）
      if (e.target.closest('[data-path]')) return;
      e.preventDefault();
      e.stopPropagation();
      wsContextFile = null;
      wsContextDir = projectRoot;
      wsContextSource = 'project';
      if (wsPathTip) { wsPathTip.textContent = projectRoot; wsPathTip.title = projectRoot; }
      var x = Math.min(e.clientX, window.innerWidth - 145);
      var y = Math.min(e.clientY, window.innerHeight - 120);
      wsContextMenu.style.left = x + 'px';
      wsContextMenu.style.top = y + 'px';
      wsContextMenu.style.display = '';
    };

    wsContextMenu.querySelectorAll('div[data-action]').forEach(function(el) {
      el.onclick = function(e) {
        e.stopPropagation();
        var action = el.getAttribute('data-action');
        var fp = wsContextFile;
        wsContextMenu.style.display = 'none';
        if (action === 'new-file') {
          promptNewFile(wsContextDir || projectRoot);
          return;
        }
        if (action === 'new-folder') {
          promptNewFolder(wsContextDir || projectRoot);
          return;
        }
        if (action === 'select-files') {
          selectMode = !selectMode;
          return;
        }
        if (!fp) return;
        if (action === 'file-send-ai') {
          // 发送文件到AI
          var fileName = fp.split(/[\\/]/).pop() || fp;
          var ext = fileName.split('.').pop().toLowerCase();
          var langMap = {
            'js': 'javascript', 'ts': 'typescript', 'py': 'python', 'rb': 'ruby',
            'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c',
            'cs': 'csharp', 'go': 'go', 'rs': 'rust', 'php': 'php',
            'html': 'html', 'css': 'css', 'scss': 'scss', 'less': 'less',
            'json': 'json', 'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
            'md': 'markdown', 'txt': 'text', 'sh': 'bash', 'bash': 'bash',
            'sql': 'sql', 'vue': 'vue', 'jsx': 'jsx', 'tsx': 'tsx'
          };
          var lang = langMap[ext] || ext;
          attachToAI({
            title: fileName,
            icon: '\ud83d\udcc4',
            lang: lang,
            filePath: fp
          });
          return;
        }
        if (action === 'copy-path') {
          navigator.clipboard.writeText(fp).catch(function() {});
          return;
        }
        if (action === 'rename') promptRename(fp);
        if (action === 'delete') promptDelete(fp);
      };
    });

    function selectProject() {
      var fid = String(++msgId);
      _rpcCallbacks[fid] = function(result) {
        if (result.error) { return; }
        if (!result.path) return;
        openProjectTab(result.path);
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.select_folder' }));
    }

    // Navigate to a path from chat link click - opens sidebar, opens/switches project tab, expands to path
    function navigateToPath(fp, name) {
      // Open workspace sidebar if not open
      if (!wsOpen) toggleWorkspace();
      // Check if path is under an existing project tab
      var parentTabIdx = -1;
      for (var i = 0; i < projectTabs.length; i++) {
        if (_isInDir(projectTabs[i].path, fp) || projectTabs[i].path === fp) {
          parentTabIdx = i;
          break;
        }
      }
      // Determine if it's a file (has extension) to open in preview
      var baseName = fp.split(/[\\/]/).pop() || '';
      var hasExt = baseName.indexOf('.') > 0;
      if (parentTabIdx >= 0) {
        // Switch to that tab and expand to path
        if (parentTabIdx !== activeTabIndex) {
          switchToTab(parentTabIdx);
        }
        _expandToPath(fp);
        // Also open file in preview if it looks like a file
        if (hasExt) openFile(fp, name);
      } else {
        // No project tab contains this path - ask server to resolve the folder
        var rid = String(++msgId);
        _rpcCallbacks[rid] = function(result) {
          if (result.error || !result.path) {
            // Fallback: just open the file in preview
            openFile(fp, name);
            return;
          }
          if (result.is_dir) {
            openProjectTab(result.path);
            _expandToPath(fp);
          } else {
            // It's a file - open its parent dir as project, expand, and open file in preview
            var dirPath = _dirOf(result.path);
            if (dirPath) {
              openProjectTab(dirPath);
              _expandToPath(fp);
            }
            openFile(fp, name);
          }
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'fs.stat', params: { path: fp } }));
      }
    }

    function _expandToPath(fp) {
      // If path is a file, find its parent dir; if dir, expand to it
      // We need to expand all parent directories in the tree to reveal this path
      var parts = fp.replace(/\\/g, '/').split('/');
      var pathsToExpand = [];
      var current = '';
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        current = current ? current + '/' + parts[i] : parts[i];
        var winPath = current.replace(/\//g, '\\');
        // Skip the project root (already loaded)
        if (projectRoot && winPath === projectRoot.replace(/\\/g, '/').replace(/\//g, '\\')) continue;
        if (projectRoot && _isInDir(projectRoot, winPath)) {
          pathsToExpand.push(winPath);
        }
      }
      // Expand directories sequentially
      var expandIdx = 0;
      function expandNextDir() {
        if (expandIdx >= pathsToExpand.length) {
          // After expanding, try to scroll to and highlight the target
          var targetRow = _findRowByPath(fp);
          if (targetRow) {
            targetRow.scrollIntoView({ block: 'center' });
            targetRow.style.background = 'var(--hdc-accent)';
            targetRow.style.color = '#000';
            setTimeout(function() {
              targetRow.style.background = '';
              targetRow.style.color = '';
            }, 2000);
          }
          return;
        }
        var dirToExpand = pathsToExpand[expandIdx++];
        var row = _findRowByPath(dirToExpand);
        if (row) {
          var entry = _treeContainers[dirToExpand];
          if (entry && entry.container.style.display === 'none') {
            row.click();
            // Wait for load
            if (entry.container.children.length === 0) {
              setTimeout(expandNextDir, 150);
              return;
            }
          }
        }
        expandNextDir();
      }
      expandNextDir();
    }

    function loadDir(dirPath, container, depth, callback, rpcMethod, ctn) {
      rpcMethod = rpcMethod || 'fs.list_dir';
      depth = depth || 0;
      var lid = String(++msgId);
      container.innerHTML = '<div style="padding:8px 14px;color:var(--hdc-fg-dim)">\u52a0\u8f7d\u4e2d...</div>';
      _rpcCallbacks[lid] = function(result) {
        if (result.error) {
          container.innerHTML = '<div style="padding:8px 14px;color:#f66">\u9519\u8bef: ' + result.error.message + '</div>';
          if (callback) callback();
          return;
        }
        renderTree(result.items || [], container, dirPath, depth, ctn, rpcMethod);
        if (callback) callback();
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: lid, method: rpcMethod, params: { path: dirPath } }));
    }

    function renderTree(items, container, parentPath, depth, _ctn, _rpc) {
      depth = depth || 0;
      _ctn = _ctn || _treeContainers;
      _rpc = _rpc || 'fs.list_dir';
      container.innerHTML = '';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var pad = 8 + depth * 14;
        var row = document.createElement('div');
        row.draggable = true;
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
          el.ondragstart = function(e) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', path);
            el.style.opacity = '0.5';
          };
          el.ondragend = function(e) {
            el.style.opacity = '1';
          };
          el.oncontextmenu = function(e) {
            e.preventDefault();
            e.stopPropagation();
            wsContextFile = path;
            wsContextDir = isDir ? path : _dirOf(path);
            wsContextSource = (_ctn === _treeContainers) ? 'project' : 'obsidian';
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
            _ctn[path] = { container: childContainer, depth: depth + 1 };
            el.ondragover = function(e) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              el.style.background = 'var(--hdc-accent)';
              el.style.outline = '1px dashed var(--hdc-accent)';
            };
            el.ondragleave = function(e) {
              if (!el._selected) el.style.background = 'transparent';
              el.style.outline = 'none';
            };
            el.ondrop = function(e) {
              e.preventDefault();
              e.stopPropagation();
              if (!el._selected) el.style.background = 'transparent';
              el.style.outline = 'none';
              var srcPath = e.dataTransfer.getData('text/plain');
              if (!srcPath || srcPath === path) return;
              var srcName = srcPath.split(/[\\/]/).pop();
              var dstPath = path.replace(/\\/g, '/') + '/' + srcName;
              dstPath = dstPath.replace(/\//g, '\\');
              var fid = String(++msgId);
              _rpcCallbacks[fid] = function(result) {
                if (result.error) { addMsg('\u79fb\u52a8\u5931\u8d25: ' + result.error.message, 'err'); return; }
                refreshAllTrees();
              };
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.move', params: { src: srcPath, dst: dstPath } }));
            };
            el.onclick = function(e) {
              e.stopPropagation();
              wsContextDir = path;
              if (wsPathTip) { wsPathTip.textContent = path; wsPathTip.title = path; }
              // 选择模式下，点击文件夹选中/取消选中
              if (selectMode) {
                toggleFileSelection(path, name, el, true);
                return;
              }
              expanded = !expanded;
              if (expanded) {
                childContainer.style.display = 'block';
                iconEl.textContent = '\ud83d\udcc2';
                if (childContainer.children.length === 0) {
                  loadDir(path, childContainer, depth + 1, null, _rpc);
                }
              } else {
                childContainer.style.display = 'none';
                iconEl.textContent = '\ud83d\udcc1';
              }
            };
            container.appendChild(el);
            container.appendChild(childContainer);
          } else {
            el.ondragover = function(e) { e.preventDefault(); };
            el.ondrop = function(e) {
              e.preventDefault();
              e.stopPropagation();
              var srcPath = e.dataTransfer.getData('text/plain');
              if (!srcPath || srcPath === path) return;
              var srcName = srcPath.split(/[\\/]/).pop();
              var parentDir = _dirOf(path);
              var dstPath = parentDir.replace(/\\/g, '/') + '/' + srcName;
              dstPath = dstPath.replace(/\//g, '\\');
              if (dstPath === srcPath) return;
              var fid = String(++msgId);
              _rpcCallbacks[fid] = function(result) {
                if (result.error) { addMsg('\u79fb\u52a8\u5931\u8d25: ' + result.error.message, 'err'); return; }
                var srcParent = _dirOf(srcPath);
                if (srcParent !== parentDir) {
                  _cleanupTreeEntry(srcPath);
                }
                var ref2 = _treeContainers[parentDir];
                if (ref2) {
                  var expandedSubs = [];
                  for (var p in _treeContainers) {
                    if (_treeContainers[p].container.style.display !== 'none' && p !== parentDir && _dirOf(p) === parentDir) {
                      expandedSubs.push(p);
                    }
                  }
                  loadDir(parentDir, ref2.container, ref2.depth, function() {
                    for (var i = 0; i < expandedSubs.length; i++) {
                      var r = _findRowByPath(expandedSubs[i]);
                      if (r) r.click();
                    }
                  });
                }
                refreshAllTrees();
              };
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.move', params: { src: srcPath, dst: dstPath } }));
            };
            el.onclick = function(e) {
              e.stopPropagation();
              wsContextDir = _dirOf(path);
              if (wsPathTip) { wsPathTip.textContent = wsContextDir; wsPathTip.title = wsContextDir; }
              if (selectMode) {
                toggleFileSelection(path, name, el, false);
              } else {
                openFile(path, name);
              }
            };
            container.appendChild(el);
          }
        })(item.path, item.name, item.is_dir, row, iconSpan);
      }
    }

    function _dirOf(filePath) {
      var s = filePath.replace(/\\/g, '/');
      var i = s.lastIndexOf('/');
      return i >= 0 ? s.slice(0, i).replace(/\//g, '\\') : '';
    }

    function _isInDir(parentPath, childPath) {
      var a = parentPath.replace(/\\/g, '/').replace(/\/+$/, '');
      var b = childPath.replace(/\\/g, '/');
      return b.indexOf(a + '/') === 0;
    }

    function _findRowByPath(p) {
      var all = wsTree.querySelectorAll('[data-path]');
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('data-path') === p) return all[i];
      }
      return null;
    }

    function _cleanupTreeEntry(treePath) {
      var prefix = treePath.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
      var keysToDelete = [];
      for (var tp in _treeContainers) {
        var normalized = tp.replace(/\\/g, '/');
        if (normalized === treePath.replace(/\\/g, '/') || normalized.indexOf(prefix) === 0) {
          keysToDelete.push(tp);
        }
      }
      for (var k = 0; k < keysToDelete.length; k++) {
        var tp = keysToDelete[k];
        var entry = _treeContainers[tp];
        if (entry && entry.container && entry.container.parentNode) {
          entry.container.parentNode.removeChild(entry.container);
        }
        var row = _findRowByPath(tp);
        if (row && row.parentNode) {
          row.parentNode.removeChild(row);
        }
        delete _treeContainers[tp];
      }
    }

    var _refreshPending = false;

    function refreshTree() {
      if (!projectRoot) {
        console.log('[Project] projectRoot is null, cannot refresh');
        return;
      }
      if (_refreshPending) {
        console.log('[Project] refresh already pending, skip');
        return;
      }
      _refreshPending = true;
      // 直接从 _treeContainers 捕获当前展开状态
      var expandedPaths = [];
      for (var p in _treeContainers) {
        if (_treeContainers[p].container && _treeContainers[p].container.style.display !== 'none') {
          expandedPaths.push(p);
        }
      }
      console.log('[Project] refreshTree captured ' + expandedPaths.length + ' expanded paths');
      // 先用临时容器建好新树，再一次性替换到 wsTree，避免闪烁
      var lid = String(++msgId);
      _rpcCallbacks[lid] = function(result) {
        _refreshPending = false;
        if (result.error) {
          console.log('[Project] refreshTree error:', result.error.message);
          return;
        }
        var tempDiv = document.createElement('div');
        _treeContainers = {};
        renderTree(result.items || [], tempDiv, projectRoot, 0);
        // 用 replaceChildren 一次性替换，避免清除→填充之间的空白
        wsTree.replaceChildren.apply(wsTree, tempDiv.children);
        _expandPaths(expandedPaths);
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: lid, method: 'fs.list_dir', params: { path: projectRoot } }));
    }
    window.refreshProjectTree = refreshTree;

    function refreshAllTrees() {
      refreshTree();
      if (typeof window._refreshVaultTree === 'function') {
        window._refreshVaultTree();
      }
    }

    function promptNewFile(parentDir) {
      showInputDialog('\u8f93\u5165\u65b0\u6587\u4ef6\u540d\uff1a', '', function(name) {
        if (!name || !name.trim()) return;
        var fid = String(++msgId);
        var fp = parentDir.replace(/\\/g, '/') + '/' + name.replace(/[\\/]/g, '');
        fp = fp.replace(/\//g, '\\');
        _rpcCallbacks[fid] = function(result) {
          if (result.error) { addMsg('\u65b0\u5efa\u6587\u4ef6\u5931\u8d25: ' + result.error.message, 'err'); return; }
          refreshAllTrees();
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.create_file', params: { path: fp } }));
      });
    }

    function promptNewFolder(parentDir) {
      showInputDialog('\u8f93\u5165\u65b0\u6587\u4ef6\u5939\u540d\uff1a', '', function(name) {
        if (!name || !name.trim()) return;
        var fid = String(++msgId);
        var fp = parentDir.replace(/\\/g, '/') + '/' + name.replace(/[\\/]/g, '');
        fp = fp.replace(/\//g, '\\');
        _rpcCallbacks[fid] = function(result) {
          if (result.error) { addMsg('\u65b0\u5efa\u6587\u4ef6\u5939\u5931\u8d25: ' + result.error.message, 'err'); return; }
          refreshAllTrees();
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.create_folder', params: { path: fp } }));
      });
    }

    function promptRename(filePath) {
      var oldName = filePath.split(/[\\/]/).pop();
      showInputDialog('\u91cd\u547d\u540d: ' + oldName, oldName, function(newName) {
        if (!newName || !newName.trim() || newName === oldName) return;
        var fid = String(++msgId);
        _rpcCallbacks[fid] = function(result) {
          if (result.error) { addMsg('\u91cd\u547d\u540d\u5931\u8d25: ' + result.error.message, 'err'); return; }
          if (currentFilePath === filePath) {
            var nameParts = result.path.split(/[\\/]/);
            updatePreviewMeta({ filePath: result.path, title: nameParts[nameParts.length - 1] });
          }
          refreshAllTrees();
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.rename', params: { path: filePath, new_name: newName } }));
      });
    }

    function promptDelete(filePath) {
      var name = filePath.split(/[\\/]/).pop();
      showConfirmDialog('\u786e\u5b9a\u5220\u9664 \u201c' + name + '\u201d \uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002', function(confirmed) {
        if (!confirmed) return;
        var fid = String(++msgId);
        _rpcCallbacks[fid] = function(result) {
          if (result.error) { addMsg('\u5220\u9664\u5931\u8d25: ' + result.error.message, 'err'); return; }
          if (currentFilePath === filePath) {
            closePreview();
          }
          if (wsContextFile === filePath) wsContextFile = null;
          if (wsContextDir === filePath || (wsContextDir && filePath.indexOf(wsContextDir) === 0)) {
            wsContextDir = _dirOf(filePath) || projectRoot;
          }
          refreshAllTrees();
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.delete', params: { path: filePath } }));
      });
    }

    function toggleFileSelection(path, name, row, isDir) {
      var idx = selectedFiles.findIndex(function(f) { return f.path === path; });
      if (idx >= 0) {
        selectedFiles.splice(idx, 1);
        row.style.background = 'transparent';
        row._selected = false;
        attachments = attachments.filter(function(a) { return !(a.type === 'file' && a.filePath === path) && !(a.type === 'folder' && a.folderPath === path); });
      } else {
        selectedFiles.push({ path: path, name: name, isDir: isDir });
        row.style.background = 'var(--hdc-accent)';
        row._selected = true;
        if (isDir) {
          // 文件夹
          attachToAI({
            title: name,
            icon: '\ud83d\udcc1',
            folderPath: path,
            type: 'folder'
          });
        } else {
          // 文件
          var ext = name.indexOf('.') > 0 ? name.split('.').pop() : '';
          attachToAI({
            title: name,
            lang: ext || name,
            filePath: path
          });
        }
      }
      renderAttachments();
    }
