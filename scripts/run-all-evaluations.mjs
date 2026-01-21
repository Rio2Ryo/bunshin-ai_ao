#!/usr/bin/env node
/**
 * 全模倣AIによる評価を実行するスクリプト
 * 
 * このスクリプトはAPIを直接呼び出して、
 * 回答済みシナリオに対して全ての模倣AIが評価を実行します。
 */

import http from 'http';

const BASE_URL = 'http://localhost:3000';

async function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log('=== 全模倣AIによる評価を実行 ===\n');
  
  // 注意: このスクリプトはAPIを直接呼び出すため、
  // 認証が必要な場合は適切なセッションクッキーを設定する必要があります。
  // 
  // 実際の評価実行はブラウザからログインした状態で行うか、
  // tRPCのmutationを直接呼び出す必要があります。
  
  console.log('このスクリプトは参考用です。');
  console.log('実際の評価実行は以下の方法で行ってください：\n');
  console.log('1. ブラウザでログインする');
  console.log('2. 分身AIページで「波形を更新」ボタンをクリック');
  console.log('   または');
  console.log('3. ブラウザのコンソールで以下を実行：');
  console.log('   await window.__trpc.myTwin.evaluateByAllTwins.mutate()');
  console.log('\n');
  
  // データベースの状態を確認
  console.log('現在のデータベース状態を確認するには、');
  console.log('Management UIのDatabaseパネルを使用してください。');
}

main().catch(console.error);
