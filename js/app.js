/**
 * 薬歴新規薬コピペ - UIロジック
 * parser.js(HTML解析)とdrug-headings.js(薬品名見出し判定・五十音順ソート)を
 * 使って、検索・薬品名一覧(あ行・か行…見出し付き)・プレビュー・コピーのUIを構築する。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'yakurekiShinkiyaku.headings.v1';
  var THEME_KEY = 'yakurekiShinkiyaku.theme.v1';
  var TEMPLATE_URL = 'data/template.html';

  var state = {
    headings: [],
    drugList: [],
    selectedName: null,
    filter: ''
  };

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      TemplateParser.applyEffectiveBlocks(parsed);
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function saveToStorage(headings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(headings));
      return true;
    } catch (err) {
      return false;
    }
  }

  var listEl = document.getElementById('headingList');
  var emptyEl = document.getElementById('emptyMessage');
  var searchInput = document.getElementById('searchInput');
  var statusEl = document.getElementById('statusMessage');
  var fileInput = document.getElementById('fileInput');
  var dropzone = document.getElementById('dropzone');
  var pasteInput = document.getElementById('htmlPasteInput');
  var pasteImportBtn = document.getElementById('pasteImportBtn');
  var updateArea = document.getElementById('updateArea');
  var detailPaneEl = document.getElementById('detailPane');
  var themeToggleBtn = document.getElementById('themeToggle');

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = 'status-message' + (kind ? ' status-' + kind : '');
  }

  function applyTheme(theme) {
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) { saved = null; }
    if (saved === 'dark' || saved === 'light') applyTheme(saved);
  })();

  themeToggleBtn.addEventListener('click', function () {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var current = document.documentElement.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* ignore: theme just won't persist */ }
  });

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // SOAP形式の見出しマーカー(##S##など)を色分けしたバッジ表示に変換する。
  var MARKER_CLASS_MAP = {
    '##S##': 'marker-s',
    '##O##': 'marker-o',
    '##A##': 'marker-a',
    '##EP##': 'marker-ep',
    '##OP##': 'marker-op'
  };

  function renderBlockHtml(text) {
    return text.split('\n').map(function (line) {
      var trimmed = line.trim();
      var markerClass = MARKER_CLASS_MAP[trimmed];
      if (markerClass) {
        return '<span class="marker-badge ' + markerClass + '">' + escapeHtml(trimmed) + '</span>';
      }
      return escapeHtml(line);
    }).join('\n');
  }

  function highlightMatch(title, query) {
    if (!query) return escapeHtml(title);
    var idx = title.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(title);
    return (
      escapeHtml(title.slice(0, idx)) +
      '<mark>' + escapeHtml(title.slice(idx, idx + query.length)) + '</mark>' +
      escapeHtml(title.slice(idx + query.length))
    );
  }

  function findHeading(id) {
    for (var i = 0; i < state.headings.length; i++) {
      if (state.headings[i].id === id) return state.headings[i];
    }
    return null;
  }

  // あ行・か行…見出しをパステルカラーで色分けするための行→CSSクラス対応表。
  var ROW_COLOR_CLASS = {
    'あ': 'row-a', 'か': 'row-ka', 'さ': 'row-sa', 'た': 'row-ta', 'な': 'row-na',
    'は': 'row-ha', 'ま': 'row-ma', 'や': 'row-ya', 'ら': 'row-ra', 'わ': 'row-wa'
  };

  function findDrug(bareName) {
    for (var i = 0; i < state.drugList.length; i++) {
      if (state.drugList[i].bareName === bareName) return state.drugList[i];
    }
    return null;
  }

  /**
   * 薬品エントリ(複数の見出しにまたがる可能性がある)から、実際にコピー対象と
   * なる「印刷可能ブロック」の配列を組み立てる。
   * - 通常(1文脈・1ブロック)の薬品はタイトル無しの1ブロックになる。
   * - 同じ見出し自身に本文が無く子孫に複数の用途分岐がある場合(例:タリージェの「（１）痛み」
   *   「（２）しびれ」)は、それぞれ子孫のタイトルをラベルにして分ける。
   * - 複数文脈(例:ロキソプロフェンの①②③)がある場合は、シナリオ区分ラベルを付けて分ける。
   */
  function collectPrintableBlocks(drug) {
    var out = [];
    drug.contexts.forEach(function (ctx) {
      var heading = findHeading(ctx.id);
      if (!heading) return;
      var blocks = heading.effectiveBlocks || [];
      if (blocks.length === 0) {
        if (heading.tooManyToAggregate) {
          out.push({ title: ctx.categoryLabel || ctx.title, block: null, tooManyToAggregate: true });
        }
        return;
      }
      blocks.forEach(function (b) {
        var parts = [];
        if (ctx.categoryLabel) parts.push(ctx.categoryLabel);
        if (blocks.length > 1) parts.push(b.title);
        out.push({ title: parts.join(' ▸ '), block: b.block, tooManyToAggregate: false });
      });
    });
    return out;
  }

  function buildDrugItemEl(drug, query) {
    var li = document.createElement('li');
    li.className = 'drug-item' + (state.selectedName === drug.bareName ? ' selected' : '');
    li.dataset.name = drug.bareName;

    var row = document.createElement('div');
    row.className = 'drug-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-pressed', state.selectedName === drug.bareName ? 'true' : 'false');
    row.dataset.action = 'select';
    row.innerHTML =
      '<span class="drug-title">' + highlightMatch(drug.bareName, query) + '</span>' +
      (drug.contexts.length > 1 ? '<span class="drug-context-badge">' + drug.contexts.length + '件</span>' : '');
    li.appendChild(row);

    return li;
  }

  // 選択中の薬品の内容(##S##〜##OP##ブロック)を右側の詳細パネルに描画する。
  function renderDetailPane() {
    detailPaneEl.innerHTML = '';

    var drug = state.selectedName ? findDrug(state.selectedName) : null;
    if (!drug) {
      var empty = document.createElement('p');
      empty.className = 'detail-empty';
      empty.textContent = '左の一覧から薬品名を選択すると、ここに内容が表示されます。';
      detailPaneEl.appendChild(empty);
      return;
    }

    var header = document.createElement('div');
    header.className = 'detail-header';
    header.innerHTML = '<span class="detail-title">' + escapeHtml(drug.bareName) + '</span>';
    detailPaneEl.appendChild(header);

    var blocks = collectPrintableBlocks(drug);

    if (blocks.length === 0) {
      var emptyPre = document.createElement('pre');
      emptyPre.className = 'preview-text';
      emptyPre.textContent = '(この薬品にはコピー対象の本文がありません)';
      detailPaneEl.appendChild(emptyPre);
      return;
    }

    blocks.forEach(function (b, i) {
      var blockWrap = document.createElement('div');
      blockWrap.className = 'preview-block';

      if (b.title) {
        var blockTitle = document.createElement('p');
        blockTitle.className = 'preview-block-title';
        blockTitle.textContent = b.title;
        blockWrap.appendChild(blockTitle);
      }

      if (b.tooManyToAggregate) {
        var tooMany = document.createElement('p');
        tooMany.className = 'preview-hint';
        tooMany.textContent = '(この項目の配下には内容が多数あるため、まとめて表示できません)';
        blockWrap.appendChild(tooMany);
        detailPaneEl.appendChild(blockWrap);
        return;
      }

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-btn';
      copyBtn.dataset.action = 'copy';
      copyBtn.dataset.blockIndex = String(i);
      copyBtn.textContent = 'コピー';
      blockWrap.appendChild(copyBtn);

      var pre = document.createElement('pre');
      pre.className = 'preview-text';
      pre.innerHTML = renderBlockHtml(b.block);
      blockWrap.appendChild(pre);

      detailPaneEl.appendChild(blockWrap);
    });

    // renderDetailPane()で使ったblocksをコピー処理でも使えるよう保持しておく
    detailPaneEl._printableBlocks = blocks;
  }

  function render() {
    var query = state.filter.trim();

    listEl.innerHTML = '';

    if (state.drugList.length === 0) {
      emptyEl.textContent = 'まだテンプレートが取り込まれていません。上の「更新」からHTMLファイルを取り込んでください。';
      return;
    }

    var filtered = query
      ? state.drugList.filter(function (d) { return d.bareName.toLowerCase().indexOf(query.toLowerCase()) !== -1; })
      : state.drugList;

    if (filtered.length === 0) {
      emptyEl.textContent = '「' + query + '」に一致する薬品名が見つかりません。';
      return;
    }
    emptyEl.textContent = '';

    var frag = document.createDocumentFragment();
    var lastRow = null;
    filtered.forEach(function (d) {
      if (!query) {
        var row = DrugHeadings.kanaRowFor(d.bareName);
        if (row && row !== lastRow) {
          var rowHeader = document.createElement('li');
          rowHeader.className = 'kana-row-header ' + (ROW_COLOR_CLASS[row] || '');
          rowHeader.textContent = row + '行';
          frag.appendChild(rowHeader);
          lastRow = row;
        }
      }
      frag.appendChild(buildDrugItemEl(d, query));
    });
    listEl.appendChild(frag);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('execCommand failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function selectDrug(bareName) {
    state.selectedName = state.selectedName === bareName ? null : bareName;
    render();
    renderDetailPane();
    if (state.selectedName && window.matchMedia('(max-width: 899px)').matches) {
      detailPaneEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  listEl.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action="select"]');
    if (!actionEl) return;
    var li = e.target.closest('.drug-item');
    if (!li) return;
    selectDrug(li.dataset.name);
  });

  listEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var actionEl = e.target.closest('[data-action="select"]');
    if (!actionEl) return;
    e.preventDefault();
    actionEl.click();
  });

  // コピー ボタン自体も1秒間だけ「コピーしました!」表示に変える(クリックした実感を持たせる)。
  function showCopyFeedback(btn) {
    if (btn._copyFeedbackTimer) {
      clearTimeout(btn._copyFeedbackTimer);
    } else {
      btn._copyFeedbackOriginalText = btn.textContent;
    }
    btn.textContent = 'コピーしました!✅';
    btn.classList.add('copy-btn-success');
    btn._copyFeedbackTimer = setTimeout(function () {
      btn.textContent = btn._copyFeedbackOriginalText;
      btn.classList.remove('copy-btn-success');
      btn._copyFeedbackTimer = null;
    }, 1000);
  }

  detailPaneEl.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action="copy"]');
    if (!actionEl) return;
    var blocks = detailPaneEl._printableBlocks || [];
    var blockIndex = Number(actionEl.dataset.blockIndex);
    var target = blocks[blockIndex];
    if (!target) return;
    copyText(target.block).then(function () {
      setStatus((target.title ? '「' + target.title + '」' : '「' + state.selectedName + '」') + 'の内容をコピーしました。', 'success');
      showCopyFeedback(actionEl);
    }).catch(function () {
      setStatus('コピーに失敗しました。お手数ですが、選択して手動でコピーしてください。', 'error');
    });
  });

  searchInput.addEventListener('input', function () {
    state.filter = searchInput.value;
    render();
  });

  function importHtml(htmlString, sourceLabel) {
    try {
      var headings = TemplateParser.parseTemplateHtml(htmlString);
      state.headings = headings;
      state.drugList = DrugHeadings.buildDrugList(headings);
      state.selectedName = null;
      state.filter = '';
      searchInput.value = '';
      render();
      renderDetailPane();
      updateArea.open = false;

      var saved = saveToStorage(headings);
      if (saved) {
        setStatus(sourceLabel + 'を取り込みました(薬品' + state.drugList.length + '件)。', 'success');
      } else {
        setStatus(sourceLabel + 'を取り込みましたが、保存に失敗しました(ブラウザのストレージ容量制限などが考えられます)。今回開いている間は利用できますが、次回は復元されません。', 'error');
      }
    } catch (err) {
      setStatus('取り込みに失敗しました: ' + err.message, 'error');
    }
  }

  function readFile(file) {
    var name = file.name || 'ファイル';
    if (!/\.html?$/i.test(name)) {
      setStatus('HTMLファイル(.html)を選択してください。', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      importHtml(String(reader.result), '「' + name + '」');
    };
    reader.onerror = function () {
      setStatus('ファイルの読み込みに失敗しました。', 'error');
    };
    reader.readAsText(file, 'UTF-8');
  }

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (file) readFile(file);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  });

  pasteImportBtn.addEventListener('click', function () {
    var text = pasteInput.value;
    if (!text.trim()) {
      setStatus('貼り付けるHTMLソースが空です。', 'error');
      return;
    }
    importHtml(text, '貼り付けたHTMLソース');
    pasteInput.value = '';
  });

  // 全端末で同じ内容を見られるよう、まずリポジトリに同梱された共有テンプレート
  // (data/template.html)を自動取得する。取得できない場合(オフライン・file://で
  // 直接開いた場合など)のみ、以前ブラウザに保存された内容にフォールバックする。
  (function restoreOnLoad() {
    setStatus('共有テンプレートを読み込み中…', null);
    fetch(TEMPLATE_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (html) {
        importHtml(html, '共有テンプレート');
      })
      .catch(function () {
        var restored = loadFromStorage();
        if (restored && restored.length) {
          state.headings = restored;
          state.drugList = DrugHeadings.buildDrugList(restored);
          setStatus('共有テンプレートを取得できなかったため、このブラウザに保存されていた内容を復元しました(薬品' + state.drugList.length + '件)。', 'error');
        } else {
          setStatus('共有テンプレートを取得できませんでした。オフラインの場合は接続を確認するか、下の「更新」からHTMLファイルを取り込んでください。', 'error');
        }
        render();
        renderDetailPane();
      });
  })();
})();
