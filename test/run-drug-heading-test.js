/**
 * 「薬品名見出しの判定ロジック」と「五十音順ソート」の自動検証スクリプト。
 *
 * 実際にGoogleドキュメントから書き出したサンプルHTML(薬歴新規.html)を
 * parser.js + drug-headings.js に通し、期待通りに薬品名見出しが判定・グルーピング・
 * ソートされるかを確認する。
 *
 * このドキュメントのフォーマット: H1=分類見出し(未使用・空タイトル)、
 * H2=薬品名、H3=同じ薬品の用途分岐(例:「（１）耳鼻科」「（２）痛み」)。
 *
 * 実行方法: node test/run-drug-heading-test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;
var TemplateParser = require('../js/parser.js');
var DrugHeadings = require('../js/drug-headings.js');

var SAMPLE_PATH = path.join(__dirname, '..', '薬歴新規.html');

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

  // --- 薬品名見出しの判定(タイトルありのH2すべて) ---
  console.log('[薬品名見出しの判定]');
  var drugHeadings = DrugHeadings.detectDrugHeadings(headings);
  console.log('  薬品名見出し(H2)件数: ' + drugHeadings.length);
  check('薬品名見出しが1件以上判定される', drugHeadings.length > 0);
  check('全件がH2である', drugHeadings.every(function (d) { return d.level === 2; }));
  check('空タイトルのH2は混入しない', !drugHeadings.some(function (d) { return d.title.trim() === ''; }));
  check('"エスゾピクロン"(H2, 直接本文あり)が判定される',
    drugHeadings.some(function (d) { return d.bareName === 'エスゾピクロン'; }));
  check('"カロナール"(H2, 自身は本文なし・配下のH3に本文)が判定される',
    drugHeadings.some(function (d) { return d.bareName === 'カロナール'; }));
  check('H3の用途分岐見出し"（１）解熱"はそれ自体は薬品名見出しとして判定されない(親のH2に集約されるため)',
    !drugHeadings.some(function (d) { return d.bareName.indexOf('（１）解熱') !== -1; }));
  check('分類見出し(H1, 空タイトル)は薬品名見出しとして判定されない', drugHeadings.every(function (d) { return d.level !== 1; }));

  // --- 薬品名ごとのグルーピング(カテゴリをまたぐ同名薬品の統合) ---
  console.log('');
  console.log('[薬品名ごとのグルーピング]');
  var list = DrugHeadings.buildDrugList(headings);
  console.log('  薬品名エントリ数(重複統合後): ' + list.length);

  var mecobalamin = list.find(function (d) { return d.bareName === 'メコバラミン'; });
  check('"メコバラミン"はカテゴリをまたぐ重複が1エントリに統合される(2文脈)', !!mecobalamin && mecobalamin.contexts.length === 2);

  var rokoid = list.find(function (d) { return d.bareName === 'ロコイド軟膏'; });
  check('"ロコイド軟膏"はカテゴリをまたぐ重複が1エントリに統合される(2文脈)', !!rokoid && rokoid.contexts.length === 2);

  // --- H2自身に本文が無く、配下のH3に用途分岐がある場合の集約確認 ---
  console.log('');
  console.log('[H2選択時にH3の用途分岐が分けて表示されるか(parser.jsのeffectiveBlocks)]');
  var byId = {};
  headings.forEach(function (h) { byId[h.id] = h; });
  var prednine = drugHeadings.find(function (d) { return d.bareName === 'プレドニン'; });
  check('"プレドニン"(H2)が見つかる', !!prednine);
  if (prednine) {
    var h = byId[prednine.id];
    check('自身のblockは空(H3側に本文がある)', h.block === '');
    check('effectiveBlocksが1件(配下のH3「（１）耳鼻科」)ある', h.effectiveBlocks.length === 1);
    check('effectiveBlocksのタイトルに「（１）耳鼻科」が含まれる(コピー内容の上に表示される見出し)',
      h.effectiveBlocks[0].title.indexOf('（１）耳鼻科') !== -1);
  }

  var mecobalaminHeading = drugHeadings.find(function (d) { return d.bareName === 'メコバラミン' && byId[d.id].block === ''; });
  check('"メコバラミン"(用途分岐が3件あるほう)が見つかる', !!mecobalaminHeading);
  if (mecobalaminHeading) {
    var hMeco = byId[mecobalaminHeading.id];
    check('メコバラミンのeffectiveBlocksが3件(手のしびれ／痛み／VB12不足)に分かれる', hMeco.effectiveBlocks.length === 3);
    check('各ブロックが独立した##S##〜##OP##になっている(混ざらない)',
      hMeco.effectiveBlocks.every(function (b) { return (b.block.match(/##S##/g) || []).length === 1; }));
  }

  // --- 漢字のみの薬品名(ふりがな手動指定)の確認 ---
  console.log('');
  console.log('[ふりがな手動指定の確認]');
  check('"外用鎮痛塗布剤"はふりがな(がいようちんつうとふざい)が指定されている',
    DrugHeadings.sortKeyFor('外用鎮痛塗布剤') === 'がいようちんつうとふざい');
  var unregisteredKanji = list.filter(function (d) {
    return !DrugHeadings.isTsumura(d.bareName) && DrugHeadings.isPureKanji(d.bareName) && DrugHeadings.sortKeyFor(d.bareName) === d.bareName;
  });
  check('漢字のみの薬品名で、ふりがな未登録のものが無い(あればFURIGANA_OVERRIDESへの追加が必要)',
    unregisteredKanji.length === 0);
  if (unregisteredKanji.length > 0) {
    console.log('    未登録: ' + unregisteredKanji.map(function (d) { return d.bareName; }).join('、'));
  }

  // --- ツムラの漢方薬は末尾にツムラ番号順でまとめる ---
  console.log('');
  console.log('[ツムラの漢方薬(末尾にツムラ番号順)]');
  var tsumuraEntries = list.filter(function (d) { return DrugHeadings.isTsumura(d.bareName); });
  console.log('  ツムラ該当件数: ' + tsumuraEntries.length);
  check('ツムラの漢方薬が4件見つかる', tsumuraEntries.length === 4);
  check('ツムラの漢方薬は一覧の末尾(最後の4件)にまとまっている',
    list.slice(-4).every(function (d) { return DrugHeadings.isTsumura(d.bareName); }));
  var tsumuraNumbers = list.slice(-4).map(function (d) { return DrugHeadings.tsumuraNumberFor(d.bareName); });
  console.log('  末尾4件のツムラ番号: ' + tsumuraNumbers.join(', '));
  check('ツムラ番号順(昇順)に並んでいる', tsumuraNumbers.every(function (n, i) { return i === 0 || tsumuraNumbers[i - 1] < n; }));
  check('ツムラの漢方薬のkanaRowFor()は"ツムラ"を返す',
    tsumuraEntries.every(function (d) { return DrugHeadings.kanaRowFor(d.bareName) === 'ツムラ'; }));
  check('rowDisplayLabel("ツムラ")が「ツムラ(漢方)」になる', DrugHeadings.rowDisplayLabel('ツムラ') === 'ツムラ(漢方)');

  // --- あ行・か行…見出し区切りの確認(ツムラを除く) ---
  console.log('');
  console.log('[あ行・か行…見出し区切りの確認]');
  var nonTsumura = list.filter(function (d) { return !DrugHeadings.isTsumura(d.bareName); });
  var rows = nonTsumura.map(function (d) { return DrugHeadings.kanaRowFor(d.bareName); });
  check('ツムラ以外の全エントリで行が判定できる(nullが無い)', rows.every(function (r) { return r !== null; }));
  var rowOrder = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'];
  var seenRows = [];
  rows.forEach(function (r) { if (seenRows[seenRows.length - 1] !== r) seenRows.push(r); });
  var isRowOrderValid = seenRows.every(function (r, i) {
    if (i === 0) return true;
    return rowOrder.indexOf(r) > rowOrder.indexOf(seenRows[i - 1]);
  });
  check('行の出現順が「あ→か→さ→…→わ」の順で単調に進む(戻ったり飛んだりしない)', isRowOrderValid);
  console.log('  出現順: ' + seenRows.join(' → '));

  // --- 五十音順ソートの確認(ツムラを除く部分) ---
  console.log('');
  console.log('[五十音順ソートの確認]');
  var names = nonTsumura.map(function (d) { return d.bareName; });
  var sortKeys = names.map(function (n) { return DrugHeadings.sortKeyFor(n); });
  var isSorted = true;
  var collator = new Intl.Collator('ja');
  for (var i = 1; i < sortKeys.length; i++) {
    if (collator.compare(sortKeys[i - 1], sortKeys[i]) > 0) { isSorted = false; break; }
  }
  check('ツムラ以外の全エントリがIntl.Collator(\'ja\')の順序(ふりがな指定を考慮)で単調増加している', isSorted);
  console.log('  先頭5件: ' + names.slice(0, 5).join('、'));
  console.log('  ツムラ以外の末尾5件: ' + names.slice(-5).join('、'));
  console.log('  一覧の末尾5件(ツムラ含む): ' + list.slice(-5).map(function (d) { return d.bareName; }).join('、'));

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
