#!/usr/bin/env node
/**
 * .incoming/agent-*.json 큐레이션 결과를 data/videos.json에 병합.
 * - youtubeId 기준 중복 제거(기존 우선)
 * - 스키마·주제명 검증, minutes/grade 정규화
 * - 실제 영상이 생긴 주제의 [예시] placeholder 제거(0개인 주제만 유지)
 * - (옵션) --verify: 전 영상 oEmbed 재검증, 실패분 제외
 * - TOPIC_ORDER 순으로 정렬해 저장
 */
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

const existing = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
const realExisting = existing.filter(v => v.youtubeId && v.youtubeId !== 'SAMPLE');
const placeholders = existing.filter(v => v.youtubeId === 'SAMPLE');

// 에이전트 결과 로드
const incoming = [];
for (const f of fs.readdirSync(INC).filter(f => /^agent-.*\.json$/.test(f))) {
  const arr = JSON.parse(fs.readFileSync(path.join(INC, f), 'utf-8'));
  arr.forEach(x => incoming.push({ ...x, _src: f }));
}

const seen = new Set(realExisting.map(v => v.youtubeId));
const issues = [];
const accepted = [...realExisting];

for (const v of incoming) {
  const id = v.youtubeId;
  if (!id || id === 'SAMPLE') { issues.push(`빈 youtubeId (${v._src})`); continue; }
  if (seen.has(id)) { issues.push(`중복 ${id} (${v._src})`); continue; }
  if (!TOPICS.has(v.topic)) { issues.push(`잘못된 주제 "${v.topic}" ${id} (${v._src})`); continue; }
  const grade = Array.isArray(v.grade) ? v.grade.filter(g => GRADES.has(g)) : [];
  const minutes = Number(v.minutes);
  if (!v.title || !v.description || !Array.isArray(v.ideas) || v.ideas.length < 1) {
    issues.push(`필드 누락 ${id} (${v._src})`); continue;
  }
  seen.add(id);
  accepted.push({
    id: v.id || `yt-${id}`,
    title: String(v.title).trim(),
    youtubeId: id,
    topic: v.topic,
    grade: grade.length ? grade : ['저학년','중학년','고학년'],
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 5,
    description: String(v.description).trim(),
    ideas: v.ideas.slice(0, 3).map(s => String(s).trim()),
  });
}

async function verifyAll(list) {
  const results = new Map();
  let i = 0;
  const workers = Array.from({ length: 10 }, async () => {
    while (i < list.length) {
      const v = list[i++];
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${v.youtubeId}&format=json`);
        results.set(v.youtubeId, r.ok);
      } catch { results.set(v.youtubeId, false); }
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  let finalReal = accepted;
  if (process.argv.includes('--verify')) {
    process.stderr.write(`재검증 중 (${accepted.length}개)...\n`);
    const res = await verifyAll(accepted);
    const before = finalReal.length;
    finalReal = accepted.filter(v => res.get(v.youtubeId));
    const dropped = accepted.filter(v => !res.get(v.youtubeId));
    process.stderr.write(`재검증 완료: 통과 ${finalReal.length} / 제외 ${before - finalReal.length}\n`);
    dropped.forEach(v => process.stderr.write(`  ✗ 제외 ${v.youtubeId} (${v.topic}) ${v.title}\n`));
  }

  const topicsWithReal = new Set(finalReal.map(v => v.topic));
  const keptPlaceholders = placeholders.filter(p => !topicsWithReal.has(p.topic));

  const all = [...finalReal, ...keptPlaceholders];
  all.sort((a, b) => {
    const ta = TOPIC_ORDER.indexOf(a.topic), tb = TOPIC_ORDER.indexOf(b.topic);
    return ta - tb;
  });

  fs.writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n', 'utf-8');

  // 리포트
  const byTopic = {};
  finalReal.forEach(v => byTopic[v.topic] = (byTopic[v.topic] || 0) + 1);
  process.stderr.write(`\n총 ${all.length}개 (실제 ${finalReal.length} · 예시 ${keptPlaceholders.length})\n`);
  process.stderr.write('주제별 실제 영상 수:\n');
  TOPIC_ORDER.forEach(t => process.stderr.write(`  ${t}: ${byTopic[t] || 0}${topicsWithReal.has(t) ? '' : ' (예시)'}\n`));
  if (issues.length) {
    process.stderr.write(`\n스킵/이슈 ${issues.length}건:\n`);
    issues.forEach(s => process.stderr.write(`  - ${s}\n`));
  }
})();
