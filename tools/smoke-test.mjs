// 起動チェック(スモークテスト)
//
// zakusim.html を実際にブラウザで開き、「エラーなく起動してタイトル画面が出るか」だけを自動で確認する。
// 7,300行超の単一ファイルを触るたびに、壊れたまま公開してしまう事故を防ぐのが目的で、
// 遊びの内容(バランスや当たり判定)までは見ない。
//
// 使い方:
//   npm install     (最初の1回だけ)
//   npm run smoke
//
// 端末にインストール済みのMicrosoft Edgeをそのまま使うため、テスト用ブラウザのダウンロードは発生しない。
// three.jsをCDNから読み込むため、実行にはインターネット接続が必要。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json'
};

// vercel.json のリライト(/ → /zakusim.html)と同じ挙動にした簡易サーバー。
// file:// で開くと通信まわりの制限で本番と違うエラーが出るため、本番に近いHTTP経由で確認する
const server = createServer(async (req, res) => {
  let path = '/';
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path === '/favicon.ico'){ res.writeHead(204).end(); return; } // 無いと404がコンソールエラーとして拾われてしまうため
  if (path === '/') path = '/zakusim.html';
  const file = join(ROOT, normalize(path).replace(/^[\\/]+/, ''));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)){ res.writeHead(403).end(); return; } // 上位ディレクトリへの参照を拒否する
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const problems = [];
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  browser = await chromium.launch({ channel: 'msedge' }); // 端末のEdgeを利用する(専用ブラウザの追加ダウンロード無し)
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push('コンソールエラー: ' + m.text()); });
  page.on('pageerror', e => problems.push('スクリプトエラー: ' + e.message));
  page.on('requestfailed', r => problems.push('読み込み失敗: ' + r.url() + ' (' + (r.failure()?.errorText || '') + ')'));

  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load', timeout: 30000 });

  // three.jsが読み込めなかった場合に出る案内が表示されていないこと(CDNに繋がらない等)
  if ((await page.locator('body').innerText()).includes('3Dライブラリ')){
    problems.push('three.jsを読み込めていない(CDNに接続できていない可能性)');
  }
  // タイトル(モード選択)画面が出ていること
  await page.waitForSelector('#difficulty', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('#diffBtn1', { state: 'visible', timeout: 10000 });
  // 3Dの描画先(canvas)が実際に作られ、サイズを持っていること
  const canvas = await page.evaluate(() => {
    const el = document.querySelector('canvas');
    return el ? { w: el.width, h: el.height } : null;
  });
  if (!canvas) problems.push('canvasが作られていない(three.jsの初期化に失敗している可能性)');
  else if (canvas.w <= 0 || canvas.h <= 0) problems.push('canvasのサイズが0(描画先が正しく初期化されていない)');

  // 数秒動かして、毎フレームの処理で例外が出続けていないかを見る
  await page.waitForTimeout(3000);
} catch (e) {
  problems.push('起動チェック自体が失敗: ' + (e && e.message ? e.message : String(e)));
} finally {
  if (browser) await browser.close().catch(()=>{});
  server.close();
}

if (problems.length){
  console.error('起動チェック: 失敗');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('起動チェック: OK (エラーなく起動し、タイトル画面と3D描画先を確認できました)');
