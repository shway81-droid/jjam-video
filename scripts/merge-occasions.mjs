#!/usr/bin/env node
/**
 * 계기교육 영상 병합 + 기존 영상 태깅.
 * - TAG_MAP: 기존 영상(youtubeId)에 occasions 태그 추가
 * - .incoming/occ-*.json: 계기 전용 신규 영상 병합(중복·유효성 검사)
 * - occasion 이름은 app.js CALENDAR와 정확히 일치해야 함
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'videos.json');
const INC = path.join(ROOT, '.incoming');

const TOPIC_ORDER = ['인성','진로','건강·보건','생명존중','세계시민','가족','역사','다문화','학교폭력예방','힐링·재미','경제','인권','독도','민주시민','예술·문화','스포츠','AI교육','미디어리터러시','장애인식개선','안전','과학·탐구','학급자치','통일','환경생태'];
const TOPICS = new Set(TOPIC_ORDER);
const VALID_OCC = new Set(['삼일절','식목일','장애인의 날','과학의 날','지구의 날','어린이날','어버이날','스승의 날','세계인의 날','바다의 날','환경의 날','현충일','6·25 전쟁일','제헌절','광복절','푸른 하늘의 날','세계 평화의 날','노인의 날','개천절','한글날','독도의 날','학생독립운동기념일','소비자의 날','세계 인권 선언일']);
const GRADES = new Set(['저학년','중학년','고학년']);

// 기존 역사 독립운동 영상 → 삼일절/광복절 태깅
const TAG_MAP = {
  aQaUrYztMQQ: ['삼일절'],              // 유관순 열사
  zfdZp00VHiY: ['삼일절', '광복절'],     // 임시정부와 독립운동
  _kVg2CXPle0: ['광복절'],              // 김구와 독립운동
  SYcfVkdJsXw: ['광복절'],              // 광복군과 8.15 광복
  P3eG68iRa1k: ['광복절'],              // 백범 김구
  '3AF-Fjz39vc': ['광복절'],            // 윤봉길과 이봉창
};

const videos = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
const byId = new Map(videos.map(v => [v.youtubeId, v]));

// 1) 기존 영상 태깅
let tagged = 0;
for (const [id, occ] of Object.entries(TAG_MAP)) {
  const v = byId.get(id);
  if (v) { v.occasions = occ; tagged++; }
  else console.error(`  ! TAG_MAP 대상 없음: ${id}`);
}

// 2) 신규 계기 영상 병합
const issues = [];
let added = 0;
for (const f of ['occ-1.json', 'occ-2.json']) {
  const p = path.join(INC, f);
  if (!fs.existsSync(p)) continue;
  for (const v of JSON.parse(fs.readFileSync(p, 'utf-8'))) {
    const id = v.youtubeId;
    if (!id) { issues.push(`빈 id (${f})`); continue; }
    if (byId.has(id)) { issues.push(`중복 ${id} (${f})`); continue; }
    if (!TOPICS.has(v.topic)) { issues.push(`잘못된 topic "${v.topic}" ${id}`); continue; }
    const occs = (Array.isArray(v.occasions) ? v.occasions : []).filter(o => VALID_OCC.has(o));
    if (!occs.length) { issues.push(`유효 occasion 없음 ${id} (${JSON.stringify(v.occasions)})`); continue; }
    const grade = Array.isArray(v.grade) ? v.grade.filter(g => GRADES.has(g)) : [];
    const minutes = Number(v.minutes);
    if (!v.title || !v.description || !Array.isArray(v.ideas) || v.ideas.length < 1) { issues.push(`필드 누락 ${id}`); continue; }
    const entry = {
      id: v.id || `yt-${id}`,
      title: String(v.title).trim(),
      youtubeId: id,
      topic: v.topic,
      occasions: occs,
      grade: grade.length ? grade : ['저학년','중학년','고학년'],
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 6,
      description: String(v.description).trim(),
      ideas: v.ideas.slice(0, 3).map(s => String(s).trim()),
    };
    videos.push(entry);
    byId.set(id, entry);
    added++;
  }
}

videos.sort((a, b) => TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
fs.writeFileSync(OUT, JSON.stringify(videos, null, 2) + '\n', 'utf-8');

// 리포트
const occCount = {};
videos.forEach(v => (v.occasions || []).forEach(o => occCount[o] = (occCount[o] || 0) + 1));
console.error(`기존 태깅 ${tagged}개 · 신규 병합 ${added}개 · 총 ${videos.length}개`);
console.error('\n계기별 영상 수(태그 기준):');
[...VALID_OCC].forEach(o => { if (occCount[o]) console.error(`  ${o}: ${occCount[o]}`); });
console.error('\n(태그 없는 계기는 앱에서 주제로 폴백됨: 독도의 날→독도, 환경 관련일→환경생태 등)');
if (issues.length) { console.error(`\n스킵 ${issues.length}건:`); issues.forEach(s => console.error('  - ' + s)); }
