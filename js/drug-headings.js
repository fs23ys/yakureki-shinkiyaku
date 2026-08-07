/**
 * 薬歴新規薬コピペ - 「薬品名見出し」判定・五十音順ソートロジック
 *
 * parser.js が返す見出し配列(id, level, title, block, effectiveBlocks, ...)を受け取り、
 * 「薬品名見出し」を判定して、薬品名ごとに1エントリへグルーピングし、
 * 五十音順にソートした一覧データを組み立てる。
 *
 * 判定ルール(Googleドキュメント側のフォーマット: H1=分類見出し(未使用・空タイトル)、
 * H2=薬品名、H3=同じ薬品の用途分岐(例:「（１）耳鼻科」「（２）痛み」)):
 *   タイトルが空でないH2見出しは、すべて薬品名見出しとする。
 *   H2自身に本文(##S##ブロック)が無く、配下のH3にのみ本文がある場合は、
 *   parser.js の applyEffectiveBlocks() が既にH3側の内容をeffectiveBlocksとして
 *   集約してくれるので、そのままH2を選択すればH3ごとの内容が分けて表示される。
 *
 * ブラウザ(<script src="js/drug-headings.js">)からは window.DrugHeadings として、
 * Node.js(テスト用)からは require('./drug-headings.js') として利用できる。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DrugHeadings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DRUG_HEADING_LEVEL = 2;

  // Googleドキュメント側にふりがな情報が無いため、Intl.Collator('ja')は
  // 漢字のみの薬品名を「読み」ではなくUnicode上の並びで判定してしまい、
  // 五十音順の意図した位置(例:「外用鎮痛塗布剤」は「が」の位置)からズレる。
  // 該当する薬品名が見つかるたびに、ここに読み(ひらがな)を手動で追加すること。
  var FURIGANA_OVERRIDES = {
    '外用鎮痛塗布剤': 'がいようちんつうとふざい'
  };

  var KANA_RE = /[぀-ゟ゠-ヿ]/;
  var KANJI_RE = /[一-鿿]/;

  /**
   * かな(ひらがな・カタカナ)を含まず漢字のみで構成される薬品名かどうか。
   * ふりがな未登録のままだと五十音順がズレるため、検知して警告する。
   */
  function isPureKanji(bareName) {
    return KANJI_RE.test(bareName) && !KANA_RE.test(bareName);
  }

  function sortKeyFor(bareName) {
    return FURIGANA_OVERRIDES[bareName] || bareName;
  }

  // 一覧の「あ行・か行…」見出し用: ひらがな1文字を五十音の行(あ・か・さ…わ)に
  // 対応させるテーブル。濁音・半濁音・拗音・促音は清音の行にまとめる。
  var KANA_ROWS = {
    'あ': 'あいうえおぁぃぅぇぉ',
    'か': 'かきくけこがぎぐげご',
    'さ': 'さしすせそざじずぜぞ',
    'た': 'たちつてとだぢづでどっ',
    'な': 'なにぬねの',
    'は': 'はひふへほばびぶべぼぱぴぷぺぽ',
    'ま': 'まみむめも',
    'や': 'やゆよゃゅょ',
    'ら': 'らりるれろ',
    'わ': 'わをんゐゑ'
  };
  var CHAR_TO_ROW = {};
  Object.keys(KANA_ROWS).forEach(function (row) {
    KANA_ROWS[row].split('').forEach(function (ch) { CHAR_TO_ROW[ch] = row; });
  });

  function toHiragana(ch) {
    var code = ch.codePointAt(0);
    if (code >= 0x30A1 && code <= 0x30F6) {
      return String.fromCodePoint(code - 0x60);
    }
    return ch;
  }

  // ツムラの漢方薬(例:「葛根湯（ツムラ1）」)は、名称の読みでの五十音順ではなく
  // 現場で使う「ツムラ番号」順に、一覧の一番下にまとめて表示する。
  var TSUMURA_RE = /ツムラ\s*(\d+)/;

  function isTsumura(bareName) {
    return TSUMURA_RE.test(bareName);
  }

  function tsumuraNumberFor(bareName) {
    var m = TSUMURA_RE.exec(bareName);
    return m ? parseInt(m[1], 10) : null;
  }

  var ROW_DISPLAY_LABEL = {
    'あ': 'あ行', 'か': 'か行', 'さ': 'さ行', 'た': 'た行', 'な': 'な行',
    'は': 'は行', 'ま': 'ま行', 'や': 'や行', 'ら': 'ら行', 'わ': 'わ行',
    'ツムラ': 'ツムラ(漢方)'
  };

  function rowDisplayLabel(row) {
    return ROW_DISPLAY_LABEL[row] || row;
  }

  /**
   * 薬品名の五十音の行(あ・か・さ…わ)を判定する。ツムラの漢方薬は'ツムラ'を返す。
   * 判定できない場合はnull。
   */
  function kanaRowFor(bareName) {
    if (isTsumura(bareName)) return 'ツムラ';
    var key = sortKeyFor(bareName);
    if (!key) return null;
    var first = toHiragana(key.charAt(0));
    return CHAR_TO_ROW[first] || null;
  }

  function extractBareName(title) {
    return (title || '').trim();
  }

  /**
   * @param {Array} headings parser.js の parseTemplateHtml() の戻り値
   * @returns {Array<{id, level, title, bareName}>} 薬品名見出し(タイトルありのH2)の配列(元の出現順)
   */
  function detectDrugHeadings(headings) {
    var result = [];
    headings.forEach(function (h) {
      if (h.level !== DRUG_HEADING_LEVEL) return;
      var title = (h.title || '').trim();
      if (title === '') return;
      result.push({ id: h.id, level: h.level, title: h.title, bareName: extractBareName(title) });
    });
    return result;
  }

  // シナリオ区分見出し(「① 新規」等)がまだ祖先にある場合に備えた区別ラベル判定。
  // 丸数字で始まる見出しのみを区別ラベルとして使う(薬効分類名(H1)は使わない)。
  var SCENARIO_LABEL_RE = /^[①-⑳]/;

  /**
   * 薬品名見出しを「素の薬品名」でグルーピングし、五十音順にソートした一覧を作る。
   * 同じ薬品名が複数見出しに渡る場合(カテゴリをまたぐ同名薬品など)、祖先に
   * シナリオ区分見出し(①②③等)があればそれだけを区別ラベル(categoryLabel)として使う。
   * 薬効分類名(H1)は区別に使わない(ユーザー指示: 分類名は表示しない)。
   *
   * @param {Array} headings parser.js の parseTemplateHtml() の戻り値
   * @returns {Array<{bareName, contexts: Array<{id, level, title, categoryLabel}>}>}
   */
  function buildDrugList(headings) {
    var drugHeadings = detectDrugHeadings(headings);
    var byIndex = {};
    headings.forEach(function (h, i) { byIndex[h.id] = i; });

    function scenarioLabelFor(id) {
      var idx = byIndex[id];
      var level = headings[idx].level;
      for (var j = idx - 1; j >= 0; j--) {
        var t = headings[j].title.trim();
        if (headings[j].level < level && t !== '') {
          if (SCENARIO_LABEL_RE.test(t)) return t;
          level = headings[j].level;
          if (level === 1) break;
        }
      }
      return '';
    }

    var groups = {};
    var order = [];
    drugHeadings.forEach(function (dh) {
      if (!Object.prototype.hasOwnProperty.call(groups, dh.bareName)) {
        groups[dh.bareName] = [];
        order.push(dh.bareName);
      }
      groups[dh.bareName].push({
        id: dh.id,
        level: dh.level,
        title: dh.title,
        categoryLabel: scenarioLabelFor(dh.id)
      });
    });

    var list = order.map(function (bareName) {
      return { bareName: bareName, contexts: groups[bareName] };
    });

    var collator = new Intl.Collator('ja');
    list.sort(function (a, b) {
      var aT = isTsumura(a.bareName);
      var bT = isTsumura(b.bareName);
      if (aT && bT) return tsumuraNumberFor(a.bareName) - tsumuraNumberFor(b.bareName);
      if (aT !== bT) return aT ? 1 : -1; // ツムラの漢方薬は常に一覧の最後にまとめる
      return collator.compare(sortKeyFor(a.bareName), sortKeyFor(b.bareName));
    });

    return list;
  }

  return {
    extractBareName: extractBareName,
    isPureKanji: isPureKanji,
    isTsumura: isTsumura,
    tsumuraNumberFor: tsumuraNumberFor,
    sortKeyFor: sortKeyFor,
    kanaRowFor: kanaRowFor,
    rowDisplayLabel: rowDisplayLabel,
    detectDrugHeadings: detectDrugHeadings,
    buildDrugList: buildDrugList
  };
});
