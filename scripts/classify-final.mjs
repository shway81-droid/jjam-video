#!/usr/bin/env node
/**
 * 광고 여부 최종 분류 (채널 단위 확정).
 * 기존 전수조사 결과 + 채널 상속으로 각 영상을 ad/noad/unknown 판정.
 * 완전 미확인 채널만 watch-page로 1편씩 추가 점검(완만).
 * 출력: .incoming/keep.json (무광고), .incoming/remove.json (광고/미확인)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INC = path.join(ROOT, '.incoming');
const J = f => JSON.parse(fs.readFileSync(path.join(INC, f), 'utf-8'));
const idset = arr => new Set(arr.map(v => v.youtubeId));

const authors = J('authors.json');                       // 432: {youtubeId, topic, title, author}
const adSet = new Set([...idset(J('ad-videos.json')), ...idset(J('ad-recheck-ads.json'))]);   // 223
const firstUnknown = idset(J('ad-unknown.json'));        // 145
const recheckAds = idset(J('ad-recheck-ads.json'));      // 38
const recheckNoad = idset(J('ad-recheck-noad.json'));    // 21
// 86 여전히 미확인 = 첫 미확인 - 재조사에서 판정된 것
const unknownSet = new Set([...firstUnknown].filter(id => !recheckAds.has(id) && !recheckNoad.has(id)));

const statusOf = id => adSet.has(id) ? 'ad' : (unknownSet.has(id) ? 'unknown' : 'noad');

// 채널별 상태 집계
const chan = {};
authors.forEach(v => {
  const s = statusOf(v.youtubeId);
  const c = (chan[v.author] = chan[v.author] || { ad: 0, noad: 0, unknown: 0, ids: [] });
  c[s]++; c.ids.push(v.youtubeId);
});

// 완전 미확인 채널(모든 영상 unknown) → watch-page 1편 점검
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function hasAds(id) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ko`, { headers: { 'Accept-Language': 'ko-KR', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      const h = await r.text();
      if (!/"videoDetails"|"playabilityStatus"/.test(h)) { await sleep(1500); continue; }
      return /"adPlacements"|"playerAds"|"adSlots"/.test(h) ? 'ad' : 'noad';
    } catch { await sleep(1500); }
  }
  return 'unknown';
}

const needCheck = Object.entries(chan).filter(([, c]) => c.ad === 0 && c.noad === 0);
console.error(`추가 점검 필요 채널(전부 미확인): ${needCheck.length}개`);

const channelStatus = {};
for (const [name, c] of Object.entries(chan)) {
  channelStatus[name] = c.ad > 0 ? 'ad' : (c.noad > 0 ? 'noad' : 'pending');
}
// pending 채널 순차 점검
let ci = 0;
for (const [name, c] of needCheck) {
  const r = await hasAds(c.ids[0]);
  channelStatus[name] = r === 'unknown' ? 'ad' : r;   // 끝내 미확인이면 안전하게 ad(제거) 처리
  ci++;
  if (ci % 15 === 0) process.stderr.write(`  ...채널 ${ci}/${needCheck.length}\n`);
  await sleep(500);
}

const keep = [], remove = [];
authors.forEach(v => {
  (channelStatus[v.author] === 'noad' ? keep : remove).push({ ...v, chStatus: channelStatus[v.author] });
});

fs.writeFileSync(path.join(INC, 'keep.json'), JSON.stringify(keep, null, 1));
fs.writeFileSync(path.join(INC, 'remove.json'), JSON.stringify(remove, null, 1));

console.error(`\n무광고(keep): ${keep.length}편 · 광고/미확인(remove): ${remove.length}편`);
const tc = {}; keep.forEach(v => tc[v.topic] = (tc[v.topic] || 0) + 1);
const ORDER = ['인성','진로','건강·보건','생명존중','세계시민','가족','역사','다문화','학교폭력예방','힐링·재미','경제','인권','독도','민주시민','예술·문화','스포츠','AI교육','미디어리터러시','장애인식개선','안전','과학·탐구','학급자치','통일','환경생태'];
console.error('\n주제별 무광고 잔존 수:');
ORDER.forEach(t => console.error(`  ${t}: ${tc[t] || 0}`));
