/**
 * 薬歴新規薬コピペ - 「薬品名見出し」判定・五十音順ソートロジック
 *
 * parser.js が返す見出し配列(id, level, title, block, effectiveBlocks, ...)を受け取り、
 * 「薬品名見出し」を判定して、薬品名ごとに1エントリへグルーピングし、
 * 五十音順にソートした一覧データを組み立てる。
 *
 * 判定ルール(仕様書3.1・実データ検証で確定):
 *   1) タイトルが「英大文字1文字 + '. ' + 薬品名」(例: "A. ロキソプロフェン")で
 *      始まる見出しは、レベル(H1〜H6)に関わらず薬品名見出しとする。
 *   2) 上記パターンに一致しない見出しでも、自身の配下(次の同格以上の見出しが
 *      現れるまでの範囲)に上記パターンの子孫が1件も無く、かつ自身が実際に
 *      内容(block)を持つ場合は、その見出し自身を薬品名見出しとする
 *      (例: 「🔵 No.51 止血薬」のように、分類名がそのまま薬品名代わりになっている
 *      ケース。1系統しか薬が無い分類はA.見出しを作らず直接内容が書かれている)。
 *   3) それ以外(シナリオ区分見出し「① 新規」等、内容の無い分類見出し、
 *      空タイトルの見出し、既に薬品名見出しの配下にあるH4の用途分岐見出しなど)は
 *      薬品名見出しとしない。
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

  var LETTER_PREFIX_RE = /^([A-Z])\.\s*(\S.*)$/;
  // 分類見出しに付く飾り(絵文字等)と "No.4 " のような通し番号を取り除くための正規表現。
  // 絵文字・記号・空白を先頭から除去し、続けて "No.数字" があれば除去する。
  var LEADING_DECOR_RE = /^[^\p{L}\p{N}（(]+/u;
  var LEADING_NO_RE = /^No\.\s*\d+\s*/i;

  // Googleドキュメント側にふりがな情報が無いため、Intl.Collator('ja')は
  // 漢字のみの薬品名を「読み」ではなくUnicode上の並びで判定してしまい、
  // 五十音順の意図した位置(例:「止血薬」は「し」の位置)からズレる。
  // 該当する薬品名が見つかるたびに、ここに読み(ひらがな)を手動で追加すること。
  var FURIGANA_OVERRIDES = {
    '止血薬': 'しけつやく',
    '外用塗布剤': 'がいようとふざい'
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

  /**
   * 薬品名の五十音の行(あ・か・さ…わ)を判定する。判定できない場合はnull。
   */
  function kanaRowFor(bareName) {
    var key = sortKeyFor(bareName);
    if (!key) return null;
    var first = toHiragana(key.charAt(0));
    return CHAR_TO_ROW[first] || null;
  }

  function isLetterPrefixed(title) {
    return LETTER_PREFIX_RE.test(title);
  }

  /**
   * 見出しタイトルから「素の薬品名」を取り出す。
   * - "A. ロキソプロフェン" → "ロキソプロフェン"
   * - "🔵 No.51 止血薬" → "止血薬"
   */
  function extractBareName(title) {
    var m = LETTER_PREFIX_RE.exec(title);
    if (m) {
      return m[2].trim();
    }
    var s = title.trim();
    s = s.replace(LEADING_DECOR_RE, '');
    s = s.replace(LEADING_NO_RE, '');
    return s.trim();
  }

  /**
   * headings[i] の配下(次の同格以上の見出しが現れるまでの範囲)に、
   * 英大文字プレフィックス付きの見出しが1件でもあるかどうか。
   */
  function hasLetterPrefixedDescendant(headings, i) {
    var level = headings[i].level;
    for (var j = i + 1; j < headings.length && headings[j].level > level; j++) {
      if (isLetterPrefixed(headings[j].title)) {
        return true;
      }
    }
    return false;
  }

  function hasOwnContent(h) {
    return !!(h.block && h.block.length > 0) ||
      !!(h.effectiveBlocks && h.effectiveBlocks.length > 0);
  }

  /**
   * headings[i] の祖先(親・祖父…)に、英大文字プレフィックス付きの見出しが
   * 1件でもあるかどうか。あれば、headings[i]は既に薬品名見出しの配下にある
   * 用途分岐見出し(H4の「（１）痛み」等)であり、それ自体は別の薬品名ではない。
   */
  function hasLetterPrefixedAncestor(headings, i) {
    var level = headings[i].level;
    for (var j = i - 1; j >= 0; j--) {
      if (headings[j].level < level && headings[j].title.trim() !== '') {
        if (isLetterPrefixed(headings[j].title)) return true;
        level = headings[j].level;
        if (level === 1) break;
      }
    }
    return false;
  }

  /**
   * @param {Array} headings parser.js の parseTemplateHtml() の戻り値
   * @returns {Array<{id, level, title, bareName, reason}>} 薬品名見出しと判定された見出しの配列(元の出現順)
   */
  function detectDrugHeadings(headings) {
    var result = [];
    for (var i = 0; i < headings.length; i++) {
      var h = headings[i];
      var title = (h.title || '').trim();
      if (title === '') continue;

      if (isLetterPrefixed(title)) {
        result.push({ id: h.id, level: h.level, title: h.title, bareName: extractBareName(title), reason: 'letter-prefix' });
        continue;
      }

      if (!hasLetterPrefixedDescendant(headings, i) && !hasLetterPrefixedAncestor(headings, i) && hasOwnContent(h)) {
        result.push({ id: h.id, level: h.level, title: h.title, bareName: extractBareName(title), reason: 'leaf-fallback' });
      }
    }
    return result;
  }

  // シナリオ区分見出し(「① 新規」「② 新規（胃弱者向け）」等)かどうかの判定。
  // 丸数字で始まる見出しのみを区別ラベルとして使う(薬効分類名(H1)は使わない)。
  var SCENARIO_LABEL_RE = /^[①-⑳]/;

  /**
   * 薬品名見出しを「素の薬品名」でグルーピングし、五十音順にソートした一覧を作る。
   * 同じ薬品名が複数見出しに渡る場合、祖先にシナリオ区分見出し(①②③等)があれば
   * それだけを区別ラベル(categoryLabel)として使う。薬効分類名(H1)は区別に使わない
   * (ユーザー指示: 分類名は表示しない。シナリオ区分が無い場合はラベル無しで並べる)。
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
    list.sort(function (a, b) { return collator.compare(sortKeyFor(a.bareName), sortKeyFor(b.bareName)); });

    return list;
  }

  return {
    isLetterPrefixed: isLetterPrefixed,
    extractBareName: extractBareName,
    hasLetterPrefixedDescendant: hasLetterPrefixedDescendant,
    hasLetterPrefixedAncestor: hasLetterPrefixedAncestor,
    isPureKanji: isPureKanji,
    sortKeyFor: sortKeyFor,
    kanaRowFor: kanaRowFor,
    detectDrugHeadings: detectDrugHeadings,
    buildDrugList: buildDrugList
  };
});
