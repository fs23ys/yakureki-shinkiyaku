/**
 * デザイン目視確認用スクリーンショット取得(ライトモード・スマホ幅)。
 * 実行方法: node test/design-check.js
 */
'use strict';

var path = require('path');
var chromium = require('playwright').chromium;

var INDEX_PATH = 'file://' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
var SAMPLE_PATH = path.join(__dirname, '..', '薬歴新規薬.html');

(async function main() {
  var browser = await chromium.launch();

  // ライトモード・デスクトップ幅
  var ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  var page1 = await ctx1.newPage();
  await page1.goto(INDEX_PATH);
  await page1.locator('#updateArea summary').click();
  await page1.locator('#fileInput').setInputFiles(SAMPLE_PATH);
  await page1.waitForSelector('.drug-item');
  await page1.locator('.drug-item', { hasText: 'ロキソプロフェン' }).first().locator('.drug-row').click();
  await page1.waitForSelector('#detailPane .preview-block');
  await page1.mouse.move(0, 0);
  await page1.screenshot({ path: path.join(__dirname, 'design-light-desktop.png'), clip: { x: 0, y: 0, width: 1280, height: 900 } });
  await ctx1.close();

  // スマホ幅
  var ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  var page2 = await ctx2.newPage();
  await page2.goto(INDEX_PATH);
  await page2.locator('#updateArea summary').click();
  await page2.locator('#fileInput').setInputFiles(SAMPLE_PATH);
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
