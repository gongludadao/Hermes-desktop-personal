// ── Todo Panel Module ──
    var _todoVaultPath = null;
    var _todoRelPath = '待办事项.md';
    var _todoAbsPath = null;
    var _todoContextData = null; // 右键菜单上下文: {absPath, line, text}

    function initTodoPanel() {
      var refreshBtn = document.getElementById('hdc-ws-todo-refresh');
      if (refreshBtn) refreshBtn.onclick = function() { refreshTodoList(); };

      // 添加待办（Enter 键提交）
      var inputEl = document.getElementById('hdc-ws-todo-input');
      if (inputEl) {
        inputEl.onkeydown = function(e) {
          if (e.key === 'Enter') {
            var text = inputEl.value.trim();
            if (!text) return;
            inputEl.value = '';
            _addTodo(text);
          }
        };
      }

      // 待办右键菜单 item 绑定
      _initTodoContextMenu();

      // 待办面板空白/标题区域右键菜单
      var todoList = document.getElementById('hdc-ws-todo-list');
      var todoPanel = document.getElementById('hdc-ws-todo-panel');
      if (todoList) {
        todoList.oncontextmenu = function(e) {
          var item = e.target.closest('[data-todo-line]');
          if (item) return; // 交给 item 自己的 contextmenu 处理
          e.preventDefault();
          e.stopPropagation();
          _showTodoContextMenu(e.clientX, e.clientY);
        };
      }
      var todoHeader = todoPanel ? todoPanel.querySelector(':scope > div:first-child') : null;
      if (todoHeader) {
        todoHeader.oncontextmenu = function(e) {
          e.preventDefault();
          e.stopPropagation();
          _showTodoContextMenu(e.clientX, e.clientY);
        };
      }

      // 自动刷新
      if (window._obsidianVaultPath) {
        _todoVaultPath = window._obsidianVaultPath;
        refreshTodoList();
      }
      var check = setInterval(function() {
        if (typeof obsRoot !== 'undefined' && obsRoot && obsRoot !== _todoVaultPath) {
          _todoVaultPath = obsRoot;
          refreshTodoList();
        }
      }, 2000);
      setTimeout(function() { clearInterval(check); }, 300000);
    }

    function _initTodoContextMenu() {
      var menu = document.getElementById('hdc-ws-todo-context-menu');
      if (!menu) return;
      menu.querySelectorAll('div[data-action]').forEach(function(el) {
        el.onclick = function(e) {
          e.stopPropagation();
          var action = el.getAttribute('data-action');
          menu.style.display = 'none';

          var ctx = _todoContextData;
          if (!ctx) return;
          if (action === 'todo-send-ai') {
            if (ctx.text) {
              if (typeof switchToChat === 'function') switchToChat();
              attachToAI({
                title: '待办: ' + ctx.text,
                icon: '\u2611',
                lang: 'text',
                content: ctx.text,
                filePath: ctx.absPath || ''
              });
            }
          } else if (action === 'todo-delete') {
            _deleteTodoLine(ctx.absPath, ctx.line);
          }
        };
      });
    }

    function _showTodoContextMenu(clientX, clientY) {
      var menu = document.getElementById('hdc-ws-todo-context-menu');
      if (!menu) return;
      var x = Math.min(clientX, window.innerWidth - 155);
      var y = Math.min(clientY, window.innerHeight - 130);
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.style.display = '';
    }

    var _todoScanPending = false;
    function refreshTodoList() {
      if (_todoScanPending) return;
      _todoScanPending = true;
      var listEl = document.getElementById('hdc-ws-todo-list');
      var countEl = document.getElementById('hdc-ws-todo-count');
      var inputEl = document.getElementById('hdc-ws-todo-input');
      if (!listEl) { _todoScanPending = false; return; }

      var vaultPath = (typeof obsRoot !== 'undefined' && obsRoot) ? obsRoot :
                      (window._obsidianVaultPath || null);
      if (!vaultPath) {
        listEl.innerHTML = '<div style="padding:8px;text-align:center;color:var(--hdc-fg-dim);font-size:10px">未配置 Obsidian 仓库</div>';
        if (countEl) countEl.textContent = '';
        if (inputEl) inputEl.style.display = 'none';
        _todoScanPending = false;
        return;
      }
      if (inputEl) inputEl.style.display = '';

      listEl.innerHTML = '<div style="padding:8px;text-align:center;color:var(--hdc-fg-dim);font-size:10px">扫描中...</div>';

      var tid = String(++msgId);
      _rpcCallbacks[tid] = function(result) {
        _todoScanPending = false;
        if (result.error) {
          listEl.innerHTML = '<div style="padding:8px;text-align:center;color:#e06060;font-size:10px">扫描失败</div>';
          if (countEl) countEl.textContent = '';
          return;
        }
        var todos = result.todos || [];
        var relPath = result.todo_relpath || '待办事项.md';
        _todoRelPath = relPath;
        if (todos.length > 0) _todoAbsPath = todos[0].absPath;
        else _todoAbsPath = vaultPath + '/' + relPath;

        var pending = todos.filter(function(t) { return !t.done; });
        var done = todos.filter(function(t) { return t.done; });
        if (countEl) countEl.textContent = '(' + pending.length + '/' + todos.length + ')';

        if (todos.length === 0) {
          listEl.innerHTML = '<div style="padding:8px;text-align:center;color:var(--hdc-fg-dim);font-size:10px;line-height:1.6">没有待办事项<br><span style="font-size:9px;opacity:0.7">在仓库中创建 待办事项.md</span><br><span style="font-size:9px;opacity:0.7">并用 --- 分割线圈出待办区域</span></div>';
          return;
        }

        var html = '';
        var sorted = pending.concat(done);
        for (var i = 0; i < sorted.length; i++) {
          var t = sorted[i];
          var checked = t.done ? 'checked' : '';
          var rowStyle = t.done ? 'opacity:0.5' : '';
          html += '<div data-todo-abs-path="' + hdcEscape(t.absPath) + '" data-todo-line="' + t.line + '" data-todo-done="' + t.done + '" data-todo-text="' + hdcEscape(t.text) + '" style="display:flex;align-items:flex-start;gap:3px;padding:2px 4px;border-radius:3px;cursor:pointer;' + rowStyle + '" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<input type="checkbox" ' + checked + ' style="margin-top:2px;flex-shrink:0;cursor:pointer;accent-color:var(--hdc-accent)">' +
            '<span style="flex:1;font-size:11px;line-height:1.4;color:var(--hdc-fg);word-break:break-all">' + hdcEscape(t.text) + '</span>' +
            '</div>';
        }
        listEl.innerHTML = html;

        // checkbox 切换
        listEl.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
          cb.onchange = function(e) {
            e.stopPropagation();
            var item = cb.closest('[data-todo-line]');
            if (!item) return;
            var line = parseInt(item.getAttribute('data-todo-line'));
            var wasDone = item.getAttribute('data-todo-done') === 'true';
            var newDone = cb.checked;
            var row = item;
            if (newDone) row.style.opacity = '0.5';
            else row.style.opacity = '';
            item.setAttribute('data-todo-done', newDone ? 'true' : 'false');
            var toId = String(++msgId);
            _rpcCallbacks[toId] = function(r) {
              if (r.error) {
                cb.checked = wasDone;
                if (wasDone) row.style.opacity = '0.5';
                else row.style.opacity = '';
                item.setAttribute('data-todo-done', wasDone ? 'true' : 'false');
              } else {
                _refreshTodoCount();
                // 切换成功后重新扫描列表，避免事件总线触发的扫描读到脏数据
                // 用 500ms 去抖合并快速连续切换
                if (window._todoRefreshTimer) clearTimeout(window._todoRefreshTimer);
                window._todoRefreshTimer = setTimeout(function() {
                  refreshTodoList();
                }, 500);
              }
            };
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: toId, method: 'obsidian.toggle_todo', params: { line: line, done: newDone } }));
          };
        });

        // 点击 todo 行（非 checkbox）→ 打开文件并跳转
        listEl.querySelectorAll('[data-todo-line]').forEach(function(row) {
          row.onclick = function(e) {
            if (e.target.tagName === 'INPUT') return; // checkbox 事件由上面处理
            var line = parseInt(row.getAttribute('data-todo-line'));
            var absPath = row.getAttribute('data-todo-abs-path') || _todoAbsPath;
            openFile(absPath, '待办事项.md', line);
          };
          // 右键菜单
          row.oncontextmenu = function(e) {
            e.preventDefault();
            e.stopPropagation();
            var absPath = row.getAttribute('data-todo-abs-path') || _todoAbsPath;
            var line = parseInt(row.getAttribute('data-todo-line'));
            var text = row.getAttribute('data-todo-text') || '';
            _todoContextData = { absPath: absPath, line: line, text: text };
            _showTodoContextMenu(e.clientX, e.clientY);
          };
        });
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: tid, method: 'obsidian.scan_todos', params: {} }));
    }

    function _addTodo(text) {
      var tid = String(++msgId);
      _rpcCallbacks[tid] = function(result) {
        if (result.error) {
          addMsg('[待办] 添加失败: ' + (result.error.message || result.error), 'sys');
        } else {
          refreshTodoList();
        }
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: tid, method: 'obsidian.add_todo', params: { text: text } }));
    }

    function _deleteTodoLine(absPath, line) {
      var tid = String(++msgId);
      _rpcCallbacks[tid] = function(result) {
        if (result.error) {
          addMsg('[待办] 删除失败: ' + (result.error.message || result.error), 'sys');
          return;
        }
        refreshTodoList();
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: tid, method: 'obsidian.delete_todo_line', params: { line: line } }));
    }

    function _refreshTodoCount() {
      var listEl = document.getElementById('hdc-ws-todo-list');
      var countEl = document.getElementById('hdc-ws-todo-count');
      if (!listEl || !countEl) return;
      var total = listEl.querySelectorAll('[data-todo-line]').length;
      var done = listEl.querySelectorAll('[data-todo-done="true"]').length;
      countEl.textContent = '(' + (total - done) + '/' + total + ')';
    }

    // 通过事件总线注册待办刷新（2 秒去抖）
    window._registerVaultHandler('todo', function(payload) {
      console.log('[TodoPanel] vault_changed received, refreshing...');
      refreshTodoList();
    }, 2000);

    // 等待侧边栏就绪后初始化
    var _todoWsCheck = setInterval(function() {
      if (document.getElementById('hdc-ws-todo-list') && typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(_todoWsCheck);
        initTodoPanel();
      }
    }, 500);
