#!/usr/bin/env node
/** 후보 풀(.incoming/pool.json) 전량 영상 단위 광고검사 → 확정 무광고 수 집계 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INC = path.join(ROOT, '.incoming');
const pool = JSON.parse(fs.readFileSync(path.join(INC, 'pool.json'), 'utf-8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function check(id) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ko`, { headers: { 'Accept-Language': 'ko-KR', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      const h = await r.text();
      if (!/"videoDetails"|"playabilityStatus"/.test(h)) { await sleep(1300); continue; }
      return /"adPlacements"|"playerAds"|"adSlots"/.test(h) ? 'ad' : 'noad';
    } catch { await sleep(1300); }
  }
  return 'unknown';
}

let i = 0, done = 0;
const res = { noad: [], ad: [], unknown: [] };
async function worker() {
  while (i < pool.length) {
    const v = pool[i++];
    const s = await check(v.youtubeId);
    res[s].push(v);
    done++;
    if (done % 40 === 0) process.stderr.write(`  ...${done}/${pool.length} (무광고 ${res.noad.length})\n`);
    await sleep(160);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));

fs.writeFileSync(path.join(INC, 'pool-adfree.json'), JSON.stringify(res.noad, null, 1));
fs.writeFileSync(path.join(INC, 'pool-unknown.json'), JSON.stringify(res.unknown, null, 1));
const ORDER = ['인성','진로','건강·보건','자기주도학습','생명존중','세계시민','가족','역사','다문화','학교폭력예방','힐링·재미','경제','인권','독도','민주시민','예술·문화','스포츠','AI교육','미디어리터러시','장애인식개선','안전','과학·탐구','학급자치','통일','환경생태'];
const tc = {}; res.noad.forEach(v => tc[v.topic] = (tc[v.topic] || 0) + 1);
console.log(`\n===== 확정 무광고 집계 =====`);
console.log(`후보 ${pool.length} · 무광고 ${res.noad.length} · 광고 ${res.ad.length} · 미확인 ${res.unknown.length}`);
console.log('\n주제별 확정 무광고:');
ORDER.forEach(t => console.log(`  ${t}: ${tc[t] || 0}`));
