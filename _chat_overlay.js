(function() {
  if (window.__hdcov) return;
  window.__hdcov = Date.now();
  var _instanceId = window.__hdcov;

  var ws = null;
  var msgId = 0;
  var sessionId = null;
  var sending = false;
  var inputHistory = [];
  var historyIdx = -1;
  var historyDraft = '';
  var currentBotBubble = null;
  var ready = false;
  var isChatRoute = false;
  var ovl = null;
  var msgsEl = null;
  var inpEl = null;
  var sendBtn = null;
  var stopBtn = null;
  var statusEl = null;
  var emptyEl = null;
  var resumed = false;
  var resumePendingId = null;
  var savedResumeId = null;
  var reasoningEl = null;
  var reasoningText = '';
  var thinkingEl = null;
  var activeTools = {};
  var pendingBotMsgs = [];
  var pendingBotTimer = null;

  function requestSessionList() {
    sessionListId = String(++msgId);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: sessionListId, method: 'session.list', params: { limit: 100 } }));
  }
  var introShown = false;
  var streamAccum = '';
  var sessionPicker = null;
  var sessionListId = null;
  var allSessions = [];
  var switchingSession = false;
  var pendingSessionId = null;
  var createRequestId = null;
  var dbSessionId = null;
  var _rpcCallbacks = {};
  var _autoResumeAttempts = 0;
  var selectedFiles = [];
  var currentFilePath = null;
  var currentFileContent = '';
  var currentNoteId = null;
  var attachments = [];
  var fileWatchPaths = {};
  var diffMode = false;
  var diffOriginal = '';
  var _refreshEditorFn = null;
  var _lastWritePath = null;
  var _refreshTimer = null;
  var _renderAttachmentsFn = null;
  window._autoKbEnabled = false;  // 暴露为全局变量，供 _obsidian_vault.js 访问
  var _autoKbMaxFiles = 5;  // 最多注入5个匹配文件
  var _autoKbMaxChars = 3000;

  // ── Markdown renderer ───────────────────────────────────────────────
  function renderMarkdown(text) {
    if (!text) return '';

    var pathLinks = [];
    text = text.replace(/`([A-Za-z]:[\\\/][^\s"'`<>|]*[^\s"'`<>|.,;:!?)}\]])`/g, function(m, p) {
      if (p.length < 5) return m;
      var idx = pathLinks.length;
      pathLinks.push({ type: 'file', raw: p });
      return '\x01PL' + idx + '\x02';
    });
    text = text.replace(/(?:^|[\s(\[])([A-Za-z]:[\\\/][^\s"'`<>|]*[^\s"'`<>|.,;:!?)}\]])/g, function(m, p) {
      if (p.length < 5) return m;
      var idx = pathLinks.length;
      pathLinks.push({ type: 'file', raw: p });
      return m.charAt(0) + '\x01PL' + idx + '\x02';
    });
    text = text.replace(/https?:\/\/[^\s"'`<>|)}\]]+/g, function(m) {
      var idx = pathLinks.length;
      pathLinks.push({ type: 'url', raw: m });
      return '\x01PL' + idx + '\x02';
    });

    var codeBlocks = [];
    var codeBlockRaws = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_, lang, code) {
      var idx = codeBlocks.length;
      var rawCode = code.trim();
      codeBlockRaws.push(rawCode);
      codeBlocks.push({ lang: lang, idx: idx });
      return '\x00CB' + idx + '\x00';
    });

    var s = hdcEscape(text);
    s = s.replace(/&lt;span\s+style=&quot;color:(#[0-9a-fA-F]+)&quot;&gt;/g, '<span style="color:$1">');
    s = s.replace(/&lt;\/span&gt;/g, '</span>');
    s = s.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
    s = s.replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>');
    s = s.replace(/&lt;br\s*\/?&gt;/g, '<br>');

    var renderedCodeBlocks = [];
    s = s.replace(/\x00CB(\d+)\x00/g, function(_, idxStr) {
      var idx = parseInt(idxStr);
      var cb = codeBlocks[idx];
      if (!cb) return '';
      var lang = cb.lang;
      var rawCode = codeBlockRaws[idx];
      var rawEncoded = encodeURIComponent(rawCode);
      var langLabel = lang ? '<span style="font-size:10px;color:var(--hdc-fg-dim);margin-right:8px">' + hdcEscape(lang) + '</span>' : '';
      var canRun = /^(bash|sh|zsh|python|py|node|js|javascript|powershell|pwsh|cmd|bat|ruby|rb|perl|pl|php|go|rust|java|css|sql|html)$/i.test(lang);
      var runBtn = canRun ? '<button data-cb-action="run" data-cb-raw="' + rawEncoded + '" data-cb-lang="' + hdcEscape(lang) + '" style="background:transparent;border:1px solid var(--hdc-accent);color:var(--hdc-accent);border-radius:3px;padding:1px 8px;font-size:10px;cursor:pointer">\u25b6 \u8fd0\u884c</button>' : '';
      var toolbar = '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;border-bottom:1px solid var(--hdc-border)">' +
        langLabel +
        '<div style="display:flex;gap:6px">' +
          '<button data-cb-action="copy" data-cb-raw="' + rawEncoded + '" style="background:transparent;border:1px solid var(--hdc-border);color:var(--hdc-fg-dim);border-radius:3px;padding:1px 8px;font-size:10px;cursor:pointer">\ud83d\udccb \u590d\u5236</button>' +
          runBtn +
        '</div>' +
      '</div>';
      var displayCode = hdcEscape(rawCode);
      var html = '<div style="margin:8px 0;border-radius:6px;overflow:hidden;border:1px solid var(--hdc-border)">' +
        toolbar +
        '<pre style="margin:0;padding:10px 14px;overflow-x:auto;font-family:var(--hdc-mono);font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-all;' +
        'background:transparent;color:inherit">' +
        '<code style="background:transparent;color:inherit;font-family:inherit;font-size:inherit;white-space:pre-wrap;word-break:break-all">' + displayCode + '</code></pre></div>';
      renderedCodeBlocks.push(html);
      return '\x00RCB' + idx + '\x00';
    });

    s = s.replace(/(?:^\|.+\|\n^\|[-:| ]+\|\n(?:^\|.+\|\n?)+)/gm, function(tableText) {
      var lines = tableText.trim().split('\n');
      var headerCells = lines[0].split('|').filter(function(c) { return c.trim(); }).map(function(c) { return c.trim(); });
      var bodyLines = lines.slice(2);
      var html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:13px">';
      html += '<thead><tr>';
      for (var hi = 0; hi < headerCells.length; hi++) {
        html += '<th style="border:1px solid var(--hdc-border);padding:6px 10px;text-align:left;font-weight:600">' + headerCells[hi] + '</th>';
      }
      html += '</tr></thead><tbody>';
      for (var bi = 0; bi < bodyLines.length; bi++) {
        var cells = bodyLines[bi].split('|');
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();
        html += '<tr>';
        for (var ci = 0; ci < cells.length; ci++) {
          html += '<td style="border:1px solid var(--hdc-border);padding:6px 10px">' + cells[ci].trim() + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      return html;
    });

    s = s.replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 4px;font-size:14px;font-weight:600;line-height:1.5">$1</h4>');
    s = s.replace(/^## (.+)$/gm, '<h3 style="margin:14px 0 6px;font-size:16px;font-weight:600;line-height:1.5">$1</h3>');
    s = s.replace(/^# (.+)$/gm, '<h2 style="margin:16px 0 8px;font-size:18px;font-weight:600;line-height:1.5">$1</h2>');

    s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    s = s.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul style="margin:4px 0;padding:0 0 0 20px;line-height:1.65">$1</ul>');

    s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--hdc-border);margin:4px 0">');

    s = s.replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid var(--hdc-accent)' +
      ';padding-left:12px;margin:6px 0;line-height:1.65">$1</blockquote>');

    s = s.replace(/`([^`]+)`/g, '<code style="font-family:var(--hdc-mono)' +
      ';font-size:0.9em;padding:1px 4px;border-radius:3px">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--hdc-accent)' +
      ';text-decoration:underline" target="_blank">$1</a>');

    s = s.replace(/\x00RCB(\d+)\x00/g, function(_, idx) { return renderedCodeBlocks[parseInt(idx)]; });

    s = s.replace(/\x01PL(\d+)\x02/g, function(_, idx) {
      var link = pathLinks[parseInt(idx)];
      if (!link) return '';
      var escaped = hdcEscape(link.raw);
      if (link.type === 'file') {
        return '<a href="#" data-file-path="' + escaped + '" style="color:var(--hdc-accent);text-decoration:underline;cursor:pointer">' + escaped + '</a>';
      }
      return '<a href="' + escaped + '" style="color:var(--hdc-accent);text-decoration:underline" target="_blank">' + escaped + '</a>';
    });

    s = s.replace(/\n?<hr[^>]*>\n?/g, function(m) { return m.replace(/\n/g, ''); });
    s = s.replace(/\n\n+/g, '<br><br>');
    s = s.replace(/\n/g, '<br>');

    return s;
  }

  // ── read dashboard theme colours ────────────────────────────────────
  function readTheme() {
    var root = document.documentElement;
    var cs = getComputedStyle(root);
    return {
      bg: cs.getPropertyValue('--background-base').trim() || '#041c1c',
      fg: cs.getPropertyValue('--midground-base').trim() || '#ffe6cb',
      fgDim: cs.getPropertyValue('--color-text-secondary').trim() || 'rgba(255,230,203,0.55)',
      card: cs.getPropertyValue('--color-card').trim() || 'rgba(255,230,203,0.04)',
      border: cs.getPropertyValue('--color-border').trim() || 'rgba(255,230,203,0.15)',
      accent: cs.getPropertyValue('--color-warning').trim() || '#c8a44e',
      muted: cs.getPropertyValue('--color-muted').trim() || 'rgba(255,230,203,0.08)',
      red: '#c88',
      font: cs.getPropertyValue('--theme-font-sans').trim() || 'system-ui,-apple-system,sans-serif',
      mono: cs.getPropertyValue('--theme-font-mono').trim() || 'ui-monospace,monospace'
    };
  }

  var T = readTheme();
  var _prevThemeStr = JSON.stringify(T);

  function updateOverlayTheme() {
    var newT = readTheme();
    var newStr = JSON.stringify(newT);
    if (newStr === _prevThemeStr) return;
    _prevThemeStr = newStr;
    T = newT;
    var root = document.documentElement;
    root.style.setProperty('--hdc-bg', T.bg);
    root.style.setProperty('--hdc-fg', T.fg);
    root.style.setProperty('--hdc-fg-dim', T.fgDim);
    root.style.setProperty('--hdc-card', T.card);
    root.style.setProperty('--hdc-border', T.border);
    root.style.setProperty('--hdc-accent', T.accent);
    root.style.setProperty('--hdc-muted', T.muted);
    root.style.setProperty('--hdc-font', T.font);
    root.style.setProperty('--hdc-mono', T.mono);
    if (ovl) {
      ovl.style.background = T.bg;
      ovl.style.color = T.fg;
      ovl.style.fontFamily = T.font;
    }
  }

  // 使用 MutationObserver 监听主题变化，而非定时轮询
  var themeObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === 'style' || mutations[i].attributeName === 'class') {
        updateOverlayTheme();
        break;
      }
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

  var css = [
    ':root{--hdc-bg:' + T.bg + ';--hdc-fg:' + T.fg + ';--hdc-fg-dim:' + T.fgDim + ';--hdc-card:' + T.card + ';--hdc-border:' + T.border + ';--hdc-accent:' + T.accent + ';--hdc-muted:' + T.muted + ';--hdc-font:' + T.font + ';--hdc-mono:' + T.mono + '}',
    '@keyframes hdcFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes hdcToastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}',
    '.hdc-stream::after{content:"\u258c";animation:hdcBlink 1s step-end infinite}@keyframes hdcBlink{50%{opacity:0}}',
    '.hdc-active .hermes-chat-xterm-host,.hdc-active [data-chat-active] .border-warning\\/50{display:none!important}',
    '.hdc-active [data-chat-active] [id="chat-side-panel"]{display:none!important}',
    '.hdc-reasoning{max-height:0;overflow:hidden;transition:max-height .3s ease}',
    '.hdc-reasoning.open{max-height:600px;overflow-y:auto}',
    '#hdc-overlay,#hdc-overlay *{-webkit-user-select:text;user-select:text!important}',
    '#hdc-workspace-sidebar,#hdc-workspace-sidebar *{-webkit-user-select:none;user-select:none!important}',
    '#hdc-overlay{background:var(--hdc-bg);color:var(--hdc-fg);font-family:var(--hdc-font)}',
    '#hdc-header{border-color:var(--hdc-border)}',
    '#hdc-session-picker{background:var(--hdc-card);border-color:var(--hdc-border);color:var(--hdc-fg)}',
    '#hdc-new-session{color:var(--hdc-accent);border-color:var(--hdc-accent)}',
    '#hdc-toggle-workspace{color:var(--hdc-fg-dim);border-color:var(--hdc-border)}',
    '#hdc-workspace-sidebar{border-color:var(--hdc-border)}',
    '#hdc-ws-project-header{background:var(--hdc-card)}',
    '#hdc-ws-clip-header{background:var(--hdc-card)}',
    '#hdc-msgs{border-color:var(--hdc-border)}',
    '#hdc-input{background:var(--hdc-card);border-color:var(--hdc-border);color:var(--hdc-fg)}',
    '#hdc-status{color:var(--hdc-fg-dim)}',
    '.hdc-msg-user{background:transparent;border-color:var(--hdc-accent);color:var(--hdc-fg) !important}',
    '.hdc-msg-bot{background:transparent;border-color:var(--hdc-border);color:var(--hdc-fg) !important}',
    '.hdc-msg-user *,.hdc-msg-bot *{color:inherit !important;background:transparent !important}',
    '.hdc-msg-user a,.hdc-msg-bot a{color:var(--hdc-accent) !important}',
    '.hdc-msg-user code,.hdc-msg-bot code{font-family:var(--hdc-mono) !important;background:transparent !important}',
    '.hdc-msg-user pre,.hdc-msg-bot pre{background:transparent !important}',
    '.hdc-msg-user blockquote,.hdc-msg-bot blockquote{background:transparent !important}',
    '.hdc-msg-user table,.hdc-msg-bot table{background:transparent !important}',
    '.hdc-msg-user th,.hdc-msg-bot th{background:transparent !important}',
    '.hdc-msg-user td,.hdc-msg-bot td{background:transparent !important}',
    '.hdc-ws-item{color:var(--hdc-fg)}',
    '.hdc-ws-item:hover{background:var(--hdc-muted)}',
    '.hdc-ws-item-selected{background:var(--hdc-accent)}',
    '.hdc-clip-item{color:var(--hdc-fg)}',
    '.hdc-clip-item:hover{background:var(--hdc-muted)}',
    '.hdc-intro-card{background:transparent;border-color:var(--hdc-border);color:var(--hdc-fg)}',
    '.hdc-intro-title{color:var(--hdc-accent)}',
    '.hdc-intro-row{color:var(--hdc-fg)}',
    '.hdc-intro-row-dim{color:var(--hdc-fg-dim)}',
    '.hdc-menu-item{color:var(--hdc-fg)}',
    '.hdc-menu-item:hover{background:var(--hdc-muted)}',
    '.hdc-menu-item-dim{color:var(--hdc-fg-dim)}',
    '.hdc-menu-item-red{color:#e06060}',
    '.hdc-btn-accent{background:var(--hdc-accent);color:#000}',
    '.hdc-btn-outline{background:transparent;color:var(--hdc-accent)}',
    '.hdc-btn-outline:hover{background:var(--hdc-accent);color:#000}',
    '.hdc-btn-dim{background:transparent;color:var(--hdc-fg-dim)}',
    '.hdc-btn-dim:hover{background:var(--hdc-muted)}'
  ].join('');
  var style = document.createElement('style');
  style.id = 'hdc-theme-style';
  style.textContent = css;
  document.head.appendChild(style);

  function buildOverlay() {
    T = readTheme();
    var accentFg = '#000';
    ovl = document.createElement('div');
    ovl.id = 'hdc-overlay';
    ovl.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9000;display:none;flex-direction:row;' +
      'background:var(--hdc-bg);color:var(--hdc-fg);font-family:var(--hdc-font);overflow:hidden';

    ovl.innerHTML =
      '<div id="hdc-main" style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0">' +
        '<div id="hdc-header" style="padding:8px 20px;border-bottom:1px solid var(--hdc-border);display:flex;align-items:center;gap:10px;flex-shrink:0">' +
          '<span style="font-size:13px;color:var(--hdc-fg-dim);white-space:nowrap">\u4f1a\u8bdd</span>' +
          '<button id="hdc-model-btn" title="\u5207\u6362\u6a21\u578b" style="background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:6px;padding:6px 8px;color:var(--hdc-fg);font-size:11px;font-family:inherit;cursor:pointer;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u6a21\u578b</button>' +
          '<select id="hdc-session-picker" style="flex:1;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:6px;padding:6px 10px;color:var(--hdc-fg);font-size:13px;font-family:inherit;outline:none;cursor:pointer;max-width:300px">' +
            '<option value="">\u52a0\u8f7d\u4e2d...</option>' +
          '</select>' +
          '<button id="hdc-refresh-sessions" title="\u5237\u65b0\u4f1a\u8bdd\u5217\u8868" style="background:transparent;color:var(--hdc-fg-dim);border:1px solid var(--hdc-border);border-radius:6px;padding:6px 8px;font-size:12px;cursor:pointer">\u21bb</button>' +
          '<button id="hdc-new-session" style="background:transparent;color:var(--hdc-accent);border:1px solid var(--hdc-accent);border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">+ \u65b0\u4f1a\u8bdd</button>' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--hdc-fg-dim);cursor:pointer;white-space:nowrap">' +
            '<input type="checkbox" id="hdc-auto-approve" checked style="cursor:pointer" />' +
            '\u81ea\u52a8\u6279\u51c6' +
          '</label>' +
          '<button id="hdc-toggle-workspace" style="background:transparent;color:var(--hdc-fg-dim);border:1px solid var(--hdc-border);border-radius:6px;padding:6px 10px;font-size:14px;cursor:pointer;margin-left:auto" title="\u5de5\u4f5c\u533a">\u2630</button>' +
        '</div>' +
        '<div id="hdc-content" style="flex:1;display:flex;overflow:hidden">' +
          '<div id="hdc-msgs" style="flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column">' +
            '<div id="hdc-empty" style="text-align:center;color:var(--hdc-fg-dim);padding:80px 20px">' +
              '<div style="color:var(--hdc-accent);font-size:28px;margin-bottom:14px">\u2624</div>' +
              '<div>\u5728\u4e0b\u65b9\u8f93\u5165\u6d88\u606f\uff0c\u5f00\u59cb\u4e0e AI \u5bf9\u8bdd</div>' +
            '</div>' +
          '</div>' +
          '<div id="hdc-resizer-editor" style="width:4px;cursor:col-resize;flex-shrink:0;background:transparent;display:none" onmouseover="this.style.background=\'var(--hdc-accent)\'" onmouseout="this.style.background=\'transparent\'"></div>' +
          '<div id="hdc-editor-panel" style="display:none;flex:1;min-width:180px;border-left:1px solid var(--hdc-border);flex-direction:column;overflow:hidden">' +
            '<div id="hdc-editor-header" style="border-bottom:1px solid var(--hdc-border);flex-shrink:0">' +
              '<div id="hdc-editor-tabs" style="display:flex;align-items:center;gap:2px;padding:4px 8px;overflow-x:auto;flex-shrink:0"></div>' +
              '<div style="padding:6px 12px;display:flex;align-items:center;gap:6px">' +
                '<span id="hdc-editor-filename" style="font-size:12px;color:var(--hdc-fg);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>' +
                '<button id="hdc-editor-edit" style="background:transparent;border:1px solid var(--hdc-border);color:var(--hdc-fg-dim);border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">\u7f16\u8f91</button>' +
                '<button id="hdc-editor-save" style="display:none;background:var(--hdc-accent);color:#000;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">\u4fdd\u5b58</button>' +
                '<button id="hdc-editor-close" style="background:transparent;border:none;color:var(--hdc-fg-dim);cursor:pointer;font-size:14px;padding:0 4px">\u2715</button>' +
              '</div>' +
            '</div>' +
            '<div id="hdc-editor-body" style="flex:1;overflow:hidden;position:relative;display:flex;flex-direction:column">' +
              '<div id="hdc-editor-toolbar" style="display:none;padding:4px 8px;border-bottom:1px solid var(--hdc-border);background:var(--hdc-muted);flex-shrink:0;gap:4px;flex-wrap:wrap"></div>' +
              '<div style="flex:1;overflow:hidden;position:relative">' +
                '<div id="hdc-editor-preview" style="width:100%;height:100%;overflow:auto;padding:12px;font-family:var(--hdc-mono);font-size:13px;line-height:1.6"></div>' +
                '<textarea id="hdc-editor-textarea" style="display:none;width:100%;height:100%;background:var(--hdc-bg);color:var(--hdc-fg);border:none;padding:12px;font-family:var(--hdc-mono);font-size:13px;line-height:1.6;resize:none;outline:none;tab-size:2;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word"></textarea>' +
              '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
        '<div id="hdc-input-area" style="padding:0 20px 10px;border-top:1px solid var(--hdc-border);display:flex;flex-direction:column;gap:0;flex-shrink:0;background:var(--hdc-muted)">' +
          '<div id="hdc-status-bar" style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:10px;color:var(--hdc-fg-dim);padding:3px 0;line-height:1.2">' +
            '<span id="hdc-input-status">\u6b63\u5728\u8fde\u63a5...</span>' +
            '<span id="hdc-auto-kb-bar" style="display:none;align-items:center;gap:4px">' +
              '<input type="checkbox" id="hdc-auto-kb-check" style="cursor:pointer;margin:0;width:12px;height:12px" />' +
              '<label for="hdc-auto-kb-check" style="cursor:pointer;user-select:none">\u81ea\u52a8\u5f15\u7528\u77e5\u8bc6\u5e93</label>' +
            '</span>' +
          '</div>' +
          '<div id="hdc-attachments" style="display:none;flex-wrap:wrap;gap:4px"></div>' +
          '<div style="display:flex;gap:10px">' +
            '<textarea id="hdc-input" placeholder="\u8f93\u5165\u6d88\u606f...\uff08\u56de\u8f66\u53d1\u9001\uff09" rows="1" ' +
              'style="flex:1;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;padding:10px 14px;color:var(--hdc-fg);font-size:14px;font-family:inherit;resize:none;outline:none;max-height:80px"></textarea>' +
            '<button id="hdc-send" style="background:var(--hdc-accent);color:#000;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">\u53d1\u9001</button>' +
            '<button id="hdc-stop" style="display:none;background:transparent;color:var(--hdc-fg-dim);border:1px solid var(--hdc-border);border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer">\u25A0 \u505c\u6b62</button>' +
          '</div>' +
      '</div>' +
    '</div>' +
    '<div id="hdc-resizer-sidebar" style="width:4px;cursor:col-resize;flex-shrink:0;background:transparent;transition:background 0.15s;display:none" onmouseover="this.style.background=\'var(--hdc-accent)\'" onmouseout="this.style.background=\'transparent\'"></div>' +
    '<div id="hdc-workspace-sidebar" style="width:0;min-width:0;border-left:1px solid var(--hdc-border);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;transition:width 0.2s,min-width 0.2s;transition:none">' +
      // 中间可滚动区域
      '<div id="hdc-ws-scroll-area" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0">' +
      '<div id="hdc-ws-project-header" style="padding:6px 8px;border-bottom:1px solid var(--hdc-border);cursor:pointer;user-select:none;flex-shrink:0;background:var(--hdc-card)">'+
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span id="hdc-ws-project-arrow" style="font-size:10px;transition:transform 0.2s;display:inline-block">\u25b8</span>' +
          '<span>\ud83d\udcc1</span>' +
          '<span id="hdc-ws-project-name" style="font-size:12px;color:var(--hdc-fg)">\u9879\u76ee</span>' +
          '<span style="flex:1"></span>' +
          '<span id="hdc-ws-switch-project" title="\u5207\u6362\u9879\u76ee" style="flex-shrink:0;cursor:pointer;font-size:12px;color:var(--hdc-fg-dim);padding:2px 4px;border-radius:3px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u21c4</span>' +
        '</div>' +
        '<div id="hdc-ws-path-tip" style="display:none;font-size:10px;color:var(--hdc-fg-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;padding-left:22px"></div>' +
      '</div>' +
      '<div id="hdc-ws-project-body" style="display:none;flex-direction:column;overflow:hidden">' +
        '<div id="hdc-ws-project-tabs" style="display:flex;align-items:stretch;overflow-x:auto;border-bottom:1px solid var(--hdc-border);min-height:0"></div>' +
        '<div id="hdc-ws-tree" style="flex:1;overflow-y:auto;padding:4px 0 40px 0;font-size:12px;min-height:40px"></div>' +
      '</div>' +
      '<div id="hdc-ws-note-header" style="padding:6px 8px;border-bottom:1px solid var(--hdc-border);border-top:1px solid var(--hdc-border);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;flex-shrink:0;background:var(--hdc-card)">'+
        '<span id="hdc-ws-note-arrow" style="font-size:10px;transition:transform 0.2s;display:inline-block">\u25b8</span>' +
        '<span>\ud83d\udcdd</span>' +
        '<span style="font-size:12px;color:var(--hdc-fg)">\u8bb0\u4e8b\u672c</span>' +
        '<span id="hdc-ws-note-count" style="font-size:10px;color:var(--hdc-fg-dim)"></span>' +
        '<span style="flex:1"></span>' +
        '<button id="hdc-ws-note-add" title="\u65b0\u5efa" style="background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:2px 6px;color:var(--hdc-fg-dim);font-size:10px;cursor:pointer">+</button>' +
        '<button id="hdc-ws-note-refresh" title="\u5237\u65b0" style="background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:2px 6px;color:var(--hdc-fg-dim);font-size:10px;cursor:pointer">\u21bb</button>' +
      '</div>' +
      '<div id="hdc-ws-note-body" style="display:none;flex-direction:column;overflow:hidden">' +
        '<div id="hdc-ws-note-list" style="overflow-y:auto;flex:1;padding:2px 4px;font-size:11px;min-height:40px;max-height:200px">' +
          '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u70b9\u51fb + \u65b0\u5efa\u7b14\u8bb0</div>' +
        '</div>' +
      '</div>' +
      '<div id="hdc-ws-clip-header" style="padding:6px 8px;border-bottom:1px solid var(--hdc-border);border-top:1px solid var(--hdc-border);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;flex-shrink:0;background:var(--hdc-card)">'+
        '<span id="hdc-ws-clip-arrow" style="font-size:10px;transition:transform 0.2s;display:inline-block">\u25b8</span>' +
        '<span>\ud83d\udccb</span>' +
        '<span style="font-size:12px;color:var(--hdc-fg)">\u526a\u5207\u677f</span>' +
        '<span id="hdc-ws-clip-count" style="font-size:10px;color:var(--hdc-fg-dim)"></span>' +
        '<span style="flex:1"></span>' +
        '<button id="hdc-ws-clip-refresh" title="\u5237\u65b0" style="background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:2px 6px;color:var(--hdc-fg-dim);font-size:10px;cursor:pointer">\u21bb</button>' +
      '</div>' +
      '<div id="hdc-ws-clip-body" style="display:none;flex-direction:column;overflow:hidden">' +
        '<div id="hdc-ws-clip-list" style="overflow-y:auto;flex:1;padding:2px 4px;font-size:11px;min-height:40px">' +
          '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u70b9\u51fb\u21bb\u5237\u65b0\u83b7\u53d6\u7cfb\u7edf\u526a\u5207\u677f</div>' +
        '</div>' +
      '</div>' +
      // Obsidian Vault Module (between clipboard and stock)
      '<div id="hdc-ws-obs-header" style="padding:6px 8px;border-bottom:1px solid var(--hdc-border);border-top:1px solid var(--hdc-border);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;flex-shrink:0;background:var(--hdc-card)">'+
        '<span id="hdc-ws-obs-arrow" style="font-size:10px;transition:transform 0.2s;display:inline-block">\u25b8</span>' +
        '<span>\ud83d\udcd8</span>' +
        '<span style="font-size:12px;color:var(--hdc-fg)">Obsidian \u4ed3\u5e93</span>' +
        '<span style="flex:1"></span>' +
        '<button id="hdc-ws-obs-refresh" title="\u5237\u65b0\u76ee\u5f55\u6811" style="background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:2px 6px;color:var(--hdc-fg-dim);font-size:10px;cursor:pointer">\u21bb</button>' +
        '<button id="hdc-ws-obs-switch-vault" title="\u5207\u6362\u4ed3\u5e93" style="background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:2px 6px;color:var(--hdc-fg-dim);font-size:10px;cursor:pointer">\ud83d\udd04</button>' +
      '</div>' +
      '<div id="hdc-ws-obs-body" style="display:none;flex-direction:column;overflow:hidden">' +
        '<div id="hdc-ws-obs-tree" style="flex:1;overflow-y:auto;padding:4px 0;font-size:12px;min-height:40px">' +
          '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u672a\u914d\u7f6e\u4efb\u4f55 Obsidian \u4ed3\u5e93<br><br>\u70b9\u51fb [\u5207\u6362] \u9009\u6291\u4ed3\u5e93\u8def\u5f84</div>' +
        '</div>' +
      '</div>' +
      '<div id="hdc-ws-stock-header" style="padding:6px 8px;border-bottom:1px solid var(--hdc-border);border-top:1px solid var(--hdc-border);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;flex-shrink:0;background:var(--hdc-card)">'+
        '<span id="hdc-ws-stock-arrow" style="font-size:10px;transition:transform 0.2s;display:inline-block">\u25b8</span>' +
        '<span>\ud83d\udcc8</span>' +
        '<span style="font-size:12px;color:var(--hdc-fg)">\u80a1\u7968</span>' +
        '<span id="hdc-ws-stock-status" style="font-size:9px;color:var(--hdc-fg-dim);margin-left:2px"></span>' +
        '<span style="flex:1"></span>' +
        '<button id="hdc-ws-stock-refresh" title="\u5237\u65b0" style="background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:2px 6px;color:var(--hdc-fg-dim);font-size:10px;cursor:pointer">\u21bb</button>' +
      '</div>' +
      '<div id="hdc-ws-stock-body" style="display:none;flex-direction:column;overflow:hidden">' +
        '<div id="hdc-ws-stock-actions" style="padding:4px 8px;border-bottom:1px solid var(--hdc-border);display:flex;gap:4px;flex-shrink:0;align-items:center;position:relative">' +
          '<input id="hdc-ws-stock-input" placeholder="\u8f93\u5165\u4ee3\u7801\u6216\u540d\u79f0\u5982 600519/\u8305\u53f0" style="flex:1;background:var(--hdc-muted);border:1px solid var(--hdc-border);border-radius:4px;padding:3px 8px;color:var(--hdc-fg);font-size:11px;outline:none">' +
          '<button id="hdc-ws-stock-add" title="\u6dfb\u52a0\u80a1\u7968" style="background:var(--hdc-accent);color:' + accentFg + ';border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">\u6dfb\u52a0</button>' +
          '<div id="hdc-ws-stock-dropdown" style="display:none;position:absolute;top:100%;left:8px;right:8px;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:100;max-height:200px;overflow-y:auto"></div>' +
        '</div>' +
        '<div id="hdc-ws-stock-list" style="overflow-y:auto;flex:1;padding:4px 6px;font-size:11px;min-height:40px">' +
          '<div style="padding:20px 8px;text-align:center;color:var(--hdc-fg-dim);font-size:11px">\u6dfb\u52a0\u80a1\u7968\u4ee3\u7801\u67e5\u770b\u884c\u60c5</div>' +
        '</div>' +
      '</div>' +
      '</div>' + // hdc-ws-scroll-area 结束
      // ── 待办事项面板（固定在底部） ──
      '<div id="hdc-ws-todo-panel" style="flex-shrink:0;border-top:1px solid var(--hdc-border);display:flex;flex-direction:column;height:185px;background:var(--hdc-card)">' +
        '<div style="padding:3px 8px;display:flex;align-items:center;gap:4px;flex-shrink:0;border-bottom:1px solid var(--hdc-border)">' +
          '<span style="font-size:11px">☑</span>' +
          '<span style="font-size:11px;color:var(--hdc-fg);font-weight:600">待办事项</span>' +
          '<span id="hdc-ws-todo-count" style="font-size:10px;color:var(--hdc-fg-dim)"></span>' +
          '<span style="flex:1"></span>' +
          '<button id="hdc-ws-todo-refresh" title="刷新" style="background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:1px 5px;color:var(--hdc-fg-dim);font-size:10px;cursor:pointer">↻</button>' +
        '</div>' +
        '<div id="hdc-ws-todo-list" style="flex:1;overflow-y:auto;padding:2px 4px;font-size:11px">' +
          '<div style="padding:8px;text-align:center;color:var(--hdc-fg-dim);font-size:10px">加载中...</div>' +
        '</div>' +
        '<div style="flex-shrink:0;display:flex;border-top:1px solid var(--hdc-border);padding:3px 4px;gap:3px">' +
          '<input id="hdc-ws-todo-input" type="text" placeholder="添加待办 (Enter)" style="flex:1;background:transparent;border:1px solid var(--hdc-border);border-radius:3px;padding:2px 5px;color:var(--hdc-fg);font-size:10px;outline:none;min-width:0">' +
        '</div>' +
      '</div>' +
      '<div id="hdc-ws-context-menu" style="display:none;position:fixed;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;padding:4px 0;z-index:10000;min-width:130px;box-shadow:0 4px 12px rgba(0,0,0,0.35)">' +
        '<div data-action="new-file" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83d\udcc4 \u65b0\u5efa\u6587\u4ef6</div>' +
        '<div data-action="new-folder" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83d\udcc1 \u65b0\u5efa\u6587\u4ef6\u5939</div>' +
        '<div data-action="select-files" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83d\udcce \u9009\u62e9\u6587\u4ef6</div>' +
        '<div style="height:1px;background:var(--hdc-border);margin:4px 0"></div>' +
        createSendAIContextMenuOption('file-send-ai') +
        '<div data-action="rename" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u270f \u91cd\u547d\u540d</div>' +
        '<div data-action="delete" class="hdc-menu-item-red" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83d\uddd1 \u5220\u9664</div>' +
        '<div data-action="copy-path" class="hdc-menu-item-dim" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83d\udccb \u590d\u5236\u8def\u5f84</div>' +
      '</div>' +
      '<div id="hdc-ws-note-context-menu" style="display:none;position:fixed;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;padding:4px 0;z-index:10001;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.35)">' +
        createSendAIContextMenuOption('note-send-ai') +
        '<div data-action="note-rename" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u270f \u91cd\u547d\u540d</div>' +
        '<div data-action="note-delete" class="hdc-menu-item-red" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u2715 \u5220\u9664</div>' +
      '</div>' +
      '<div id="hdc-ws-clip-context-menu" style="display:none;position:fixed;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;padding:4px 0;z-index:10001;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.35)">' +
        '<div data-action="clip-select" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u2611 \u591a\u9009</div>' +
        '<div data-action="clip-translate" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83c\udf10 \u7ffb\u8bd1</div>' +
        createSendAIContextMenuOption('clip-insert') +
        '<div data-action="clip-save-note" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83d\udcdd \u4fdd\u5b58\u5230\u7b14\u8bb0</div>' +
        '<div style="height:1px;background:var(--hdc-border);margin:4px 0"></div>' +
        '<div data-action="clip-delete" class="hdc-menu-item-red" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u2715 \u5220\u9664</div>' +
        '<div data-action="clip-clear" class="hdc-menu-item-red" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\ud83d\uddd1 \u6e05\u7a7a</div>' +
      '</div>' +
      '<div id="hdc-ws-stock-context-menu" style="display:none;position:fixed;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;padding:4px 0;z-index:10002;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.35)">' +
        '<div data-action="stock-settings" class="hdc-menu-item" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u2699 \u8bbe\u7f6e</div>' +
        createSendAIContextMenuOption('stock-insert') +
        '<div data-action="stock-delete" class="hdc-menu-item-red" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u2715 \u5220\u9664</div>' +
      '</div>' +
      '<div id="hdc-ws-todo-context-menu" style="display:none;position:fixed;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;padding:4px 0;z-index:10003;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.35)">' +
        createSendAIContextMenuOption('todo-send-ai') +
        '<div style="height:1px;background:var(--hdc-border);margin:4px 0"></div>' +
        '<div data-action="todo-delete" class="hdc-menu-item-red" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">\u2715 \u5220\u9664\u5f85\u529e</div>' +
      '</div>' +
    '</div>' +
    '<div id="hdc-input-dialog" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:10002;background:rgba(0,0,0,0.4);align-items:center;justify-content:center">' +
      '<div style="background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:10px;padding:20px;min-width:280px;max-width:400px;box-shadow:0 8px 24px rgba(0,0,0,0.4)">' +
        '<div id="hdc-input-dialog-title" style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--hdc-fg)"></div>' +
        '<input id="hdc-input-dialog-input" style="width:100%;padding:8px 12px;border:1px solid var(--hdc-border);border-radius:6px;background:var(--hdc-bg);color:var(--hdc-fg);font-size:13px;outline:none;box-sizing:border-box" />' +
        '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">' +
          '<button id="hdc-input-dialog-cancel" style="padding:6px 16px;border:1px solid var(--hdc-border);border-radius:6px;background:transparent;color:var(--hdc-fg-dim);font-size:12px;cursor:pointer">\u53d6\u6d88</button>' +
          '<button id="hdc-input-dialog-ok" style="padding:6px 16px;border:none;border-radius:6px;background:var(--hdc-accent);color:' + accentFg + ';font-size:12px;font-weight:600;cursor:pointer">\u786e\u5b9a</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.appendChild(ovl);

    // 使用缓存容器优化 DOM 查询
    var ui = {};
    var root = ovl;
    var elements = [
      'msgs', 'input', 'send', 'stop', 'empty', 'session-picker',
      'model-btn', 'workspace-sidebar', 'ws-tree', 'ws-project-header',
      'ws-project-tabs', 'ws-project-body', 'ws-project-arrow', 'ws-project-name',
      'ws-path-tip', 'ws-switch-project', 'ws-context-menu',
      'ws-note-header', 'ws-note-body', 'ws-note-arrow', 'ws-note-list',
      'ws-note-count', 'ws-note-add', 'ws-note-refresh',
      'ws-clip-header', 'ws-clip-body', 'ws-clip-arrow', 'ws-clip-list',
      'ws-clip-count', 'ws-clip-refresh', 'ws-note-context-menu', 'ws-clip-context-menu',
      'ws-stock-header', 'ws-stock-body', 'ws-stock-arrow', 'ws-stock-input',
      'ws-stock-add', 'ws-stock-dropdown', 'ws-obs-header', 'ws-obs-body',
      'ws-obs-arrow', 'ws-obs-tree', 'ws-obs-switch-vault', 'ws-obs-refresh',
      'ws-stock-refresh', 'ws-stock-list', 'ws-stock-status', 'ws-stock-context-menu',
      'editor-panel', 'editor-filename', 'editor-textarea', 'editor-preview',
      'editor-edit', 'resizer-editor', 'resizer-sidebar',
      'new-session', 'refresh-sessions', 'toggle-workspace', 'auto-approve',
      'input-dialog', 'input-dialog-title', 'input-dialog-input',
      'input-dialog-cancel', 'input-dialog-ok', 'editor-save', 'editor-close',
      'attachments', 'input-status', 'auto-kb-bar', 'auto-kb-check'
    ];

    elements.forEach(function(id) {
      ui[id] = root.querySelector('[id="hdc-' + id + '"]');
    });

    // 赋值给原有变量以保持兼容
    msgsEl = ui['msgs'];
    inpEl = ui['input'];
    sendBtn = ui['send'];
    stopBtn = ui['stop'];
    statusEl = ui['input-status']; // 指向输入框上方的状态显示区域
    emptyEl = ui['empty'];
    sessionPicker = ui['session-picker'];
    var modelBtn = ui['model-btn'];

    var wsSidebar = ui['workspace-sidebar'];
    var wsTree = ui['ws-tree'];
    var wsProjectHeader = ui['ws-project-header'];
    var wsProjectTabs = ui['ws-project-tabs'];
    var wsProjectBody = ui['ws-project-body'];
    var wsProjectArrow = ui['ws-project-arrow'];
    var wsProjectName = ui['ws-project-name'];
    var wsPathTip = ui['ws-path-tip'];
    var wsSwitchProject = ui['ws-switch-project'];
    var wsContextMenu = ui['ws-context-menu'];
    var wsNoteHeader = ui['ws-note-header'];
    var wsNoteBody = ui['ws-note-body'];
    var wsNoteArrow = ui['ws-note-arrow'];
    var wsNoteList = ui['ws-note-list'];
    var wsNoteCount = ui['ws-note-count'];
    var wsNoteAdd = ui['ws-note-add'];
    var wsNoteRefresh = ui['ws-note-refresh'];
    var wsClipHeader = ui['ws-clip-header'];
    var wsClipBody = ui['ws-clip-body'];
    var wsClipArrow = ui['ws-clip-arrow'];
    var wsClipList = ui['ws-clip-list'];
    var wsClipCount = ui['ws-clip-count'];
    var wsClipRefresh = ui['ws-clip-refresh'];
    var wsNoteContextMenu = ui['ws-note-context-menu'];
    var wsClipContextMenu = ui['ws-clip-context-menu'];
    var wsStockHeader = ui['ws-stock-header'];
    var wsStockBody = ui['ws-stock-body'];
    var wsStockArrow = ui['ws-stock-arrow'];
    var wsStockInput = ui['ws-stock-input'];
    var wsStockAdd = ui['ws-stock-add'];
    var wsStockDropdown = ui['ws-stock-dropdown'];
    // Obsidian Vault elements
    var wsObsHeader = ui['ws-obs-header'];
    var wsObsBody = ui['ws-obs-body'];
    var wsObsArrow = ui['ws-obs-arrow'];
    var wsObsTree = ui['ws-obs-tree'];
    var wsObsSwitchVault = ui['ws-obs-switch-vault'];
    var wsObsRefresh = ui['ws-obs-refresh'];
    var _stockSearchTimer = null;
    var wsStockRefresh = ui['ws-stock-refresh'];
    var wsStockList = ui['ws-stock-list'];
    var wsStockStatusEl = ui['ws-stock-status'];
    var wsStockContextMenu = ui['ws-stock-context-menu'];
    var wsStockContextIdx = -1;
    var wsContextFile = null;
    var wsContextDir = null;
    var wsClipContextIdx = -1;
    var editorPanel = ui['editor-panel'];
    var editorFilename = ui['editor-filename'];
    var editorTextarea = ui['editor-textarea'];
    var editorPreview = ui['editor-preview'];
    var editBtn = ui['editor-edit'];
    var editorResizerEl = ui['resizer-editor'];
    var projectRoot = null;
    var wsOpen = false;
    var isEditMode = false;
    var selectMode = false;
    var _treeContainers = {};
    var clipboardHistory = [];

    // Restore from localStorage cache
    try {
      var saved_raw = localStorage.getItem('desktop_clipboard_cache_10');
      if (saved_raw) {
        try {
          var parsed = JSON.parse(saved_raw);
          if (Array.isArray(parsed)) {
            clipboardHistory = parsed;
          }
        } catch(e) {}
      }
    } catch(e) {}

    function toggleSection(bodyEl, arrowEl) {
      if (bodyEl.style.display === 'none' || !bodyEl.style.display) {
        bodyEl.style.display = 'flex';
        if (arrowEl) arrowEl.style.transform = 'rotate(90deg)';
      } else {
        bodyEl.style.display = 'none';
        if (arrowEl) arrowEl.style.transform = 'rotate(0deg)';
      }
    }

    // ── 侧边栏模块拖拽排序 ──
    function toggleWorkspace() {
      wsOpen = !wsOpen;
      if (wsOpen) {
        wsSidebar.style.width = '260px';
        wsSidebar.style.minWidth = '260px';
        sidebarResizerEl.style.display = '';
      } else {
        wsSidebar.style.width = '0';
        wsSidebar.style.minWidth = '0';
        sidebarResizerEl.style.display = 'none';
      }
    }
    ui['toggle-workspace'].onclick = toggleWorkspace;

    var _modelName = '';
    var _modelList = [];
    modelBtn.onclick = function(e) {
      e.stopPropagation();
      var dd = document.getElementById('hdc-model-dd');
      if (dd) { dd.remove(); return; }
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      modelBtn.textContent = '\u52a0\u8f7d\u4e2d...';
      var mid = String(++msgId);
      _rpcCallbacks[mid] = function(r) {
        var cfg = r.config || {};
        _modelName = (cfg.model && cfg.model.default) || '';
        _modelList = [];
        var provs = cfg.providers || {};
        for (var pid in provs) {
          if (provs.hasOwnProperty(pid)) {
            var pv = provs[pid];
            if (pv.models && Array.isArray(pv.models)) {
              for (var mi = 0; mi < pv.models.length; mi++) {
                _modelList.push(pv.models[mi]);
              }
            }
          }
        }
        if (_modelList.length === 0 && _modelName) _modelList = [_modelName];
        var display = _modelName || '\u6a21\u578b';
        modelBtn.textContent = display.length > 16 ? display.substring(0, 13) + '...' : display;
        dd = document.createElement('div');
        dd.id = 'hdc-model-dd';
        dd.style.cssText = 'position:fixed;background:var(--hdc-card);border:1px solid var(--hdc-border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;min-width:180px;padding:4px 0';
        var rc = modelBtn.getBoundingClientRect();
        dd.style.left = rc.left + 'px';
        dd.style.top = (rc.bottom + 4) + 'px';
        for (var mi = 0; mi < _modelList.length; mi++) {
          (function(mn) {
            var it = document.createElement('div');
            it.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:12px;color:var(--hdc-fg)';
            if (mn === _modelName) it.style.background = 'var(--hdc-muted)';
            it.onmouseover = function() { this.style.background = 'var(--hdc-muted)'; };
            it.onmouseout = function() { if (this.textContent !== _modelName) this.style.background = 'transparent'; };
            it.textContent = mn;
            it.onclick = function() {
              dd.remove();
              var sid = String(++msgId);
              _rpcCallbacks[sid] = function(sr) {
                if (sr.error) { addMsg('\u5207\u6362\u5931\u8d25', 'err'); return; }
                _modelName = sr.value || mn;
                var d = _modelName;
                modelBtn.textContent = d.length > 16 ? d.substring(0, 13) + '...' : d;
                addMsg('\u2705 \u5df2\u5207\u6362\u5230 ' + mn, 'sys');
              };
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: sid, method: 'config.set', params: { key: 'model', value: mn, session_id: sessionId } }));
            };
            dd.appendChild(it);
          })(_modelList[mi]);
        }
        document.body.appendChild(dd);
      };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: mid, method: 'config.get', params: { key: 'full' } }));
    };
    document.addEventListener('click', function(ev) {
      var d = document.getElementById('hdc-model-dd');
      if (d && ev.target !== modelBtn && !d.contains(ev.target)) d.remove();
    });

    // ── MODULES ──

    // 初始化 Obsidian Vault 事件（模块注入后调用）
    if (typeof initObsVaultEvents === 'function') {
      initObsVaultEvents();
    }

    var sidebarResizerEl = ui['resizer-sidebar'];
    initResizer(sidebarResizerEl, wsSidebar, 180, function() { return window.innerWidth * 0.5; }, 'col');

    document.addEventListener('click', function(e) {
      if (wsContextMenu.style.display !== 'none' && !wsContextMenu.contains(e.target)) {
        wsContextMenu.style.display = 'none';
      }
      if (wsClipContextMenu.style.display !== 'none' && !wsClipContextMenu.contains(e.target)) {
        hideClipContextMenu();
      }
      if (wsStockContextMenu.style.display !== 'none' && !wsStockContextMenu.contains(e.target)) {
        hideStockContextMenu();
      }
      if (typeof wsNoteContextMenu !== 'undefined' && wsNoteContextMenu.style.display !== 'none' && !wsNoteContextMenu.contains(e.target)) {
        hideNoteContextMenu();
      }
      var wsTodoContextMenu = document.getElementById('hdc-ws-todo-context-menu');
      if (wsTodoContextMenu && wsTodoContextMenu.style.display !== 'none' && !wsTodoContextMenu.contains(e.target)) {
        wsTodoContextMenu.style.display = 'none';
      }
    });

    sendBtn.onclick = doSend;
    stopBtn.onclick = doStop;
    var autoKbBar = ui['auto-kb-bar'];
    var autoKbCheck = ui['auto-kb-check'];
    if (autoKbCheck) {
      autoKbCheck.checked = window._autoKbEnabled;
      autoKbCheck.onchange = function() {
        window._autoKbEnabled = autoKbCheck.checked;
        updateStatusDisplay();
      };
    }
    if (autoKbBar) autoKbBar.style.display = 'flex';
    // 初始化状态显示
    updateStatusDisplay();
    sessionPicker.onchange = onSessionChange;
    ui['new-session'].onclick = doNewSession;
    ui['refresh-sessions'].onclick = function() { requestSessionList(); };
    msgsEl.addEventListener('click', function(e) {
      var cbBtn = e.target.closest('button[data-cb-action]');
      if (cbBtn) {
        e.preventDefault();
        e.stopPropagation();
        var action = cbBtn.getAttribute('data-cb-action');
        var rawCode = decodeURIComponent(cbBtn.getAttribute('data-cb-raw') || '');
        if (action === 'copy' && rawCode) {
          navigator.clipboard.writeText(rawCode).then(function() {
            cbBtn.textContent = '\u2713 \u5df2\u590d\u5236';
            setTimeout(function() { cbBtn.textContent = '\ud83d\udccb \u590d\u5236'; }, 1500);
          });
        } else if (action === 'run' && rawCode) {
          var cbLang = cbBtn.getAttribute('data-cb-lang') || '';
          var execId = String(++msgId);
          _rpcCallbacks[execId] = function(result) {
            if (result.error) {
              addMsg('\u274c \u8fd0\u884c\u5931\u8d25: ' + result.error, 'err');
            } else {
              var out = result.output || '(无输出)';
              var exitCode = result.exitCode;
              var icon = exitCode === 0 ? '\u2705' : '\u26a0';
              addMsg(renderMarkdown(icon + ' \u8fd0\u884c\u7ed3\u679c (\u9000\u51fa\u7801 ' + exitCode + '):\n```\n' + out + '\n```'), 'bot', false, true);
            }
            cbBtn.textContent = '\u25b6 \u8fd0\u884c';
          };
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: execId, method: 'fs.execute', params: { code: rawCode, lang: cbLang } }));
          cbBtn.textContent = '\u25b6 \u8fd0\u884c\u4e2d...';
        }
        return;
      }
      var a = e.target.closest('a[data-file-path]');
      if (a) {
        e.preventDefault();
        e.stopPropagation();
        var fp = a.getAttribute('data-file-path');
        if (fp) {
          var name = fp.split(/[\\/]/).pop() || fp;
          var notepadMatch = fp.match(/[\\\/]notepad[\\\/]([^\\\/]+)\.(md|txt)$/i);
          if (notepadMatch) {
            openPreview({
              title: '\ud83d\udcdd ' + notepadMatch[1],
              content: '',
              type: 'md',
              editable: true,
              noteId: notepadMatch[1],
              rpc: {
                method: 'notepad.read',
                params: { id: notepadMatch[1] },
                onResult: function(result) {
                  if (!result || result.error) return null;
                  return { title: '\ud83d\udcdd ' + result.title, content: result.content || '', type: 'md' };
                }
              }
            });
          } else {
            navigateToPath(fp, name);
          }
        }
        return;
      }
      var link = e.target.closest('a[href]');
      if (link) {
        var href = link.getAttribute('href') || '';
        if (/^[A-Za-z]:[\\\/]/.test(href) || /^\//.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          var linkName = href.split(/[\\/]/).pop() || href;
          navigateToPath(href, linkName);
        }
        // ✅ 移除跳转网页到预览面板的功能，让网页链接正常打开
      }
    });
    inpEl.onkeydown = function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); return; }
      if (e.key === 'ArrowUp' && !e.shiftKey && inputHistory.length > 0) {
        // Only trigger history when cursor is at the start of input
        if (inpEl.selectionStart > 0 || inpEl.selectionEnd > 0) return;
        if (historyIdx === -1) {
          historyDraft = inpEl.value;
          historyIdx = inputHistory.length - 1;
        } else if (historyIdx > 0) {
          historyIdx--;
        }
        inpEl.value = inputHistory[historyIdx];
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && historyIdx !== -1) {
        // Only trigger history when cursor is at the end of input
        if (inpEl.selectionStart < inpEl.value.length) return;
        if (historyIdx < inputHistory.length - 1) {
          historyIdx++;
          inpEl.value = inputHistory[historyIdx];
        } else {
          historyIdx = -1;
          inpEl.value = historyDraft;
        }
        e.preventDefault();
        return;
      }
    };
    inpEl.oninput = function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 80) + 'px';
    };

    positionOverlay();
  }

  function positionOverlay() {
    if (!ovl) return;
    var left = 0;
    var dashSidebar = document.getElementById('app-sidebar');
    if (dashSidebar) {
      var rect = dashSidebar.getBoundingClientRect();
      if (rect.width > 10) left = Math.round(rect.right);
    }
    ovl.style.left = left + 'px';
    ovl.style.top = '0px';
    ovl.style.width = (window.innerWidth - left) + 'px';
    ovl.style.height = window.innerHeight + 'px';
  }

  // 使用 MutationObserver 等待侧边栏元素出现，而非轮询
  function setupSidebarObserver() {
    var sb = document.getElementById('app-sidebar');
    if (sb) {
      new ResizeObserver(function() { if (isChatRoute) positionOverlay(); }).observe(sb);
      return;
    }
    var sbObserver = new MutationObserver(function(mutations, obs) {
      var sb = document.getElementById('app-sidebar');
      if (sb) {
        new ResizeObserver(function() { if (isChatRoute) positionOverlay(); }).observe(sb);
        obs.disconnect();
      }
    });
    sbObserver.observe(document.body, { childList: true, subtree: true });
    // 超时保护：10秒后自动停止监听
    setTimeout(function() { sbObserver.disconnect(); }, 10000);
  }
  setupSidebarObserver();

  window.addEventListener('resize', function() { if (isChatRoute) positionOverlay(); });

  // ── route detection ─────────────────────────────────────────────────
  function checkRoute() {
    var basePath = (window.__HERMES_BASE_PATH__ || '').replace(/\/+$/, '');
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    var now = path === basePath + '/chat';
    if (now !== isChatRoute) {
      isChatRoute = now;
      if (isChatRoute) {
        showOverlay();
      } else {
        hideOverlay();
      }
    }
  }

  // Auto navigate to /chat on startup
  function autoNavigateToChat() {
    var basePath = (window.__HERMES_BASE_PATH__ || '').replace(/\/+$/, '');
    var targetPath = basePath + '/chat';
    var currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    if (currentPath !== targetPath) {
      var chatLink = document.querySelector('a[href="/chat"], a[href="' + targetPath + '"]');
      if (chatLink) {
        chatLink.click();
      } else {
        window.history.pushState({}, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }
  }

  function showOverlay() {
    if (!ovl) {
      buildOverlay();
    }
    else {
      T = readTheme();
      ovl.style.background = 'var(--hdc-bg)';
      ovl.style.color = 'var(--hdc-fg)';
      ovl.style.fontFamily = 'var(--hdc-font)';
    }
    positionOverlay();
    ovl.style.display = 'flex';
    document.body.classList.add('hdc-active');

    if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) doConnect();
  }

  function hideOverlay() {
    if (ovl) ovl.style.display = 'none';
    document.body.classList.remove('hdc-active');
  }

  var _push = history.pushState;
  history.pushState = function() { _push.apply(this, arguments); checkRoute(); };
  var _replace = history.replaceState;
  history.replaceState = function() { _replace.apply(this, arguments); checkRoute(); };
  window.addEventListener('popstate', checkRoute);

  // ── Intro card ──────────────────────────────────────────────────────
  function showIntro(info) {
    if (introShown || !msgsEl || !info) return;
    introShown = true;
    if (emptyEl) { emptyEl.remove(); emptyEl = null; }

    var card = document.createElement('div');
    card.className = 'hdc-intro-card';
    card.style.cssText =
      'border-radius:10px;padding:16px 18px;margin-bottom:16px;font-size:13px;line-height:1.8';

    var lines = [];
    if (info.model) lines.push('\uD83E\uDD16 \u6a21\u578b: ' + hdcEscape(info.model));
    if (info.profile_name) lines.push('\uD83D\uDC64 \u914d\u7f6e: ' + hdcEscape(info.profile_name));
    if (info.cwd) lines.push('\uD83D\uDCC2 \u5de5\u4f5c\u76ee\u5f55: ' + hdcEscape(info.cwd));

    var toolNames = info.tools ? Object.keys(info.tools) : [];
    var skillNames = info.skills ? Object.keys(info.skills) : [];
    if (toolNames.length) lines.push('\uD83D\uDD27 \u5de5\u5177: ' + toolNames.join(', ') + ' (' + toolNames.length + ')');
    if (skillNames.length) lines.push('\uD83D\uDCDA \u6280\u80fd: ' + skillNames.join(', ') + ' (' + skillNames.length + ')');

    card.innerHTML = lines.map(function(l) {
      return '<div class="hdc-intro-row-dim">' + l + '</div>';
    }).join('');

    msgsEl.appendChild(card);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // ── Reasoning section ───────────────────────────────────────────────
  function ensureReasoning() {
    if (reasoningEl || !msgsEl) return;
    if (currentBotBubble || streamAccum) return;
    reasoningEl = document.createElement('div');
    reasoningEl.style.cssText = 'margin-bottom:8px;font-size:12px';

    var toggle = document.createElement('div');
    toggle.style.cssText =
      'color:var(--hdc-fg-dim);cursor:pointer;padding:6px 0;user-select:none;' +
      'font-family:var(--hdc-mono)';
    toggle.textContent = '\u25BC \u601d\u8003\u8fc7\u7a0b';
    toggle.onclick = function() {
      var body = reasoningEl.querySelector('.hdc-reasoning');
      var open = body.classList.toggle('open');
      toggle.textContent = (open ? '\u25BC' : '\u25B6') + ' \u601d\u8003\u8fc7\u7a0b';
    };

    var body = document.createElement('div');
    body.className = 'hdc-reasoning open';
    body.style.cssText =
      'color:var(--hdc-fg-dim);background:var(--hdc-muted);border-left:3px solid var(--hdc-border);' +
      'padding:8px 12px;border-radius:0 6px 6px 0;white-space:pre-wrap;word-break:break-word;' +
      'font-family:var(--hdc-mono);';

    reasoningEl.appendChild(toggle);
    reasoningEl.appendChild(body);
    msgsEl.appendChild(reasoningEl);

    thinkingEl = document.createElement('div');
    thinkingEl.style.cssText =
      'color:var(--hdc-fg-dim);font-size:12px;padding:4px 0 4px 8px;' +
      'font-style:italic;border-left:3px solid var(--hdc-border)';
    msgsEl.appendChild(thinkingEl);
  }

  function updateReasoning(text) {
    ensureReasoning();
    if (!reasoningEl) return;
    var body = reasoningEl.querySelector('.hdc-reasoning');
    if (body) {
      reasoningText += text;
      body.textContent = reasoningText;
    }
  }

  function setThinking(text) {
    ensureReasoning();
    if (thinkingEl) {
      thinkingEl.textContent = text || '';
      thinkingEl.style.display = text ? '' : 'none';
    }
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // ── WebSocket ──────────────────────────────────────────────────────
  function doConnect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (ws) { try { ws.close(); } catch(e) {} }
    var token = window.__HERMES_SESSION_TOKEN__ || '';
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      var basePath = (window.__HERMES_BASE_PATH__ || '').replace(/\/+$/, '');
      ws = new WebSocket(proto + '//' + location.host + basePath + '/api/ws?token=' + encodeURIComponent(token));
    } catch(e) { return; }

    if (statusEl) statusEl.textContent = '\u6b63\u5728\u8fde\u63a5...';

    ws.onopen = function() {
      console.log('[Overlay] ws.onopen triggered');
      if (statusEl) statusEl.textContent = '\u5df2\u8fde\u63a5\uff0c\u7b49\u5f99\u7f51\u5173\u5c31\u7eea...';
      console.log('[Overlay] typeof loadAppConfig:', typeof loadAppConfig);
      console.log('[Overlay] typeof window.autoActivateObsVault:', typeof window.autoActivateObsVault);
      if (typeof loadAppConfig === 'function') {
        console.log('[Overlay] calling loadAppConfig...');
        loadAppConfig(function() {
          console.log('[Overlay] loadAppConfig callback called');
          if (typeof initStockOnConnect === 'function') initStockOnConnect();
          if (typeof window.autoActivateObsVault === 'function') {
            console.log('[Overlay] calling window.autoActivateObsVault...');
            window.autoActivateObsVault();
          } else {
            console.log('[Overlay] window.autoActivateObsVault not available');
          }
        });
      } else {
        console.log('[Overlay] loadAppConfig not available, calling autoActivateObsVault directly');
        if (typeof initStockOnConnect === 'function') initStockOnConnect();
        if (typeof window.autoActivateObsVault === 'function') window.autoActivateObsVault();
      }
    };

    ws.onclose = function() {
      ready = false;
      resumed = false;
      resumePendingId = null;
      savedResumeId = null;
      introShown = false;
      reasoningEl = null;
      thinkingEl = null;
      reasoningText = '';
      activeTools = {};
      streamAccum = '';
      pendingBotMsgs = [];
      if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }
      sessionId = null;
      sessionListId = null;
      // 重置剪贴板轮询状态，以便重连后重新启动监听
      if (typeof _clipPolling !== 'undefined') _clipPolling = false;
      if (inpEl) inpEl.disabled = true;
      setSending(false);
      if (statusEl) { statusEl.textContent = '\u8fde\u63a5\u65ad\u5f00\uff0c3\u79d2\u540e\u91cd\u8fde...'; statusEl.style.color = T.red; }
      setTimeout(function() { if (isChatRoute) doConnect(); }, 3000);
    };

    ws.onmessage = function(e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch(e2) { return; }

      if (msg.id && _rpcCallbacks[msg.id]) {
        var cb = _rpcCallbacks[msg.id];
        delete _rpcCallbacks[msg.id];
        var r = msg.result || msg;
        if (msg.error) r = { error: msg.error };
        cb(r);
        return;
      }

      if (msg.method === 'event' && msg.params) {
        var type = msg.params.type;
        var p = msg.params.payload || {};

        switch (type) {
          case 'gateway.ready':
            resumed = true;
            _autoResumeAttempts = 0;
            var savedSid = window.localStorage.getItem('hdc_sid');
            if (savedSid) {
              if (statusEl) statusEl.textContent = '\u6b63\u5728\u6062\u590d\u4e0a\u6b21\u4f1a\u8bdd...';
              savedResumeId = String(++msgId);
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: savedResumeId, method: 'session.resume', params: { session_id: savedSid } }));
              requestSessionList();
            } else {
              if (statusEl) statusEl.textContent = '\u6b63\u5728\u67e5\u8be2\u6700\u8fd1\u4f1a\u8bdd...';
              var mrId = String(++msgId);
              _rpcCallbacks[mrId] = function(r) {
                var recentSid = r.session_id;
                if (recentSid) {
                  switchingSession = true;
                  pendingSessionId = recentSid;
                  if (statusEl) statusEl.textContent = '\u6b63\u5728\u6062\u590d\u6700\u8fd1\u4f1a\u8bdd...';
                  resumePendingId = String(++msgId);
                  ws.send(JSON.stringify({ jsonrpc: '2.0', id: resumePendingId, method: 'session.resume', params: { session_id: recentSid } }));
                }
              };
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: mrId, method: 'session.most_recent', params: {} }));
              requestSessionList();
            }
            if (typeof window.startClipboardWatcher === 'function') window.startClipboardWatcher();
            break;

          case 'session.info':
            showIntro(p);
            break;

          case 'thinking.delta':
            if (p.text) setThinking(hdcEscape(String(p.text)));
            break;

          case 'reasoning.delta':
            if (p.text) updateReasoning(String(p.text));
            break;

          case 'reasoning.available':
            if (p.text) {
              reasoningText = String(p.text);
              ensureReasoning();
              var body = reasoningEl.querySelector('.hdc-reasoning');
              if (body) body.textContent = reasoningText;
              var toggle = reasoningEl.querySelector('div');
              if (toggle) { body.classList.add('open'); toggle.textContent = '\u25BC \u601d\u8003\u8fc7\u7a0b'; }
            }
            break;

          case 'message.start':
            if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }
            currentBotBubble = null;
            streamAccum = '';
            reasoningText = '';
            if (reasoningEl) {
              reasoningEl.remove();
              reasoningEl = null;
            }
            if (thinkingEl) {
              thinkingEl.remove();
              thinkingEl = null;
            }
            break;

          case 'message.delta':
            if (p.text) {
              streamAccum += String(p.text);
            }
            break;

          case 'message.complete':
            setThinking('');
            var botText = streamAccum || p.text || p.final_response || '';
            var botRendered = p.rendered || '';
            streamAccum = '';
            if (currentBotBubble) {
              currentBotBubble.remove();
              currentBotBubble = null;
            }
            if (botRendered || botText) {
              pendingBotMsgs.push({ rendered: botRendered, text: botText });
            }
            if (pendingBotTimer) clearTimeout(pendingBotTimer);
            pendingBotTimer = setTimeout(flushPendingBotMsgs, 400);
            if (inpEl) inpEl.focus();
            if ((currentFilePath || currentNoteId) && _refreshEditorFn) {
              if (_refreshTimer) clearTimeout(_refreshTimer);
              _refreshTimer = setTimeout(function() { if (_refreshEditorFn) _refreshEditorFn(); }, 800);
            }
            break;

          case 'tool.start':
            if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }
            if (p.name) {
              activeTools[p.tool_id || p.name] = { name: p.name, context: p.context || '' };
              var toolLabel = p.name + (p.context ? ': ' + p.context : '');
              addMsg('\uD83D\uDD27 ' + hdcEscape(toolLabel), 'sys');
            }
            break;

          case 'tool.complete':
            if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }
            if (p.name) {
              delete activeTools[p.tool_id || p.name];
              var err = p.error ? ' \u274c' : '';
              var dur = p.duration_s ? ' (' + Number(p.duration_s).toFixed(1) + '\u79d2)' : '';
              addMsg('\u2705 ' + hdcEscape(p.name) + err + dur, 'sys');
              if (!p.error && currentFilePath) {
                var fileWriteTools = ['write_file', 'write_to_file', 'patch_file', 'edit_file', 'replace_in_file', 'create_file', 'write', 'file_write', 'apply_diff', 'edit', 'patch', 'writefile', 'modify_file', 'update_file', 'save_file', 'create', 'overwrite', 'task', 'run_shell_command', 'bash', 'execute', 'run', 'command', 'sed'];
                var toolNameLower = (p.name || '').toLowerCase();
                var isFileWrite = fileWriteTools.some(function(t) { return toolNameLower.indexOf(t) >= 0; });
                var ctxStr = ((p.context || '') + ' ' + (p.output || '') + ' ' + (p.input || '') + ' ' + (p.result || '') + ' ' + (p.summary || '')).toLowerCase();
                if (!isFileWrite) {
                  if (ctxStr.indexOf('write') >= 0 || ctxStr.indexOf('patch') >= 0 || ctxStr.indexOf('edit') >= 0 || ctxStr.indexOf('created') >= 0 || ctxStr.indexOf('modified') >= 0 || ctxStr.indexOf('updated') >= 0 || ctxStr.indexOf('saved') >= 0 || ctxStr.indexOf('changed') >= 0 || ctxStr.indexOf('replaced') >= 0) {
                    isFileWrite = true;
                  }
                }
                if (isFileWrite) {
                  if (_refreshTimer) clearTimeout(_refreshTimer);
                  _refreshTimer = setTimeout(function() { if (_refreshEditorFn) _refreshEditorFn(); }, 600);
                }
              }
              pendingBotTimer = setTimeout(flushPendingBotMsgs, 600);
            }
            break;

          case 'tool.progress':
            if (p.name && p.preview) {
              addMsg('\uD83D\uDD27 ' + hdcEscape(p.name) + ': ' + hdcEscape(String(p.preview)), 'sys');
            }
            break;

          case 'tool.generating':
            if (p.name) {
              addMsg('\uD83D\uDCC4 \u751f\u6210\u4e2d: ' + hdcEscape(p.name) + '\u2026', 'sys');
            }
            break;

          case 'status.update':
            if (p.text) {
              if (p.kind === 'goal') {
                var icon = (p.text.indexOf('\u2713') === 0) ? '\u2705' : (p.text.indexOf('\u21BB') === 0 || p.text.indexOf('\u21BB') >= 0) ? '\u21BB' : '\u23F8';
                addMsg(icon + ' ' + hdcEscape(p.text), 'sys');
              } else if (p.kind && p.kind !== 'status') {
                addMsg(hdcEscape(p.text), 'sys');
              }
              if (statusEl) { statusEl.textContent = p.text; statusEl.style.color = 'var(--hdc-fg-dim)'; }
            }
            break;

          case 'browser.progress':
            if (p.message) {
              addMsg('\uD83C\uDF10 ' + hdcEscape(String(p.message)), 'sys');
            }
            break;

          case 'clipboard.changed':
            if (p.text && typeof window.onClipboardChanged === 'function') {
              window.onClipboardChanged(p.text);
            }
            break;

          case 'obsidian.vault_changed':
            console.log('[Overlay] obsidian.vault_changed event received, version:', p.version);
            // 通过事件总线分发给各注册模块（预览、待办、树等）
            if (typeof window._dispatchVaultChanged === 'function') {
              window._dispatchVaultChanged(p);
            }
            break;

          case 'project.file_changed':
            // 前端去抖：3 秒内不重复刷新
            if (window._lastTreeRefresh && Date.now() - window._lastTreeRefresh < 3000) {
              console.log('[Overlay] project.file_changed debounced, skip');
              break;
            }
            window._lastTreeRefresh = Date.now();
            addMsg('[Project] \u68c0\u6d4b\u5230\u6587\u4ef6\u53d8\u5316\uff0c\u6b63\u5728\u5237\u65b0\u9879\u76ee\u6811...', 'sys');
            if (typeof window.refreshProjectTree === 'function') {
              window.refreshProjectTree();
              addMsg('[Project] refreshProjectTree \u8c03\u7528\u5b8c\u6210', 'sys');
            } else {
              addMsg('[Project] refreshProjectTree \u672a\u627e\u5230\uff01', 'sys');
            }
            break;

          case 'file.changed':
            if (p.path && _refreshEditorFn && currentFilePath === p.path) {
              _refreshEditorFn();
            }
            break;

          case 'gateway.stderr':
            if (p.line) {
              addMsg('\u26A0 ' + hdcEscape(String(p.line).slice(0, 120)), 'warn');
            }
            break;

          case 'error':
            pendingBotMsgs = [];
            if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }
            addMsg(p.message || '\u672a\u77e5\u9519\u8bef', 'err');
            setSending(false);
            updateStatusDisplay();
            break;

          case 'approval.request':
            if (p.command) {
              var autoApproveEl = document.getElementById('hdc-auto-approve');
              if (autoApproveEl && autoApproveEl.checked) {
                addMsg('\u2705 \u81ea\u52a8\u6279\u51c6: ' + hdcEscape(String(p.description || p.command)), 'sys');
                ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'approval.respond', params: { choice: 'once', request_id: p.request_id } }));
              } else {
                var approvalDiv = document.createElement('div');
                approvalDiv.style.cssText = 'align-self:flex-start;background:var(--hdc-card);border:1px solid #e0a030;border-radius:12px;padding:10px 14px;font-size:13px;color:var(--hdc-fg);max-width:88%;margin-bottom:8px';
                var descSpan = document.createElement('div');
                descSpan.style.cssText = 'margin-bottom:8px;white-space:pre-wrap';
                descSpan.textContent = '\u26A0 \u9700\u8981\u6279\u51c6: ' + (p.description || p.command);
                approvalDiv.appendChild(descSpan);
                var btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;gap:8px';
                var approveBtn = document.createElement('button');
                approveBtn.textContent = '\u2705 \u5141\u8bb8';
                approveBtn.style.cssText = 'background:var(--hdc-accent);color:' + accentFg + ';border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:12px;font-weight:600';
                var denyBtn = document.createElement('button');
                denyBtn.textContent = '\u274C \u62d2\u7edd';
                denyBtn.style.cssText = 'background:transparent;color:var(--hdc-fg-dim);border:1px solid var(--hdc-border);border-radius:6px;padding:6px 16px;cursor:pointer;font-size:12px';
                approveBtn.onclick = function() {
                  ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'approval.respond', params: { choice: 'once', request_id: p.request_id } }));
                  approvalDiv.style.opacity = '0.5';
                  approveBtn.disabled = true;
                  denyBtn.disabled = true;
                  descSpan.textContent = '\u2705 \u5df2\u6279\u51c6: ' + (p.description || p.command);
                };
                denyBtn.onclick = function() {
                  ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'approval.respond', params: { choice: 'deny', request_id: p.request_id } }));
                  approvalDiv.style.opacity = '0.5';
                  approveBtn.disabled = true;
                  denyBtn.disabled = true;
                  descSpan.textContent = '\u274C \u5df2\u62d2\u7edd: ' + (p.description || p.command);
                };
                btnRow.appendChild(approveBtn);
                btnRow.appendChild(denyBtn);
                approvalDiv.appendChild(btnRow);
                msgsEl.appendChild(approvalDiv);
                msgsEl.scrollTop = msgsEl.scrollHeight;
              }
            }
            break;

          case 'clarify.request':
            if (p.prompt) {
              var clarifyDiv = document.createElement('div');
              clarifyDiv.style.cssText = 'align-self:flex-start;background:var(--hdc-card);border:1px solid var(--hdc-accent);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--hdc-fg);max-width:88%;margin-bottom:8px';
              var questionSpan = document.createElement('div');
              questionSpan.style.cssText = 'margin-bottom:8px;white-space:pre-wrap';
              questionSpan.textContent = '\u2753 ' + p.prompt;
              clarifyDiv.appendChild(questionSpan);
              var clarifyRow = document.createElement('div');
              clarifyRow.style.cssText = 'display:flex;gap:8px';
              var clarifyInput = document.createElement('input');
              clarifyInput.type = 'text';
              clarifyInput.style.cssText = 'flex:1;background:var(--hdc-muted);border:1px solid var(--hdc-border);border-radius:6px;padding:6px 10px;color:var(--hdc-fg);font-size:12px;outline:none';
              clarifyInput.placeholder = '\u8f93\u5165\u56de\u7b54...';
              var clarifySubmit = document.createElement('button');
              clarifySubmit.textContent = '\u53d1\u9001';
              clarifySubmit.style.cssText = 'background:var(--hdc-accent);color:' + accentFg + ';border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600';
              clarifySubmit.onclick = function() {
                var answer = clarifyInput.value || '';
                ws.send(JSON.stringify({ jsonrpc: '2.0', id: String(++msgId), method: 'clarify.respond', params: { text: answer } }));
                clarifyDiv.style.opacity = '0.5';
                clarifyInput.disabled = true;
                clarifySubmit.disabled = true;
                questionSpan.textContent = '\u2753 ' + p.prompt + '\n\u2192 ' + answer;
              };
              clarifyInput.onkeydown = function(e) { if (e.key === 'Enter') clarifySubmit.click(); };
              clarifyRow.appendChild(clarifyInput);
              clarifyRow.appendChild(clarifySubmit);
              clarifyDiv.appendChild(clarifyRow);
              msgsEl.appendChild(clarifyDiv);
              msgsEl.scrollTop = msgsEl.scrollHeight;
              clarifyInput.focus();
            }
            break;
        }
      } else if (msg.id && msg.result) {
        var r = msg.result;
          if (msg.id === sessionListId) {
            sessionListId = null;
            allSessions = r.sessions || [];
            populateSessionPicker(allSessions, dbSessionId);
          } else if (r.session_id) {
          if (msg.id === resumePendingId) resumePendingId = null;
          if (msg.id === savedResumeId) savedResumeId = null;
          if (msg.id === createRequestId) createRequestId = null;
          sessionId = r.session_id;
          dbSessionId = r.resumed || r.stored_session_id || r.session_id;
          localStorage.setItem('hdc_sid', dbSessionId);
          switchingSession = false;
          pendingSessionId = null;
          ready = true;
          if (inpEl) { inpEl.disabled = false; inpEl.focus(); }
          if (sendBtn) sendBtn.disabled = false;
          setSending(false);

          if (r.messages && r.messages.length > 0) {
            displayHistory(r.messages);
            var label = r.resumed ? '\u5df2\u6062\u590d\u4e0a\u6b21\u4f1a\u8bdd' : '\u5c31\u7eea';
            if (statusEl) { statusEl.textContent = label + ' \u2014 \u5f00\u59cb\u5bf9\u8bdd\u5427'; statusEl.style.color = 'var(--hdc-fg-dim)'; }
          } else {
            showIntro(r.info || null);
            if (statusEl) { statusEl.textContent = '\u5c31\u7eea \u2014 \u5f00\u59cb\u5bf9\u8bdd\u5427'; statusEl.style.color = 'var(--hdc-fg-dim)'; }
          }
          if (sessionPicker) {
            var pickId = dbSessionId;
            var found = false;
            for (var pi = 0; pi < sessionPicker.options.length; pi++) {
              if (sessionPicker.options[pi].value === pickId) {
                sessionPicker.options[pi].selected = true;
                found = true;
                break;
              }
            }
            if (!found) {
              var newOpt = document.createElement('option');
              newOpt.value = pickId;
              newOpt.textContent = r.title || r.preview || '\u65b0\u4f1a\u8bdd';
              newOpt.selected = true;
              // 插入到第一个 option 后面（跳过可能的分隔符）
              if (sessionPicker.firstChild) {
                sessionPicker.insertBefore(newOpt, sessionPicker.firstChild.nextSibling);
              } else {
                sessionPicker.appendChild(newOpt);
              }
            }
          }
          // 恢复会话后刷新列表
          if (r.resumed) {
            requestSessionList();
          }
        }
      } else if (msg.id && msg.error) {
          var errMsg = msg.error.message || '';
          if (msg.id === savedResumeId) {
            savedResumeId = null;
            if (statusEl) statusEl.textContent = '\u6b63\u5728\u67e5\u8be2\u6700\u8fd1\u4f1a\u8bdd...';
            requestSessionList();
          } else if (msg.id === resumePendingId) {
            resumePendingId = null;
            if (statusEl) statusEl.textContent = '\u6b63\u5728\u67e5\u8be2\u6700\u8fd1\u4f1a\u8bdd...';
            requestSessionList();
          } else if (!ready) {
            if (statusEl) statusEl.textContent = '\u6b63\u5728\u67e5\u8be2\u6700\u8fd1\u4f1a\u8bdd...';
            requestSessionList();
          } else if (errMsg.indexOf('session not found') >= 0) {
            addMsg('\u4f1a\u8bdd\u5df2\u5931\u6548\uff0c\u6b63\u5728\u67e5\u8be2\u6700\u8fd1\u4f1a\u8bdd...', 'sys');
            ready = false;
            if (statusEl) statusEl.textContent = '\u6b63\u5728\u67e5\u8be2\u6700\u8fd1\u4f1a\u8bdd...';
            requestSessionList();
          } else if (errMsg.indexOf('busy') >= 0) {
            addMsg('AI \u6b63\u5728\u5fd9\u788c\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5', 'sys');
            setSending(false);
          } else {
            addMsg('\u9519\u8bef: ' + errMsg, 'err');
            setSending(false);
          }
        }
    };
  }

  // ── History display ─────────────────────────────────────────────────
  function displayHistory(messages) {
    if (!msgsEl) return;
    var MAX_HISTORY = 60;
    var startIdx = 0;
    if (messages.length > MAX_HISTORY) {
      startIdx = messages.length - MAX_HISTORY;
    }
    var frag = document.createDocumentFragment();
    if (startIdx > 0) {
      var hint = document.createElement('div');
      hint.style.cssText = 'text-align:center;color:var(--hdc-fg-dim);font-size:12px;padding:8px 0;margin-bottom:8px;border-bottom:1px solid var(--hdc-border)';
      hint.textContent = '\u2191 \u7701\u7565\u4e86\u524d ' + startIdx + ' \u6761\u6d88\u606f\uff0c\u4ec5\u663e\u793a\u6700\u8fd1 ' + MAX_HISTORY + ' \u6761';
      frag.appendChild(hint);
    }
    for (var i = startIdx; i < messages.length; i++) {
      var m = messages[i];
      var roleType = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'bot' : 'sys';
      var text = m.rendered || m.text || m.content || '';
      if (!text) continue;
      var div = document.createElement('div');
      div.style.cssText =
        'max-width:88%;padding:10px 14px;border-radius:12px;font-size:14px;' +
        'line-height:1.65;word-break:break-word;margin-bottom:8px;';
      if (roleType === 'user') {
        div.className = 'hdc-msg-user';
        div.style.cssText += 'align-self:flex-end;background:transparent;border:1px solid var(--hdc-accent);margin-left:auto;color:var(--hdc-fg);white-space:pre-wrap;';
        div.textContent = text;
      } else if (roleType === 'bot') {
        div.className = 'hdc-msg-bot';
        div.style.cssText += 'align-self:flex-start;background:transparent;border:1px solid var(--hdc-border);color:var(--hdc-fg);';
        if (m.rendered) { div.innerHTML = m.rendered; } else { div.innerHTML = renderMarkdown(text); }
      } else {
        div.style.cssText += 'align-self:flex-start;background:transparent;border-left:3px solid var(--hdc-accent);font-size:12px;color:var(--hdc-fg-dim);max-width:85%;padding:4px 10px;white-space:pre-wrap;';
        div.textContent = text;
      }
      frag.appendChild(div);
    }
    msgsEl.appendChild(frag);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // ── Input Dialog ────────────────────────────────────────────────────
  function showInputDialog(title, defaultValue, callback) {
    var dlg = document.getElementById('hdc-input-dialog');
    var inp = document.getElementById('hdc-input-dialog-input');
    var titleEl = document.getElementById('hdc-input-dialog-title');
    var okBtn = document.getElementById('hdc-input-dialog-ok');
    var cancelBtn = document.getElementById('hdc-input-dialog-cancel');
    if (!dlg || !inp) { var r = prompt(title, defaultValue || ''); if (callback) callback(r); return; }
    titleEl.textContent = title;
    inp.value = defaultValue || '';
    dlg.style.display = 'flex';
    setTimeout(function() { inp.focus(); inp.select(); }, 50);
    function cleanup() {
      dlg.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      inp.onkeydown = null;
    }
    okBtn.onclick = function() { var v = inp.value; cleanup(); if (callback) callback(v); };
    cancelBtn.onclick = function() { cleanup(); if (callback) callback(null); };
    inp.onkeydown = function(e) {
      if (e.key === 'Enter') { var v = inp.value; cleanup(); if (callback) callback(v); }
      else if (e.key === 'Escape') { cleanup(); if (callback) callback(null); }
    };
  }

  function showConfirmDialog(title, callback) {
    var dlg = document.getElementById('hdc-input-dialog');
    var inp = document.getElementById('hdc-input-dialog-input');
    var titleEl = document.getElementById('hdc-input-dialog-title');
    var okBtn = document.getElementById('hdc-input-dialog-ok');
    var cancelBtn = document.getElementById('hdc-input-dialog-cancel');
    if (!dlg) { var r = confirm(title); if (callback) callback(r); return; }
    titleEl.textContent = title;
    inp.style.display = 'none';
    dlg.style.display = 'flex';
    function cleanup() {
      dlg.style.display = 'none';
      inp.style.display = '';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
    }
    okBtn.onclick = function() { cleanup(); if (callback) callback(true); };
    cancelBtn.onclick = function() { cleanup(); if (callback) callback(false); };
  }

  // ── Messages ────────────────────────────────────────────────────────
  function addMsg(text, type, streaming, isHtml) {
    if (!msgsEl) return null;
    if (emptyEl) { emptyEl.remove(); emptyEl = null; }

    var div = document.createElement('div');
    div.style.cssText =
      'max-width:88%;padding:10px 14px;border-radius:12px;font-size:14px;' +
      'line-height:1.65;word-break:break-word;margin-bottom:8px;' +
      'animation:hdcFadeIn .2s ease;';

    if (type === 'user') {
      div.className = 'hdc-msg-user';
      div.style.cssText += 'align-self:flex-end;border:1px solid var(--hdc-accent);margin-left:auto;white-space:pre-wrap;color:var(--hdc-fg);';
    } else if (type === 'bot') {
      div.className = 'hdc-msg-bot';
      div.style.cssText += 'align-self:flex-start;color:var(--hdc-fg);';
      if (streaming) div.classList.add('hdc-stream');
      if (!streaming && !isHtml) div.style.cssText += 'white-space:pre-wrap;';
    } else if (type === 'sys') {
      div.style.cssText += 'align-self:flex-start;background:transparent;border-left:3px solid var(--hdc-accent);font-size:12px;color:var(--hdc-fg-dim);max-width:85%;padding:4px 10px;white-space:pre-wrap;';
    } else if (type === 'warn') {
      div.style.cssText += 'align-self:flex-start;background:transparent;border-left:3px solid var(--hdc-accent);font-size:12px;color:var(--hdc-fg-dim);max-width:85%;padding:4px 10px;white-space:pre-wrap;';
    } else if (type === 'err') {
      div.style.cssText += 'align-self:flex-start;background:rgba(200,68,78,0.1);border-left:3px solid #c8444e;font-size:12px;color:' + T.red + ';max-width:85%;padding:6px 10px;white-space:pre-wrap;';
    }

    if (isHtml) {
      div.innerHTML = text;
    } else {
      div.textContent = text;
    }

    // AI 回复引用标注：检测消息中是否包含附件文件引用
    if (type === 'bot' && !streaming) {
      var noteRefs = [];
      var checkText = isHtml ? text : div.textContent || '';
      // 匹配 <file name="..."> 或 <attached_files 标签
      var fileMatch = checkText.match(/<file\s+name="([^"]+)"/g);
      if (fileMatch) {
        for (var fmi = 0; fmi < fileMatch.length; fmi++) {
          var m = fileMatch[fmi].match(/<file\s+name="([^"]+)"/);
          if (m && m[1]) {
            var n = m[1].replace(/\.md$/i, '');
            if (noteRefs.indexOf(n) < 0) noteRefs.push(n);
          }
        }
      }
      var attachedMatch = checkText.match(/<attached_files\s+count="(\d+)"/);
      if (attachedMatch && attachedMatch[1]) {
        var count = parseInt(attachedMatch[1]);
        if (count > 0 && noteRefs.length === 0) {
          noteRefs.push(count + ' \u7bc7\u7b14\u8bb0');
        }
      }
      if (noteRefs.length > 0) {
        var refTag = document.createElement('div');
        refTag.style.cssText = 'margin-top:6px;font-size:11px;color:var(--hdc-fg-dim);border-top:1px solid var(--hdc-border);padding-top:4px;';
        refTag.textContent = '\u57fa\u4e8e ' + noteRefs.length + ' \u7bc7\u7b14\u8bb0\u56de\u7b54';
        div.appendChild(refTag);
      }
    }

    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  // ── Session picker ──────────────────────────────────────────────────
  function clearMessages() {
    if (!msgsEl) return;
    msgsEl.innerHTML = '';
    emptyEl = document.createElement('div');
    emptyEl.id = 'hdc-empty';
    emptyEl.style.cssText = 'text-align:center;color:var(--hdc-fg-dim);padding:80px 20px';
    emptyEl.innerHTML =
      '<div style="color:var(--hdc-accent);font-size:28px;margin-bottom:14px">\u2624</div>' +
      '<div>\u6b63\u5728\u52a0\u8f7d...</div>';
    msgsEl.appendChild(emptyEl);
    currentBotBubble = null;
    streamAccum = '';
    reasoningEl = null;
    introShown = false;
    thinkingEl = null;
    reasoningText = '';
    introShown = false;
    pendingBotMsgs = [];
    if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }
  }

  function populateSessionPicker(sessions, currentSid) {
      if (!sessionPicker) return;
      var pickId = dbSessionId || currentSid;
      sessionPicker.innerHTML = '';

      var activeSessions = [];
      var lastUsedSession = null;
      var nowSec = Date.now() / 1000;
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var lastAct = s.last_active || s.started_at || 0;
        var isActive = !s.ended_at && (nowSec - lastAct) < 300;
        if (isActive) {
          activeSessions.push(s);
        } else if (!lastUsedSession) {
          // 找到第一个非活跃会话作为最近使用（包括已结束的和超过 5 分钟的）
          lastUsedSession = s;
        }
      }

      function addOption(s, prefix) {
        var title = (prefix || '') + (s.title || s.preview || s.id);
        if (title.length > 50) title = title.slice(0, 50) + '\u2026';
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = title;
        if (s.id === pickId) opt.selected = true;
        sessionPicker.appendChild(opt);
      }

      if (activeSessions.length > 0) {
        var sep1 = document.createElement('option');
        sep1.disabled = true;
        sep1.textContent = '\u2500\u2500 \u6d3b\u8dc3\u4f1a\u8bdd (' + activeSessions.length + ') \u2500\u2500';
        sep1.style.cssText = 'color:var(--hdc-accent);font-weight:600;font-size:11px';
        sessionPicker.appendChild(sep1);
        for (var i = 0; i < activeSessions.length; i++) {
          addOption(activeSessions[i], '\u25cf ');
        }
      }

      if (lastUsedSession) {
        var sep2 = document.createElement('option');
        sep2.disabled = true;
        sep2.textContent = '\u2500\u2500 \u6700\u8fd1\u4f7f\u7528 \u2500\u2500';
        sep2.style.cssText = 'color:var(--hdc-fg-dim);font-size:11px';
        sessionPicker.appendChild(sep2);
        addOption(lastUsedSession, '');
      }

      if (sessions.length === 0) {
        var opt2 = document.createElement('option');
        opt2.value = '';
        opt2.textContent = '\u65e0\u5386\u53f2\u4f1a\u8bdd';
        sessionPicker.appendChild(opt2);
      }
    }

  function onSessionChange() {
      if (!sessionPicker) return;
      var sid = sessionPicker.value;
      if (!sid || sid === dbSessionId) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      switchingSession = true;
      pendingSessionId = sid;
      clearMessages();
      setSending(false);
      ready = false;
      if (statusEl) { statusEl.textContent = '\u6b63\u5728\u5207\u6362\u4f1a\u8bdd...'; statusEl.style.color = 'var(--hdc-fg-dim)'; }
      resumePendingId = String(++msgId);
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: resumePendingId,
        method: 'session.resume',
        params: { session_id: sid }
      }));
    }

  function doNewSession() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (createRequestId) {
      return;
    }
    switchingSession = true;
    pendingSessionId = null;
    clearMessages();
    setSending(false);
    ready = false;
    if (statusEl) { statusEl.textContent = '\u6b63\u5728\u521b\u5efa\u65b0\u4f1a\u8bdd...'; statusEl.style.color = 'var(--hdc-fg-dim)'; }
    createRequestId = String(++msgId);
    ws.send(JSON.stringify({
      jsonrpc: '2.0', id: createRequestId,
      method: 'session.create',
      params: {}
    }));
  }

  // ── Profile sidebar ──────────────────────────────────────────────────
  // ── Send ────────────────────────────────────────────────────────────
  function flushPendingBotMsgs() {
    if (pendingBotMsgs.length === 0) return;
    var combined = '';
    for (var i = 0; i < pendingBotMsgs.length; i++) {
      var m = pendingBotMsgs[i];
      if (m.rendered) {
        combined += (i > 0 ? '\n\n' : '') + m.rendered;
      } else if (m.text) {
        combined += (i > 0 ? '\n\n' : '') + m.text;
      }
    }
    pendingBotMsgs = [];
    pendingBotTimer = null;
    if (combined) {
      addMsg(renderMarkdown(combined), 'bot', false, true);
    }
    setSending(false);
    if (inpEl) inpEl.focus();
    if (statusEl) {
      updateStatusDisplay();
    }
  }

  var _titleFlashTimer = null;
  var _origTitle = '';

  function notifyReplyDone() {
    // Only notify if overlay is not visible
    if (ovl && ovl.style.display !== 'none') return;
    // Flash title
    if (!_origTitle) _origTitle = document.title;
    var flash = true;
    var count = 0;
    if (_titleFlashTimer) clearInterval(_titleFlashTimer);
    _titleFlashTimer = setInterval(function() {
      document.title = flash ? '\u2728 AI \u56de\u590d\u5b8c\u6210' : _origTitle;
      flash = !flash;
      count++;
      if (count > 12) {
        clearInterval(_titleFlashTimer);
        _titleFlashTimer = null;
        document.title = _origTitle;
      }
    }, 600);
    // Stop flashing when user focuses window
    var onFocus = function() {
      if (_titleFlashTimer) { clearInterval(_titleFlashTimer); _titleFlashTimer = null; }
      document.title = _origTitle;
      window.removeEventListener('focus', onFocus);
    };
    window.addEventListener('focus', onFocus);
    // System notification (silent) - only if already granted
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('AI \u56de\u590d\u5b8c\u6210', { silent: true }); } catch(e) {}
    }
  }

  function setSending(on) {
    var wasSending = sending;
    sending = on;
    if (sendBtn) sendBtn.disabled = on;
    if (on) {
      if (stopBtn) stopBtn.style.display = '';
    } else {
      if (stopBtn) stopBtn.style.display = 'none';
      // Notify when AI reply completes
      if (wasSending) notifyReplyDone();
    }
  }

  function doStop() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
    pendingBotMsgs = [];
    if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }
    ws.send(JSON.stringify({
      jsonrpc: '2.0', id: String(++msgId),
      method: 'session.interrupt',
      params: { session_id: sessionId }
    }));
    setSending(false);
    if (statusEl) { statusEl.textContent = '\u5df2\u505c\u6b62'; statusEl.style.color = 'var(--hdc-fg-dim)'; }
  }

  // ── 自动引用知识库 ──────────────────────────────────────────────────
  
  function getObsidianVaultPath() {
    // 尝试从全局变量获取
    if (window.__OBSIDIAN_VAULT__ && typeof window.__OBSIDIAN_VAULT__ === 'string') {
      return window.__OBSIDIAN_VAULT__;
    }
    // 尝试从现有的 Obsidian 模块获取
    if (typeof window._obsidianVaultPath === 'string') {
      return window._obsidianVaultPath;
    }
    // 尝试从 localStorage 获取缓存的路径
    try {
      var cached = localStorage.getItem('hdc_obsidian_vault');
      if (cached) return cached;
    } catch(e) {}
    return null;
  }

  // 统一更新状态栏显示
  function updateStatusDisplay() {
    if (!statusEl) return;
    var vaultPath = getObsidianVaultPath();
    var kbStatus = '';
    if (window._autoKbEnabled) {
      kbStatus = '[AutoKB] vault: ' + (vaultPath || '未设置');
      if (!_embeddingIndexBuilt) {
        kbStatus += ' (索引构建中...)';
      } else {
        kbStatus += ' (语义搜索已启用)';
      }
    }
    statusEl.textContent = '就绪' + (kbStatus ? ' | ' + kbStatus : '');
    statusEl.style.color = 'var(--hdc-fg-dim)';
  }

  // ── 语义搜索参数 ─────────────────────────────────────────────────────
  var _embeddingIndexBuilt = false;  // 是否已构建向量索引

  // ── 向量搜索（Embedding）──────────────────────────────────────────────
  
  // 构建向量索引（后台异步，不阻塞用户）
  function buildEmbeddingIndex(onDone) {
    var vaultPath = getObsidianVaultPath();
    if (!vaultPath) {
      console.log('[AutoKB] Embedding: vault 路径未设置');
      onDone(false);
      return;
    }
    console.log('[AutoKB] Embedding: 开始构建索引（后台异步）...');
    if (statusEl) {
      statusEl.textContent = '[AutoKB] 正在后台构建向量索引...';
      statusEl.style.color = 'var(--hdc-accent)';
    }
    rpcCall('embedding.build_index', { vault_path: vaultPath }, function(r) {
      if (r.error) {
        console.log('[AutoKB] Embedding: 构建索引失败', r.error.message);
        updateStatusDisplay();
        onDone(false);
      } else {
        console.log('[AutoKB] Embedding: 索引构建完成', r.count, '个文件');
        _embeddingIndexBuilt = true;
        updateStatusDisplay();
        onDone(true);
      }
    });
    // 立即返回，不等待构建完成
    onDone(false);
  }
  // 暴露为全局函数，供 _obsidian_vault.js 调用
  window.buildEmbeddingIndex = buildEmbeddingIndex;

  // ── 查询预处理（相对时间转换）──────────────────────────────────────────
  
  // 将相对时间转换为具体年份/月份
  function preprocessQuery(query) {
    var now = new Date();
    var currentYear = now.getFullYear();
    var currentMonth = now.getMonth() + 1; // 1-12
    
    // 相对时间映射
    var timeMappings = {
      '去年': String(currentYear - 1),
      '今年': String(currentYear),
      '前年': String(currentYear - 2),
      '上个月': currentYear + '-' + String(currentMonth - 1 || 12).padStart(2, '0'),
      '这个月': currentYear + '-' + String(currentMonth).padStart(2, '0'),
      '去年这个时候': String(currentYear - 1),
      '去年年底': String(currentYear - 1) + '-12',
      '去年年初': String(currentYear - 1) + '-01',
      '今年年初': String(currentYear) + '-01',
      '今年年底': String(currentYear) + '-12',
    };
    
    // 替换相对时间
    var processedQuery = query;
    for (var timeWord in timeMappings) {
      if (query.indexOf(timeWord) >= 0) {
        processedQuery = processedQuery.replace(timeWord, timeMappings[timeWord] + ' ' + timeWord);
        console.log('[AutoKB] 查询预处理: "' + timeWord + '" → "' + timeMappings[timeWord] + '"');
      }
    }
    
    return processedQuery;
  }

  // 使用向量索引搜索
  function searchEmbeddingIndex(query, onDone) {
    // 查询预处理：将相对时间转换为具体年份
    var processedQuery = preprocessQuery(query);
    console.log('[AutoKB] Embedding: 开始向量搜索...');
    console.log('[AutoKB] Embedding: 原始查询:', query);
    console.log('[AutoKB] Embedding: 处理后:', processedQuery);
    
    rpcCall('embedding.query_index', { query: processedQuery, top_k: _autoKbMaxFiles }, function(r) {
      if (r.error) {
        console.log('[AutoKB] Embedding: 向量搜索失败', r.error.message);
        // 检查是否是模型加载中的错误
        if (r.error.message && r.error.message.indexOf('model loading') >= 0) {
          if (statusEl) {
            statusEl.textContent = '[AutoKB] 模型正在加载中，请稍候再试...';
            statusEl.style.color = 'var(--hdc-accent)';
          }
        }
        onDone([]);
      } else {
        var results = r.results || [];
        console.log('[AutoKB] Embedding: 向量搜索结果', results.length, '个');
        for (var i = 0; i < results.length; i++) {
          var chunkInfo = results[i].chunkTotal > 1 ? 
            ' [chunk ' + (results[i].chunkIdx + 1) + '/' + results[i].chunkTotal + ']' : '';
          console.log('[AutoKB] Embedding: ', results[i].fileName, chunkInfo, '相似度:', results[i].similarity.toFixed(3));
        }
        onDone(results);
      }
    });
  }

  // ── 语义搜索（Embedding）──────────────────────────────────────────
  
  // 语义搜索：只使用向量搜索，返回匹配的 chunk 片段
  function searchSemantic(filePaths, originalQuery, onDone) {
    console.log('[AutoKB] Semantic: 开始语义搜索...');
    console.log('[AutoKB] Semantic: 原始查询:', originalQuery);
    
    // 如果向量索引不可用，不进行搜索
    if (!_embeddingIndexBuilt) {
      console.log('[AutoKB] Semantic: 向量索引未构建，跳过搜索');
      console.log('[AutoKB] Semantic: 请等待向量索引构建完成后再发送消息');
      onDone([]);
      return;
    }
    
    // 向量搜索（使用原始查询，语义搜索需要完整句子）
    searchEmbeddingIndex(originalQuery, function(results) {
      if (!results || results.length === 0) {
        console.log('[AutoKB] Semantic: 无匹配结果');
        onDone([]);
        return;
      }
      
      // 过滤低相似度结果（使用相对阈值）
      var MIN_SIMILARITY = 0.55;  // 最低绝对相似度阈值（提高，避免短查询误触发）
      var RELATIVE_THRESHOLD = 0.10;  // 与最高分的最小差距（相对阈值）
      
      // 找出最高相似度
      var maxSimilarity = 0;
      for (var i = 0; i < results.length; i++) {
        if (results[i].similarity > maxSimilarity) {
          maxSimilarity = results[i].similarity;
        }
      }
      
      // 返回匹配的 chunk 片段（包含内容，不再需要读取整个文件）
      var matchedChunks = [];
      for (var i = 0; i < results.length && i < _autoKbMaxFiles; i++) {
        var sim = results[i].similarity;
        var diff = maxSimilarity - sim;
        
        // 必须同时满足：绝对阈值 + 与最高分差距不超过阈值
        if (sim >= MIN_SIMILARITY && diff <= RELATIVE_THRESHOLD) {
          var chunkInfo = results[i].chunkTotal > 1 ? 
            ' [片段 ' + (results[i].chunkIdx + 1) + '/' + results[i].chunkTotal + ']' : '';
          console.log('[AutoKB] Semantic: ', results[i].fileName, chunkInfo, '相似度:', sim.toFixed(3), '差距:', diff.toFixed(3));
          matchedChunks.push({
            path: results[i].path,
            fileName: results[i].fileName,
            content: results[i].chunkText || '',
            chunkIdx: results[i].chunkIdx || 0,
            chunkTotal: results[i].chunkTotal || 1,
            charStart: results[i].charStart || 0,
            charEnd: results[i].charEnd || 0,
            similarity: sim
          });
        } else {
          console.log('[AutoKB] Semantic: 跳过', results[i].fileName, '相似度:', sim.toFixed(3), '差距:', diff.toFixed(3));
        }
      }
      
      console.log('[AutoKB] Semantic: 最终匹配', matchedChunks.length, '个片段（最高分:', maxSimilarity.toFixed(3), '，相对阈值:', RELATIVE_THRESHOLD, '）');
      onDone(matchedChunks);
    });
  }

  function rpcCall(method, params, callback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { if (callback) callback({ error: 'WebSocket not open' }); return; }
    var rid = String(++msgId);
    _rpcCallbacks[rid] = callback || function(){};
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method: method, params: params || {} }));
  }

  function listDirRecursive(dirPath, onDone, maxDepth) {
    maxDepth = maxDepth || 3; // 限制搜索深度，避免搜索整个 vault
    // 统一路径格式为 / 格式
    dirPath = dirPath.replace(/\\/g, '/');
    var allFiles = [];
    var pending = 1;
    var searchedDirs = 0;
    function checkDone() {
      pending--;
      if (pending === 0) {
        console.log('[AutoKB] 递归搜索完成，搜索了', searchedDirs, '个目录，找到', allFiles.length, '个 .md 文件');
        onDone(allFiles);
      }
    }
    function walk(dir, depth) {
      depth = depth || 0;
      if (depth >= maxDepth) {
        console.log('[AutoKB] 达到最大深度', maxDepth, '，跳过', dir);
        checkDone();
        return;
      }
      pending++;
      searchedDirs++;
      // 使用 obsidian.list_files RPC 方法，确保路径格式一致
      rpcCall('obsidian.list_files', { path: dir }, function(r) {
        console.log('[AutoKB] obsidian.list_files result:', dir, r.error ? 'error: ' + r.error.message : (r.items ? r.items.length + ' items' : 'no items'));
        if (r.error || !r.items) { checkDone(); return; }
        var entries = r.items;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          var fp = e.path; // obsidian.list_files 已经返回完整路径，格式为 /
          if (e.is_dir) {
            walk(fp, depth + 1);
          } else if (/\.md$/i.test(e.name)) {
            allFiles.push(fp);
          }
        }
        checkDone();
      });
    }
    walk(dirPath, 0);
    checkDone();
  }

  function searchVaultFiles(originalQuery, onDone) {
    var vaultPath = getObsidianVaultPath();
    console.log('[AutoKB] searchVaultFiles - vaultPath:', vaultPath);
    if (!vaultPath) {
      console.log('[AutoKB] vault 路径未设置，无法搜索');
      onDone([]);
      return;
    }
    console.log('[AutoKB] 开始递归搜索 vault:', vaultPath);
    listDirRecursive(vaultPath, function(files) {
      console.log('[AutoKB] 找到 .md 文件:', files.length, '个');
      // 使用语义搜索（向量搜索）
      searchSemantic(files, originalQuery, onDone);
    });
  }

  function readFilesAndAttach(filePaths, onDone) {
    if (filePaths.length === 0) { onDone([]); return; }
    var results = [];
    var pending = filePaths.length;
    function checkDone() {
      pending--;
      if (pending === 0) onDone(results);
    }
    for (var i = 0; i < filePaths.length; i++) {
      (function(fp) {
        rpcCall('fs.read_file', { path: fp }, function(r) {
          if (!r.error && r.content) {
            var content = String(r.content);
            if (content.length > _autoKbMaxChars) content = content.substring(0, _autoKbMaxChars) + '\n... (truncated)';
            results.push({ path: fp, content: content });
          }
          checkDone();
        });
      })(filePaths[i]);
    }
  }

  function _doSendInternal(text, extraAttachments, quotedNames) {
    var context = '';
    var allAttachments = attachments.concat(extraAttachments || []);
    if (allAttachments.length > 0) {
      var parts = [];
      var folderParts = [];
      var fileParts = [];
      for (var i = 0; i < allAttachments.length; i++) {
        var att = allAttachments[i];
        if (att.type === 'folder' && att.folderPath) {
          var folderName = att.folderPath.split(/[\\/]/).pop() || att.title || '';
          folderParts.push('<folder name="' + hdcEscape(folderName) + '" path="' + hdcEscape(att.folderPath) + '" />');
        } else if (att.type === 'snippet' && att.content) {
          var snippetPath = att.filePath || att.fileName || '';
          var pathAttr = snippetPath ? ' path="' + hdcEscape(snippetPath) + '"' : '';
          fileParts.push('\n<file name="' + hdcEscape(att.fileName) + '"' + pathAttr + ' lines="' + att.startLine + '-' + att.endLine + '">\n```' + att.lang + '\n' + att.content + '\n```\n</file>');
        } else if (att.type === 'file' && att.content) {
          var fileName = att.filePath ? att.filePath.split(/[\\/]/).pop() : att.fileName || '';
          fileParts.push('\n<file name="' + hdcEscape(fileName) + '" path="' + hdcEscape(att.filePath) + '">\n```' + att.lang + '\n' + att.content + '\n```\n</file>');
        } else if (att.type === 'file' && att.filePath) {
          var refName = att.filePath.split(/[\\/]/).pop() || att.fileName || '';
          fileParts.push('<file name="' + hdcEscape(refName) + '" path="' + hdcEscape(att.filePath) + '" note="\u65e0\u6cd5\u52a0\u8f7d\u6587\u4ef6\u5185\u5bb9" />');
        }
      }
      if (folderParts.length > 0) {
        parts.push('\n<attached_folders count="' + folderParts.length + '">\n' + folderParts.join('\n') + '\n</attached_folders>');
      }
      if (fileParts.length > 0) {
        parts.push('\n<attached_files count="' + fileParts.length + '">\n' + fileParts.join('\n') + '\n</attached_files>');
      }
      if (parts.length) context = '\n\nThe user has attached the following content directly in this message. Do NOT use read_file or any other tool to re-read these files - the full content is already provided below:\n' + parts.join('\n');
    }
    var fullText = text + context;
    var displayText = text;
    if (quotedNames && quotedNames.length > 0) {
      displayText += ' \ud83d\udcda \u5f15\u7528\u4e86' + quotedNames.map(function(n) { return '\u300a' + n + '\u300b'; }).join('');
    }
    addMsg(displayText + (allAttachments.length > 0 ? ' \u200b[' + allAttachments.length + '\u4e2a\u9644\u4ef6]' : ''), 'user');
    if (text && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== text)) {
      inputHistory.push(text);
      if (inputHistory.length > 100) inputHistory.shift();
    }
    historyIdx = -1;
    historyDraft = '';
    inpEl.value = '';
    inpEl.style.height = 'auto';
    attachments = [];
    if (_renderAttachmentsFn) _renderAttachmentsFn();
    setSending(true);
    if (statusEl) { statusEl.textContent = 'AI \u6b63\u5728\u601d\u8003...'; statusEl.style.color = 'var(--hdc-fg-dim)'; }
    ws.send(JSON.stringify({
      jsonrpc: '2.0', id: String(++msgId),
      method: 'prompt.submit',
      params: { text: fullText, session_id: sessionId }
    }));
  }

  function doSend() {
    if (!inpEl) return;
    var text = inpEl.value.trim();
    if (!text) return;
    if (!ready) { if (statusEl) { statusEl.textContent = '\u7b49\u5f85\u8fde\u63a5\u5c31\u7eea...'; statusEl.style.color = 'var(--hdc-fg-dim)'; } return; }
    if (sending) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) { if (statusEl) { statusEl.textContent = '\u8fde\u63a5\u65ad\u5f00\uff0c\u6b63\u5728\u91cd\u8fde...'; statusEl.style.color = T.red; } return; }
    pendingBotMsgs = [];
    if (pendingBotTimer) { clearTimeout(pendingBotTimer); pendingBotTimer = null; }

    // 自动引用知识库流程（语义搜索）
    console.log('[AutoKB] doSend called, window._autoKbEnabled:', window._autoKbEnabled);
    if (window._autoKbEnabled) {
      // 短查询保护：少于 8 个字符的查询不触发语义搜索（避免"知道了""好的"等误触发）
      if (text.length < 8) {
        console.log('[AutoKB] 查询过短（' + text.length + ' 字符），跳过语义搜索');
        _doSendInternal(text, [], []);
        return;
      }
      if (statusEl) {
        statusEl.textContent = '[AutoKB] 正在语义搜索...';
        statusEl.style.color = 'var(--hdc-accent)';
      }
      var vaultPath = getObsidianVaultPath();
      console.log('[AutoKB] Vault路径:', vaultPath || '(未设置)');
      if (!vaultPath) {
        // 没有设置 vault 路径，显示提示
        if (statusEl) {
          statusEl.textContent = '[AutoKB] Vault路径未设置，请先激活Obsidian Vault';
          statusEl.style.color = T.red;
        }
        _doSendInternal(text, [], []);
        return;
      }
      searchVaultFiles(text, function(matchedChunks) {
        console.log('[AutoKB] 匹配片段:', matchedChunks.length, '个');
        if (statusEl) {
          statusEl.textContent = '[AutoKB] 找到 ' + matchedChunks.length + ' 个匹配片段';
          statusEl.style.color = matchedChunks.length > 0 ? 'var(--hdc-accent)' : 'var(--hdc-fg-dim)';
        }
        if (matchedChunks.length === 0) {
          _doSendInternal(text, [], []);
          return;
        }
        // 读取完整文件内容（不再只注入片段）
        var extraAttachments = [];
        var quotedNames = [];
        
        // 收集所有匹配的文件路径（按相似度排序后的前 top_k 个文件）
        var filesToRead = [];
        for (var i = 0; i < matchedChunks.length && i < _autoKbMaxFiles; i++) {
          if (matchedChunks[i].path) {
            filesToRead.push(matchedChunks[i]);
          }
        }
        
        // 如果使用了新的返回格式（包含 chunks），合并同一文件的所有信息
        var uniqueFiles = {};
        for (var i = 0; i < filesToRead.length; i++) {
          var chunk = filesToRead[i];
          var path = chunk.path;
          if (!uniqueFiles[path]) {
            uniqueFiles[path] = chunk;
            console.log('[AutoKB] 将读取完整文件:', path, '(匹配到', chunk.chunkCount || 1, '个相关片段)');
          }
        }
        
        // 读取所有文件的完整内容并构建附件
        var readCount = Object.keys(uniqueFiles).length;
        var attachmentsBuilt = [];
        
        for (var path in uniqueFiles) {
          var chunk = uniqueFiles[path];
          
          // 检查是否有完整的 chunkText，如果没有则需要读取文件
          if (chunk.content && chunk.chunkTotal === 1) {
            // 单 chunk 文件且已有内容，直接使用
            var name = chunk.fileName || (chunk.path.split(/[\\/]/).pop() || chunk.path);
            attachmentsBuilt.push({
              type: 'snippet',
              fileName: name,
              filePath: path,
              content: chunk.content,
              lang: 'markdown'
            });
            quotedNames.push(name.replace(/\.md$/i, ''));
          } else {
            // 多 chunk 或无内容，读取完整文件
            rpcCall('fs.read_file', { path: path }, function(r) {
              if (r.error) {
                console.log('[AutoKB] 读取文件失败:', path, r.error.message);
                return;
              }
              
              var name = chunk.fileName || (path.split(/[\\/]/).pop() || path);
              attachmentsBuilt.push({
                type: 'snippet',
                fileName: name + ' (' + (chunk.chunkCount || 'full') + ')',
                filePath: path,
                content: r.content,
                lang: 'markdown'
              });
              quotedNames.push(name.replace(/\.md$/i, ''));
              
              // 所有文件读取完成后发送
              if (attachmentsBuilt.length >= readCount) {
                if (statusEl) statusEl.textContent = '已注入 ' + attachmentsBuilt.length + ' 个相关文件';
                _doSendInternal(text, attachmentsBuilt, Array.from(new Set(quotedNames)));
              }
            });
          }
        }
        
        // 如果没有需要异步读取的，立即发送
        if (attachmentsBuilt.length === readCount && readCount > 0) {
          if (statusEl) statusEl.textContent = '已注入 ' + attachmentsBuilt.length + ' 个相关文件';
          _doSendInternal(text, attachmentsBuilt, Array.from(new Set(quotedNames)));
        } else if (readCount === 0) {
          _doSendInternal(text, [], []);
        }
      });
      return;
    }

    _doSendInternal(text, [], []);
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function hdcEscape(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── 通用右键菜单系统 ───────────────────────────────────────────────
  /**
   * 创建通用的右键菜单项HTML
   * @param {string} action - 操作标识
   * @param {string} icon - 图标
   * @param {string} label - 标签文本
   * @param {string} className - CSS类名 (可选: 'hdc-menu-item', 'hdc-menu-item-red', 'hdc-menu-item-dim')
   * @returns {string} HTML字符串
   */
  function createContextMenuOption(action, icon, label, className) {
    className = className || 'hdc-menu-item';
    return '<div data-action="' + action + '" class="' + className + '" style="padding:6px 16px;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'var(--hdc-muted)\'" onmouseout="this.style.background=\'transparent\'">' + icon + ' ' + label + '</div>';
  }

  /**
   * 创建标准的"发送AI"菜单项
   * @param {string} action - 操作标识 (如 'note-send-ai', 'clip-insert', 'stock-insert')
   * @returns {string} HTML字符串
   */
  function createSendAIContextMenuOption(action) {
    return createContextMenuOption(action, '\ud83d\udce8', '\u53d1\u9001AI');
  }

  // ── Bootstrap ───────────────────────────────────────────────────────
  function boot() {
    console.log('[Overlay] boot() called');
    showOverlay();
    autoNavigateToChat();
  }
  console.log('[Overlay] Registering boot()');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(boot, 100); });
  } else {
    setTimeout(boot, 100);
  }
  window.addEventListener('beforeunload', function() { if (dbSessionId) localStorage.setItem('hdc_sid', dbSessionId); });
})();
