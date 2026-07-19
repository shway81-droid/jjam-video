#!/usr/bin/env node
/**
 * 전 영상 링크 점검 — YouTube oEmbed로 임베드 가능(=재생 가능) 여부 전수 확인.
 *   node scripts/check-links.mjs
 * 임베드 차단(401)·삭제/비공개(404)를 실패로 보고. rate-limit(429 등)은 재시도로 오탐 방지.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const videos = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'videos.json'), 'utf-8'))
  .filter(v => v.youtubeId && v.youtubeId !== 'SAMPLE');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function check(id) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (r.ok) return { ok: true };
      if (r.status === 401) return { ok: false, reason: '임베드 차단(401)' };
      if (r.status === 404) return { ok: false, reason: '삭제/비공개(404)' };
      // 그 외(429 등) → 재시도
    } catch (e) { /* 네트워크 → 재시도 */ }
    await sleep(800);
  }
  return { ok: false, reason: '재시도 소진(rate-limit 의심)' };
}

const CONC = 4;
let i = 0, done = 0;
const failed = [];
async function worker() {
  while (i < videos.length) {
    const v = videos[i++];
    const r = await check(v.youtubeId);
    done++;
    if (!r.ok) failed.push({ ...v, reason: r.reason });
    if (done % 50 === 0) process.stderr.write(`  ...${done}/${videos.length}\n`);
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

console.log(`\n===== 링크 점검 결과 =====`);
console.log(`전체 ${videos.length}편 · 정상 ${videos.length - failed.length}편 · 실패 ${failed.length}편`);
if (failed.length) {
  console.log(`\n[재생 불가 영상]`);
  failed.forEach(f => console.log(`  ✗ ${f.reason} | ${f.topic} | ${f.title} | ${f.youtubeId}`));
  fs.writeFileSync(path.join(ROOT, '.incoming', 'dead-links.json'), JSON.stringify(failed, null, 1));
  console.log(`\n→ .incoming/dead-links.json 저장`);
} else {
  console.log(`\n✅ 전 영상 재생 가능(임베드 OK).`);
}
