#!/usr/bin/env node
/** 상업 채널 영상 제거 + 공공/교육 교체본(.incoming/repl-out-*.json) 반영 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'videos.json');
const INC = path.join(ROOT, '.incoming');

const TOPIC_ORDER = ['인성','진로','건강·보건','자기주도학습','생명존중','세계시민','가족','역사','다문화','학교폭력예방','힐링·재미','경제','인권','독도','민주시민','예술·문화','스포츠','AI교육','미디어리터러시','장애인식개선','안전','과학·탐구','학급자치','통일','환경생태'];
const TOPICS = new Set(TOPIC_ORDER);
const GRADES = new Set(['저학년','중학년','고학년']);
const VALID_OCC = new Set(['삼일절','식목일','장애인의 날','과학의 날','지구의 날','어린이날','어버이날','스승의 날','세계인의 날','바다의 날','환경의 날','현충일','6·25 전쟁일','제헌절','광복절','푸른 하늘의 날','세계 평화의 날','노인의 날','개천절','한글날','독도의 날','학생독립운동기념일','소비자의 날','세계 인권 선언일','설날','3·15 의거 기념일','4·19 혁명 기념일','부처님오신날','6·15 남북공동선언 기념일','정보보호의 날','추석','국군의 날','스포츠의 날','부마민주항쟁 기념일','경찰의 날','국제연합일','금융의 날','지방자치 및 균형발전의 날','소방의 날','농업인의 날','순국선열의 날','세계 장애인의 날','무역의 날','성탄절']);

// 제거 대상(상업 채널)
const removeIds = new Set(JSON.parse(fs.readFileSync(path.join(INC, 'commercial-videos.json'), 'utf-8')).map(v => v.youtubeId));

let videos = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
const before = videos.length;
videos = videos.filter(v => !removeIds.has(v.youtubeId));
const removed = before - videos.length;

const byId = new Set(videos.map(v => v.youtubeId));
const issues = [];
let added = 0;

for (let i = 1; i <= 5; i++) {
  const p = path.join(INC, `repl-out-${i}.json`);
  if (!fs.existsSync(p)) { issues.push(`파일 없음 repl-out-${i}.json`); continue; }
  for (const v of JSON.parse(fs.readFileSync(p, 'utf-8'))) {
    const id = v.youtubeId;
    if (!id) { issues.push(`빈 id (${i})`); continue; }
    if (byId.has(id)) { issues.push(`중복 ${id}`); continue; }
    if (!TOPICS.has(v.topic)) { issues.push(`잘못된 topic "${v.topic}" ${id}`); continue; }
    const occs = (Array.isArray(v.occasions) ? v.occasions : []).filter(o => VALID_OCC.has(o));
    const grade = Array.isArray(v.grade) ? v.grade.filter(g => GRADES.has(g)) : [];
    const minutes = Number(v.minutes);
    if (!v.title || !v.description || !Array.isArray(v.ideas) || v.ideas.filter(Boolean).length < 1) { issues.push(`필드 누락 ${id}`); continue; }
    const entry = {
      id: v.id || `yt-${id}`,
      title: String(v.title).trim(),
      youtubeId: id,
      topic: v.topic,
      grade: grade.length ? grade : ['저학년','중학년','고학년'],
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 6,
      description: String(v.description).trim(),
      ideas: v.ideas.filter(Boolean).slice(0, 3).map(s => String(s).trim()),
    };
    if (occs.length) entry.occasions = occs;
    videos.push(entry);
    byId.add(id);
    added++;
  }
}

videos.sort((a, b) => TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
fs.writeFileSync(OUT, JSON.stringify(videos, null, 2) + '\n', 'utf-8');

console.error(`상업 제거 ${removed}편 · 공공 교체 추가 ${added}편 · 총 ${videos.length}편`);
const tc = {}; videos.forEach(v => tc[v.topic] = (tc[v.topic]||0)+1);
console.error('\n주제별 수 (15 미만 ⚠️):');
TOPIC_ORDER.forEach(t => console.error(`  ${t}: ${tc[t]||0}${(tc[t]||0) < 15 ? '  ⚠️' : ''}`));
if (issues.length) { console.error(`\n이슈 ${issues.length}건:`); issues.forEach(s => console.error('  - ' + s)); }
