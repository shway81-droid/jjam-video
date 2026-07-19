#!/usr/bin/env node
/** .incoming/fill-*.json (주제 보강분) → data/videos.json 병합 */
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

const videos = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
const byId = new Set(videos.map(v => v.youtubeId));
const issues = [];
let added = 0;

for (const f of fs.readdirSync(INC).filter(f => /^fill-.*\.json$/.test(f)).sort()) {
  for (const v of JSON.parse(fs.readFileSync(path.join(INC, f), 'utf-8'))) {
    const id = v.youtubeId;
    if (!id) { issues.push(`빈 id (${f})`); continue; }
    if (byId.has(id)) { issues.push(`중복 ${id} (${f})`); continue; }
    if (!TOPICS.has(v.topic)) { issues.push(`잘못된 topic "${v.topic}" ${id}`); continue; }
    const grade = Array.isArray(v.grade) ? v.grade.filter(g => GRADES.has(g)) : [];
    const minutes = Number(v.minutes);
    if (!v.title || !v.description || !Array.isArray(v.ideas) || v.ideas.filter(Boolean).length < 1) { issues.push(`필드 누락 ${id}`); continue; }
    videos.push({
      id: v.id || `yt-${id}`,
      title: String(v.title).trim(),
      youtubeId: id,
      topic: v.topic,
      grade: grade.length ? grade : ['저학년','중학년','고학년'],
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 6,
      description: String(v.description).trim(),
      ideas: v.ideas.filter(Boolean).slice(0, 3).map(s => String(s).trim()),
    });
    byId.add(id);
    added++;
  }
}

videos.sort((a, b) => TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
fs.writeFileSync(OUT, JSON.stringify(videos, null, 2) + '\n', 'utf-8');

console.error(`신규 병합 ${added}개 · 총 ${videos.length}개`);
const tc = {}; videos.forEach(v => tc[v.topic] = (tc[v.topic]||0)+1);
console.error('\n주제별 수 (15 미만 표시):');
TOPIC_ORDER.forEach(t => console.error(`  ${t}: ${tc[t]||0}${(tc[t]||0) < 15 ? '  ⚠️ 15 미만' : ''}`));
if (issues.length) { console.error(`\n이슈 ${issues.length}건:`); issues.forEach(s => console.error('  - ' + s)); }
