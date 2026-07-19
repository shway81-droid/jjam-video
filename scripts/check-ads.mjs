#!/usr/bin/env node
/**
 * 전 영상 광고 전수 조사 — 각 영상의 유튜브 플레이어 응답에서 광고 설정(adPlacements/playerAds/adSlots)을
 * 확인해, 재생 없이 "광고 나오는 영상(수익화)"을 전수 판정한다.
 *   node scripts/check-ads.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const videos = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'videos.json'), 'utf-8'))
  .filter(v => v.youtubeId && v.youtubeId !== 'SAMPLE');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkOne(id) {
  for (let a = 0; a < 4; a++) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ko`, {
        headers: { 'Accept-Language': 'ko-KR', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      const html = await res.text();
      const hasPlayer = /"videoDetails"|"playabilityStatus"/.test(html);
      if (!hasPlayer) { await sleep(900); continue; }        // 동의창/봇페이지 → 재시도
      const hasAds = /"adPlacements"|"playerAds"|"adSlots"/.test(html);
      return { ok: true, hasAds };
    } catch { await sleep(900); }
  }
  return { ok: false };
}

const CONC = 4;
let i = 0, done = 0;
const withAds = [], unknown = [];
async function worker() {
  while (i < videos.length) {
    const v = videos[i++];
    const r = await checkOne(v.youtubeId);
    done++;
    if (!r.ok) unknown.push(v);
    else if (r.hasAds) withAds.push(v);
    if (done % 40 === 0) process.stderr.write(`  ...${done}/${videos.length}\n`);
    await sleep(150);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

console.log(`\n===== 광고 전수 조사 =====`);
console.log(`전체 ${videos.length}편`);
console.log(`광고 나옴(수익화): ${withAds.length}편`);
console.log(`광고 없음: ${videos.length - withAds.length - unknown.length}편`);
console.log(`확인 불가(재시도 소진): ${unknown.length}편`);
if (withAds.length) {
  console.log(`\n[광고 나오는 영상]`);
  withAds.forEach(v => console.log(`  ⚠ ${v.topic} | ${v.title} | ${v.youtubeId}`));
  fs.writeFileSync(path.join(ROOT, '.incoming', 'ad-videos.json'), JSON.stringify(withAds, null, 1));
}
if (unknown.length) {
  console.log(`\n[확인 불가]`);
  unknown.forEach(v => console.log(`  ? ${v.topic} | ${v.youtubeId}`));
  fs.writeFileSync(path.join(ROOT, '.incoming', 'ad-unknown.json'), JSON.stringify(unknown, null, 1));
}
