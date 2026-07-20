#!/usr/bin/env node
/** 백필(bf-*.json) 전량을 채널 단위로 광고검사 → 광고 있는 영상 제거 (무광고 보장) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INC = path.join(ROOT, '.incoming');
const OUT = path.join(ROOT, 'data', 'videos.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const allow = new Set(fs.readFileSync(path.join(INC, 'adfree-channels.txt'), 'utf-8').split('\n').map(s => s.trim()).filter(Boolean));
const bfIds = new Set();
for (const f of fs.readdirSync(INC).filter(f => /^bf-\d\.json$/.test(f)))
  JSON.parse(fs.readFileSync(path.join(INC, f))).forEach(x => bfIds.add(x.youtubeId));

let videos = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
const bfVideos = videos.filter(v => bfIds.has(v.youtubeId));

async function author(id) { for (let a = 0; a < 4; a++) { try { const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`); if (r.ok) return (await r.json()).author_name; if (r.status === 401 || r.status === 404) return null; } catch {} await sleep(500); } return null; }
async function hasAds(id) { for (let a = 0; a < 6; a++) { try { const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ko`, { headers: { 'Accept-Language': 'ko-KR', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }); const h = await r.text(); if (!/"videoDetails"|"playabilityStatus"/.test(h)) { await sleep(1400); continue; } return /"adPlacements"|"playerAds"|"adSlots"/.test(h) ? 'ad' : 'noad'; } catch { await sleep(1400); } } return 'unknown'; }

// 1) 저자 조회
let i = 0; const authors = new Map();
await Promise.all(Array.from({ length: 4 }, async () => { while (i < bfVideos.length) { const v = bfVideos[i++]; authors.set(v.youtubeId, await author(v.youtubeId)); await sleep(120); } }));

// 2) 채널 그룹
const chan = {};
bfVideos.forEach(v => { const a = authors.get(v.youtubeId) || '?'; (chan[a] = chan[a] || []).push(v.youtubeId); });
const chanStatus = {};
const toCheck = [];
for (const c of Object.keys(chan)) { if (allow.has(c)) chanStatus[c] = 'noad'; else toCheck.push(c); }
process.stderr.write(`백필 채널 ${Object.keys(chan).length}개 · 허용목록 확정 ${Object.keys(chan).length - toCheck.length} · 검사 필요 ${toCheck.length}\n`);

// 3) 미확정 채널 순차 광고검사(1편)
let ci = 0;
for (const c of toCheck) { const r = await hasAds(chan[c][0]); chanStatus[c] = r === 'unknown' ? 'ad' : r; ci++; if (ci % 10 === 0) process.stderr.write(`  ...채널 ${ci}/${toCheck.length}\n`); await sleep(400); }

// 4) 광고 채널 영상 제거
const removeIds = new Set();
bfVideos.forEach(v => { const a = authors.get(v.youtubeId) || '?'; if (chanStatus[a] !== 'noad') removeIds.add(v.youtubeId); });
const TOPIC_ORDER = ['인성','진로','건강·보건','생명존중','세계시민','가족','역사','다문화','학교폭력예방','힐링·재미','경제','인권','독도','민주시민','예술·문화','스포츠','AI교육','미디어리터러시','장애인식개선','안전','과학·탐구','학급자치','통일','환경생태'];
videos = videos.filter(v => !removeIds.has(v.youtubeId));
videos.sort((a, b) => TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
fs.writeFileSync(OUT, JSON.stringify(videos, null, 2) + '\n', 'utf-8');

const adChans = Object.entries(chanStatus).filter(([, s]) => s !== 'noad').map(([c]) => c);
process.stderr.write(`\n광고 채널 ${adChans.length}개 → ${removeIds.size}편 제거. 총 ${videos.length}편\n`);
process.stderr.write('제거된 광고 채널: ' + adChans.join(', ') + '\n');
const tc = {}; videos.forEach(v => tc[v.topic] = (tc[v.topic] || 0) + 1);
process.stderr.write('\n주제별:\n'); TOPIC_ORDER.forEach(t => process.stderr.write(`  ${t}: ${tc[t] || 0}${(tc[t]||0)<15?'  ⚠️':''}\n`));
