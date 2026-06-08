// ── Attach To AI Module ──

    function renderAttachments() {
      var container = document.getElementById('hdc-attachments');
      if (!container) return;
      container.innerHTML = '';
      if (attachments.length === 0) {
        container.style.display = 'none';
        return;
      }
      container.style.display = 'flex';
      for (var i = 0; i < attachments.length; i++) {
        (function(idx) {
          var att = attachments[idx];
          var chip = document.createElement('div');
          chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:6px;padding:3px 8px;font-size:11px;color:var(--hdc-fg);cursor:default;max-width:260px';
          var icon = att.type === 'snippet' ? '\ud83d\udcc4' : att.type === 'folder' ? '\ud83d\udcc1' : att.type === 'file' ? '\ud83d\udcc4' : '\ud83d\udccb';
          var label = att.type === 'snippet' ? att.preview : att.type === 'folder' ? (att.folderPath ? att.folderPath.split(/[\\/]/).pop() : att.title) : (att.fileName || att.filePath);
          var labelSpan = document.createElement('span');
          labelSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          labelSpan.textContent = icon + ' ' + label;
          chip.appendChild(labelSpan);
          var removeBtn = document.createElement('span');
          removeBtn.textContent = '\u2715';
          removeBtn.style.cssText = 'cursor:pointer;color:var(--hdc-fg-dim);font-size:10px;margin-left:2px;flex-shrink:0';
          removeBtn.onclick = function() {
            attachments.splice(idx, 1);
            renderAttachments();
          };
          chip.appendChild(removeBtn);
          container.appendChild(chip);
        })(i);
      }
    }
    _renderAttachmentsFn = renderAttachments;

    function attachToAI(opts) {
      var title = opts.title || 'untitled';
      var filePath = opts.filePath || '';
      var folderPath = opts.folderPath || '';
      var content = opts.content || '';
      var lang = opts.lang || '';
      var icon = opts.icon || '';
      var rpcMethod = opts.rpcMethod || '';
      var rpcParams = opts.rpcParams || null;
      var type = opts.type || 'file';

      var label = icon ? icon + ' ' + title : title;

      // 文件夹类型
      if (type === 'folder' && folderPath) {
        attachments.push({
          type: 'folder',
          title: title,
          folderPath: folderPath,
          preview: label
        });
        renderAttachments();
        addMsg('\u5df2\u63d2\u5165\u6587\u4ef6\u5939 "' + title + '" \u5230AI\u5bf9\u8bdd', 'ok');
        return;
      }

      if (content) {
        attachments.push({
          type: 'file',
          fileName: label,
          filePath: filePath,
          lang: lang,
          content: content,
          startLine: 0,
          endLine: 0,
          preview: label
        });
        renderAttachments();
        addMsg('\u5df2\u63d2\u5165 "' + title + '" \u5230AI\u5bf9\u8bdd', 'ok');
        return;
      }

      if (rpcMethod && rpcParams) {
        var att = {
          type: 'file',
          fileName: label,
          filePath: filePath,
          lang: lang,
          content: '',
          startLine: 0,
          endLine: 0,
          preview: label + ' (\u52a0\u8f7d\u4e2d...)'
        };
        attachments.push(att);
        renderAttachments();
        var rid = String(++msgId);
        _rpcCallbacks[rid] = function(result) {
          if (result && !result.error && result.content) {
            att.content = result.content;
            att.preview = label;
            if (result.path) att.filePath = result.path;
          } else {
            att.preview = label + ' (\u52a0\u8f7d\u5931\u8d25)';
          }
          renderAttachments();
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method: rpcMethod, params: rpcParams }));
        addMsg('\u5df2\u63d2\u5165 "' + title + '" \u5230AI\u5bf9\u8bdd', 'ok');
        return;
      }

      if (filePath) {
        var att2 = {
          type: 'file',
          fileName: label,
          filePath: filePath,
          lang: lang,
          content: '',
          startLine: 0,
          endLine: 0,
          preview: label + ' (\u52a0\u8f7d\u4e2d...)'
        };
        attachments.push(att2);
        renderAttachments();
        var fid = String(++msgId);
        _rpcCallbacks[fid] = function(result) {
          if (result && !result.error && result.content) {
            att2.content = result.content;
            att2.preview = label;
          } else {
            att2.preview = label + ' (\u52a0\u8f7d\u5931\u8d25)';
          }
          renderAttachments();
        };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: fid, method: 'fs.read_file', params: { path: filePath } }));
        addMsg('\u5df2\u63d2\u5165 "' + title + '" \u5230AI\u5bf9\u8bdd', 'ok');
        return;
      }
    }
