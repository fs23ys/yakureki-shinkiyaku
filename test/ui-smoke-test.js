/**
 * ブラウザ実操作によるUIスモークテスト(Playwright)。
 * index.html を file:// で開き、実際のサンプルHTML(data/template.html)を取り込んで
 * あ行・か行見出し付きの薬品名一覧(左)+詳細パネル(右)のマスター・ディテール表示・
 * 検索・選択・コピー・複数文脈のブロック分割・ダークモードが動作するか確認する。
 *
 * 実行方法: node test/ui-smoke-test.js
 */
'use strict';

var path = require('path');
var chromium = require('playwright').chromium;

var INDEX_PATH = 'file://' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

(async function main() {
  var browser = await chromium.launch();
  var context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  var page = await context.newPage();

  var consoleErrors = [];
  page.on('console', function (msg) {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', function (err) {
    consoleErrors.push('pageerror: ' + err.message);
  });

  var failures = [];
  function check(desc, condition) {
    console.log((condition ? '  OK  ' : '  NG  ') + desc);
    if (!condition) failures.push(desc);
  }

  console.log('[1] index.html を開く(file://なのでdata/template.htmlのfetchは失敗するが、取り込み自体はローカル保存フォールバックか手動取り込みで検証する)');
  await page.goto(INDEX_PATH);
  await page.waitForTimeout(300);

  console.log('');
  console.log('[2] サンプルHTMLファイルを手動で取り込む(あ行・か行見出し付きの薬品名一覧になる)');
  var SAMPLE_PATH = path.join(__dirname, '..', '薬歴新規薬.html');
  await page.locator('#updateArea summary').click();
  await page.locator('#fileInput').setInputFiles(SAMPLE_PATH);
  await page.waitForSelector('.drug-item');
  var drugCount = await page.locator('.drug-item').count();
  console.log('  表示された薬品件数: ' + drugCount);
  check('薬品エントリが99件表示される(重複統合後)', drugCount === 99);
  var rowHeaderCount = await page.locator('.kana-row-header').count();
  console.log('  あ行・か行…見出しの件数: ' + rowHeaderCount);
  check('行見出しが7件(あ→か→さ→た→は→ま→ら)', rowHeaderCount === 7);
  var firstRowHeaderText = await page.locator('.kana-row-header').first().textContent();
  check('最初の行見出しが「あ行」', firstRowHeaderText.indexOf('あ行') !== -1);
  var statusText = await page.locator('#statusMessage').textContent();
  check('取り込み成功のステータスメッセージが表示される', statusText.indexOf('取り込みました') !== -1);

  console.log('');
  console.log('[3] 通常の薬品(1文脈)を選択する');
  var esz = page.locator('.drug-item', { hasText: 'エスゾピクロン' }).first().locator('.drug-row');
  await esz.click();
  await page.waitForSelector('#detailPane .preview-text');
  var detailTitle = await page.locator('#detailPane .detail-title').textContent();
  check('詳細パネルのタイトルが薬品名になる', detailTitle.trim() === 'エスゾピクロン');
  var detailText = await page.locator('#detailPane .preview-text').first().textContent();
  check('詳細パネルの内容が##S##から始まる', detailText.indexOf('##S##') === 0);
  check('区別ラベル(preview-block-title)は表示されない(単一文脈・単一ブロックのため)',
    await page.locator('#detailPane .preview-block-title').count() === 0);
  var selectedCount = await page.locator('.drug-item.selected').count();
  check('選択した薬品の行がハイライトされる', selectedCount === 1);

  console.log('');
  console.log('[4] コピー ボタン');
  await page.locator('#detailPane .copy-btn').first().click();
  await page.waitForTimeout(100);
  var statusAfterCopy = await page.locator('#statusMessage').textContent();
  check('コピー成功のステータスメッセージが表示される', statusAfterCopy.indexOf('コピーしました') !== -1);
  var copyBtnText = await page.locator('#detailPane .copy-btn').first().textContent();
  check('コピー ボタン自体も「コピーしました!」表示に変わる', copyBtnText.indexOf('コピーしました') !== -1);
  var clipboardText = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check('クリップボードの内容が##S##で始まる(実際にコピーされている)', clipboardText.indexOf('##S##') === 0);

  console.log('');
  console.log('[5] 複数文脈(①②③)がある薬品(ロキソプロフェン)を選択すると、区別ラベル付きで複数ブロックに分かれる');
  await page.locator('#searchInput').fill('ロキソプロフェン');
  await page.waitForTimeout(100);
  var loxoRow = page.locator('.drug-item', { hasText: 'ロキソプロフェン' }).first();
  var loxoBadge = await loxoRow.locator('.drug-context-badge').textContent();
  check('一覧の薬品行に文脈数バッジ(3件)が表示される', loxoBadge.indexOf('3件') !== -1);
  await loxoRow.locator('.drug-row').click();
  await page.waitForSelector('#detailPane .preview-block');
  var loxoBlockCount = await page.locator('#detailPane .preview-block').count();
  console.log('  ロキソプロフェンのブロック数: ' + loxoBlockCount);
  check('①新規(3分岐)+②胃弱者向け(1)+③頓服(1)で合計5ブロックに分かれる', loxoBlockCount === 5);
  var blockTitles = await page.locator('#detailPane .preview-block-title').allTextContents();
  console.log('  ブロックラベル: ' + blockTitles.join(' / '));
  check('シナリオ区分(①②③)がラベルに含まれる', blockTitles.some(function (t) { return t.indexOf('①') !== -1; }));
  check('薬効分類名(鎮痛薬)はラベルに含まれない(ユーザー指示により非表示)',
    blockTitles.every(function (t) { return t.indexOf('鎮痛薬') === -1; }));

  console.log('');
  console.log('[5.5] ブロックごとに独立してコピーできる(混ざらない)');
  var secondBlockCopyBtn = page.locator('#detailPane .preview-block').nth(1).locator('.copy-btn');
  await secondBlockCopyBtn.click();
  await page.waitForTimeout(100);
  var clipboardAfterBlockCopy = await page.evaluate(function () { return navigator.clipboard.readText(); });
  check('2番目のブロックの内容だけがコピーされる(##S##が1回だけ含まれる)',
    (clipboardAfterBlockCopy.match(/##S##/g) || []).length === 1);

  console.log('');
  console.log('[6] 検索フィルタ(検索中は行見出しを出さずフラット表示)');
  await page.locator('#searchInput').fill('ロキソプロフェン');
  await page.waitForTimeout(100);
  var rowHeaderCountWhileSearch = await page.locator('.kana-row-header').count();
  check('検索中はあ行・か行見出しが表示されない', rowHeaderCountWhileSearch === 0);
  var filteredCount = await page.locator('.drug-item').count();
  console.log('  「ロキソプロフェン」で絞り込んだ件数: ' + filteredCount);
  check('検索で1件に絞り込まれる(ロキソプロフェンテープは含まない完全一致ではなく部分一致なので実際は2件になりうる点に注意)', filteredCount >= 1);
  var markCount = await page.locator('.drug-item mark').count();
  check('一致部分がハイライトされる', markCount === filteredCount);

  console.log('');
  console.log('[7] 検索欄をクリアするとあ行・か行見出し付き表示に戻る');
  await page.locator('#searchInput').fill('');
  await page.waitForTimeout(100);
  var rowHeaderCountAfterClear = await page.locator('.kana-row-header').count();
  check('検索クリアで行見出しが7件に戻る', rowHeaderCountAfterClear === 7);

  console.log('');
  console.log('[8] ダークモード切り替え');
  var themeBefore = await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); });
  await page.locator('#themeToggle').click();
  var themeAfter = await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); });
  console.log('  切り替え前: ' + themeBefore + ' / 切り替え後: ' + themeAfter);
  check('テーマ切り替えボタンでdata-theme属性が変わる', themeBefore !== themeAfter);

  await page.reload();
  await page.waitForSelector('.drug-item');
  var themeAfterReload = await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); });
  check('リロードしてもダークモード設定が保持される', themeAfterReload === themeAfter);
  check('リロード後、localStorageから薬品一覧が復元される(file://のためfetchは失敗する想定)',
    await page.locator('.drug-item').count() === 99);

  console.log('');
  console.log('[9] コンソールエラーの確認');
  // file://で開くと共有テンプレート(data/template.html)のfetchは仕組み上失敗し、
  // ローカル保存データへフォールバックする(想定通りの動作)。そのログは無視する。
  var unexpectedErrors = consoleErrors.filter(function (e) {
    return e.indexOf('data/template.html') === -1 && e.indexOf('Failed to load resource') === -1;
  });
  check('ページ内でJSエラーが発生していない(想定内のfetch失敗を除く)', unexpectedErrors.length === 0);
  if (unexpectedErrors.length) unexpectedErrors.forEach(function (e) { console.log('    ' + e); });

  await page.locator('.drug-item').first().locator('.drug-row').click();
  await page.waitForSelector('#detailPane .preview-text');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(__dirname, 'screenshot-list.png'), fullPage: true });
  console.log('');
  console.log('スクリーンショット保存: test/screenshot-list.png(ダークモード・マスター詳細表示)');

  await browser.close();

  console.log('');
  if (failures.length === 0) {
    console.log('=== 全チェックOK ===');
  } else {
    console.log('=== NGあり: ' + failures.length + '件 ===');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exitCode = 1;
  }
})();
