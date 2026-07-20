#!/usr/bin/env node
/** 확정 무광고 268편(adfree-final.json)의 전체 엔트리를 소스에서 모아 videos.json 재구성 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INC = path.join(ROOT, '.incoming');
const OUT = path.join(ROOT, 'data', 'videos.json');

const TOPIC_ORDER = ['인성','진로','건강·보건','생명존중','세계시민','가족','역사','다문화','학교폭력예방','힐링·재미','경제','인권','독도','민주시민','예술·문화','스포츠','AI교육','미디어리터러시','장애인식개선','안전','과학·탐구','학급자치','통일','환경생태'];

// 전체 엔트리 소스: 원본 432 + 백필 211 (youtubeId → 완전한 엔트리)
const lookup = new Map();
JSON.parse(fs.readFileSync(path.join(INC, 'videos-before-adfree.json'), 'utf-8')).forEach(v => { if (v.youtubeId && v.youtubeId !== 'SAMPLE') lookup.set(v.youtubeId, v); });
for (const f of fs.readdirSync(INC).filter(f => /^bf-\d\.json$/.test(f)))
  JSON.parse(fs.readFileSync(path.join(INC, f))).forEach(v => { if (!lookup.has(v.youtubeId)) lookup.set(v.youtubeId, v); });

const adfree = JSON.parse(fs.readFileSync(path.join(INC, 'adfree-final.json'), 'utf-8'));
const out = [];
const missing = [];
for (const { youtubeId } of adfree) {
  const e = lookup.get(youtubeId);
  if (!e) { missing.push(youtubeId); continue; }
  const entry = {
    id: e.id || `yt-${youtubeId}`,
    title: e.title,
    youtubeId,
    topic: e.topic,
    grade: Array.isArray(e.grade) && e.grade.length ? e.grade : ['저학년','중학년','고학년'],
    minutes: Number(e.minutes) > 0 ? Number(e.minutes) : 6,
    description: e.description,
    ideas: (e.ideas || []).filter(Boolean).slice(0, 3),
  };
  if (Array.isArray(e.occasions) && e.occasions.length) entry.occasions = e.occasions;
  out.push(entry);
}
out.sort((a, b) => TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf-8');

console.error(`구성 완료: ${out.length}편 (소스 없음 ${missing.length})`);
const tc = {}; out.forEach(v => tc[v.topic] = (tc[v.topic] || 0) + 1);
TOPIC_ORDER.forEach(t => console.error(`  ${t}: ${tc[t] || 0}`));
const occ = out.filter(v => v.occasions && v.occasions.length).length;
console.error(`계기 태그: ${occ}편`);
if (missing.length) console.error('누락 ID: ' + missing.join(' '));
