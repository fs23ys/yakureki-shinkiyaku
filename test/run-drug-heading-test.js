/**
 * 「薬品名見出しの判定ロジック」と「五十音順ソート」の自動検証スクリプト。
 *
 * 実際にGoogleドキュメントから書き出したサンプルHTML(薬歴新規薬.html, 見出し175件)を
 * parser.js + drug-headings.js に通し、期待通りに薬品名見出しが判定・グルーピング・
 * ソートされるかを確認する。
 *
 * 実行方法: node test/run-drug-heading-test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;
var TemplateParser = require('../js/parser.js');
var DrugHeadings = require('../js/drug-headings.js');

var SAMPLE_PATH = path.join(__dirname, '..', '薬歴新規薬.html');

function run() {
  var html = fs.readFileSync(SAMPLE_PATH, 'utf8');
  var dom = new JSDOM('');
  var DOMParserImpl = dom.window.DOMParser;

  var headings = TemplateParser.parseTemplateHtml(html, DOMParserImpl);

  var failures = [];
  function check(desc, condition) {
    if (condition) {
      console.log('  OK  ' + desc);
    } else {
      console.log('  NG  ' + desc);
      failures.push(desc);
    }
  }

  console.log('見出し総数: ' + headings.length);
  console.log('');

  // --- 薬品名見出しの判定 ---
  console.log('[薬品名見出しの判定]');
  var drugHeadings = DrugHeadings.detectDrugHeadings(headings);
  console.log('  薬品名見出しとして判定された件数: ' + drugHeadings.length);

  var byReason = {};
  drugHeadings.forEach(function (d) { byReason[d.reason] = (byReason[d.reason] || 0) + 1; });
  console.log('  判定理由の内訳: ' + JSON.stringify(byReason));

  check('薬品名見出しが1件以上判定される', drugHeadings.length > 0);
  check('"A. エスゾピクロン"(H3, letter-prefix)が判定される',
    drugHeadings.some(function (d) { return d.title.indexOf('エスゾピクロン') !== -1 && d.reason === 'letter-prefix'; }));
  check('"A. ランドセン"(H2直下, letter-prefixだが親にシナリオ区分なし)が判定される',
    drugHeadings.some(function (d) { return d.title.indexOf('ランドセン') !== -1 && d.reason === 'letter-prefix'; }));
  check('"🔵 No.51 止血薬"(H1自身が内容を持つ、A.見出しなしのフォールバック)が判定される',
    drugHeadings.some(function (d) { return d.title.indexOf('止血薬') !== -1 && d.reason === 'leaf-fallback'; }));

  check('シナリオ区分見出し"① 新規"はletter-prefix見出しの親であり、それ自体は薬品名見出しとして判定されない',
    !drugHeadings.some(function (d) { return d.title.trim() === '① 新規'; }));
  check('H4の用途分岐見出し"（１）ロキソプロフェン"(A.ロキソプロフェンの子)は薬品名見出しとして判定されない(親のA.見出しが既に薬品名のため二重計上を避ける)',
    !drugHeadings.some(function (d) { return d.title.indexOf('（１）ロキソプロフェン') !== -1; }));
  check('分類見出し(H1, 内容なし)"🔵 No.4 鎮痛薬"は薬品名見出しとして判定されない',
    !drugHeadings.some(function (d) { return d.title.trim() === '🔵 No.4 鎮痛薬'; }));
  check('空タイトルの見出しは薬品名見出しとして判定されない(混入なし)',
    !drugHeadings.some(function (d) { return d.title.trim() === ''; }));

  // --- 素の薬品名の抽出 ---
  console.log('');
  console.log('[素の薬品名の抽出]');
  check('"A. ロキソプロフェン" → "ロキソプロフェン"', DrugHeadings.extractBareName('A. ロキソプロフェン') === 'ロキソプロフェン');
  check('"B. ピコスルファートNa錠2.5mg" → "ピコスルファートNa錠2.5mg"', DrugHeadings.extractBareName('B. ピコスルファートNa錠2.5mg') === 'ピコスルファートNa錠2.5mg');
  check('"🔵 No.51 止血薬" → "止血薬"', DrugHeadings.extractBareName('🔵 No.51 止血薬') === '止血薬');

  // --- グルーピング(薬品名ごとに1エントリ) ---
  console.log('');
  console.log('[薬品名ごとのグルーピング]');
  var list = DrugHeadings.buildDrugList(headings);
  console.log('  薬品名エントリ数(重複統合後): ' + list.length);

  var loxo = list.find(function (d) { return d.bareName === 'ロキソプロフェン'; });
  check('"ロキソプロフェン"が1エントリに統合される', !!loxo);
  if (loxo) {
    check('"ロキソプロフェン"の文脈が3件(①新規/②胃弱者向け/③頓服)ある', loxo.contexts.length === 3);
    check('区別ラベルはシナリオ区分(①②③)のみで、薬効分類名(鎮痛薬)は含まない',
      loxo.contexts.every(function (c) { return c.categoryLabel.indexOf('①') !== -1 || c.categoryLabel.indexOf('②') !== -1 || c.categoryLabel.indexOf('③') !== -1; }) &&
      loxo.contexts.every(function (c) { return c.categoryLabel.indexOf('鎮痛薬') === -1; }));
    console.log('    区別ラベル: ' + loxo.contexts.map(function (c) { return c.categoryLabel; }).join(' / '));
  }

  var celecoxib = list.find(function (d) { return d.bareName === 'セレコキシブ'; });
  check('"セレコキシブ"が1エントリに統合される、文脈が3件', !!celecoxib && celecoxib.contexts.length === 3);

  // 仕様書には明記されていないが実データ検証で見つかった、シナリオ区分をまたがない
  // 「同名だが別カテゴリ」の重複ケース(例: メコバラミンが「耳鼻科用薬」と「ビタミン剤」の
  // 両方に単独の薬品として登場する)。本ロジックは薬品名が完全一致すれば
  // カテゴリをまたいでも同一エントリに統合する(3.2節の考え方をカテゴリ超えにも一般化)。
  // ただしユーザー指示により薬効分類名は表示しないため、シナリオ区分の無いこの種の
  // 重複は区別ラベル無しでブロックが並ぶ(仕様として許容)。
  console.log('');
  console.log('[仕様書に明記のない重複ケース(カテゴリをまたぐ同名薬品)の検出]');
  var duplicates = list.filter(function (d) { return d.contexts.length > 1; });
  console.log('  文脈が2件以上ある薬品名エントリ: ' + duplicates.length + '件');
  duplicates.forEach(function (d) {
    var labels = d.contexts.map(function (c) { return c.categoryLabel || '(ラベル無し)'; }).join(' / ');
    console.log('    - ' + d.bareName + ' (' + d.contexts.length + '件): ' + labels);
  });

  var mecobalamin = list.find(function (d) { return d.bareName === 'メコバラミン'; });
  check('シナリオ区分の無いカテゴリ跨ぎ重複(メコバラミン)は区別ラベルが空になる(薬効分類名は使わない)',
    !!mecobalamin && mecobalamin.contexts.every(function (c) { return c.categoryLabel === ''; }));

  // --- ふりがな未登録の漢字のみ薬品名の検出(五十音順がズレる可能性があるため) ---
  console.log('');
  console.log('[ふりがな手動指定の確認]');
  check('"止血薬"はふりがな(しけつやく)が指定されている', DrugHeadings.sortKeyFor('止血薬') === 'しけつやく');
  check('"外用塗布剤"はふりがな(がいようとふざい)が指定されている', DrugHeadings.sortKeyFor('外用塗布剤') === 'がいようとふざい');
  var unregisteredKanji = list.filter(function (d) {
    return DrugHeadings.isPureKanji(d.bareName) && DrugHeadings.sortKeyFor(d.bareName) === d.bareName;
  });
  check('漢字のみの薬品名で、ふりがな未登録のものが無い(あればFURIGANA_OVERRIDESへの追加が必要)',
    unregisteredKanji.length === 0);
  if (unregisteredKanji.length > 0) {
    console.log('    未登録: ' + unregisteredKanji.map(function (d) { return d.bareName; }).join('、'));
  }

  // --- 五十音順ソートの確認 ---
  console.log('');
  console.log('[五十音順ソートの確認]');
  var names = list.map(function (d) { return d.bareName; });
  var sortKeys = names.map(function (n) { return DrugHeadings.sortKeyFor(n); });
  var isSorted = true;
  var collator = new Intl.Collator('ja');
  for (var i = 1; i < sortKeys.length; i++) {
    if (collator.compare(sortKeys[i - 1], sortKeys[i]) > 0) { isSorted = false; break; }
  }
  check('全エントリがIntl.Collator(\'ja\')の順序(ふりがな指定を考慮)で単調増加している', isSorted);

  console.log('  先頭10件: ' + names.slice(0, 10).join('、'));
  console.log('  末尾10件: ' + names.slice(-10).join('、'));

  // 単純な文字コード順(デフォルトsort)だとズレる代表例(濁音・長音)がja collatorで
  // 正しく並ぶことを確認する
  var naiveSorted = names.slice().sort();
  var naiveIsSameOrder = naiveSorted.every(function (n, i) { return n === names[i]; });
  check('Intl.Collator(\'ja\')の並び順がJSデフォルトのsort()(文字コード順)と異なる箇所がある(濁音・長音などでズレるため、ja collatorが必要なことの裏付け)',
    !naiveIsSameOrder);

  // --- 見出し一覧の出力(目視確認用) ---
  console.log('');
  console.log('[薬品名一覧(五十音順, 目視確認用、全件)]');
  list.forEach(function (d, i) {
    var extra = d.contexts.length > 1 ? '  ※' + d.contexts.length + '文脈' : '';
    console.log('  ' + (i + 1) + ': ' + d.bareName + extra);
  });

  // --- あ行・か行…見出し区切りの確認 ---
  console.log('');
  console.log('[あ行・か行…見出し区切りの確認]');
  var rows = list.map(function (d) { return DrugHeadings.kanaRowFor(d.bareName); });
  check('全エントリで行が判定できる(nullが無い)', rows.every(function (r) { return r !== null; }));
  var rowOrder = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'];
  var seenRows = [];
  rows.forEach(function (r) { if (seenRows[seenRows.length - 1] !== r) seenRows.push(r); });
  var isRowOrderValid = seenRows.every(function (r, i) {
    if (i === 0) return true;
    return rowOrder.indexOf(r) > rowOrder.indexOf(seenRows[i - 1]);
  });
  check('行の出現順が「あ→か→さ→…→わ」の順で単調に進む(戻ったり飛んだりしない)', isRowOrderValid);
  console.log('  出現順: ' + seenRows.join(' → '));
  check('"止血薬"は"し"行に分類される(ふりがな指定が反映されている)',
    DrugHeadings.kanaRowFor('止血薬') === 'さ');

  console.log('');
  if (failures.length === 0) {
    console.log('=== 全チェックOK ===');
  } else {
    console.log('=== NGあり: ' + failures.length + '件 ===');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exitCode = 1;
  }
}

run();
