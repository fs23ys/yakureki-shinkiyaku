/**
 * デザイン目視確認用スクリーンショット取得(ライトモード・スマホ幅)。
 * 実行方法: node test/design-check.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var chromium = require('playwright').chromium;

var INDEX_PATH = 'file://' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
var SAMPLE_PATH = path.join(__dirname, '..', '2026.08.21.html');
var SAMPLE_HTML = fs.readFileSync(SAMPLE_PATH, 'utf8');

(async function main() {
  var browser = await chromium.launch();

  // ライトモード・デスクトップ幅
  var ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  var page1 = await ctx1.newPage();
  await page1.goto(INDEX_PATH);
  await page1.evaluate(function (html) { window.__testImportHtml(html, 'テスト用サンプル'); }, SAMPLE_HTML);
  await page1.waitForSelector('.drug-item');
  await page1.locator('.drug-item', { hasText: 'メコバラミン' }).first().locator('.drug-row').click();
  await page1.waitForSelector('#detailPane .preview-block');
  await page1.mouse.move(0, 0);
  await page1.screenshot({ path: path.join(__dirname, 'design-light-desktop.png'), clip: { x: 0, y: 0, width: 1280, height: 900 } });
  await ctx1.close();

  // スマホ幅
  var ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  var page2 = await ctx2.newPage();
  await page2.goto(INDEX_PATH);
  await page2.evaluate(function (html) { window.__testImportHtml(html, 'テスト用サンプル'); }, SAMPLE_HTML);
  await page2.waitForSelector('.drug-item');
  await page2.mouse.move(0, 0);
  await page2.screenshot({ path: path.join(__dirname, 'design-mobile-list.png') });
  await page2.locator('.drug-item', { hasText: 'アジスロマイシン' }).first().locator('.drug-row').click();
  await page2.waitForSelector('#detailPane .preview-text');
  await page2.mouse.move(0, 0);
  await page2.screenshot({ path: path.join(__dirname, 'design-mobile-detail.png') });
  await ctx2.close();

  await browser.close();
  console.log('保存完了: design-light-desktop.png / design-mobile-list.png / design-mobile-detail.png');
})();
