#!/usr/bin/env node
/**
 * 유튜브 링크 목록 → videos.json 항목 가져오기 도구
 *
 * 사용법:
 *   1) scripts/urls.txt 에 한 줄에 하나씩 적는다. 형식(파이프로 구분, 뒷부분 생략 가능):
 *        주제 | 학년 | 분 | 유튜브URL
 *      예)
 *        역사 | 고 | 8 | https://youtu.be/abc123XYZ00
 *        안전 | 저중 | 6 | https://www.youtube.com/watch?v=def456...
 *        https://youtu.be/onlyurl0000        (메타 없이 URL만 — 나중에 채움)
 *      · 학년: 저/중/고 조합 (저중고 = 전학년). 생략 시 전학년.
 *      · '#'으로 시작하는 줄과 빈 줄은 무시.
 *
 *   2) 검증만(붙여넣기용 JSON 출력):
 *        node scripts/import-videos.mjs
 *
 *   3) data/videos.json에 바로 병합(youtubeId 중복은 건너뜀):
 *        node scripts/import-videos.mjs --merge
 *
 * 각 URL은 유튜브 oEmbed로 검증한다 → 존재/임베드 가능 여부 확인 + 실제 제목 취득.
 * (비공개·삭제·임베드 불가 영상은 걸러져 로그에 남는다.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const URLS_FILE = path.join(__dirname, 'urls.txt');
const OUT_FILE = path.join(ROOT, 'data', 'videos.json');

const GRADE_MAP = { 저: '저학년', 중: '중학년', 고: '고학년' };

// ── URL에서 11자리 영상 ID 추출 ──────────────────────────
function extractId(url) {
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

// ── 학년 문자열 → 배열 ("저중" → ["저학년","중학년"]) ─────
function parseGrade(s) {
  if (!s) return ['저학년', '중학년', '고학년'];
  const set = [];
  for (const ch of s.replace(/\s/g, '')) if (GRADE_MAP[ch]) set.push(GRADE_MAP[ch]);
  return set.length ? set : ['저학년', '중학년', '고학년'];
}

// ── 한 줄 파싱 ────────────────────────────────────────────
function parseLine(line) {
  const parts = line.split('|').map(s => s.trim());
  const url = parts[parts.length - 1];
  const id = extractId(url);
  if (!id) return null;
  // 뒤에서부터 url, 그 앞이 분/학년/주제
  const meta = parts.slice(0, -1);
  return {
    youtubeId: id,
    topic: meta[0] || '기타',
    grade: parseGrade(meta[1]),
    minutes: meta[2] ? Number(meta[2]) : null,
  };
}

// ── 유튜브 oEmbed 검증(제목 취득 + 임베드 가능 확인) ──────
async function verify(id) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} (비공개/삭제/임베드 불가 추정)` };
    const j = await res.json();
    return { ok: true, title: j.title, author: j.author_name };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ── 메인 ──────────────────────────────────────────────────
async function main() {
  const merge = process.argv.includes('--merge');

  if (!fs.existsSync(URLS_FILE)) {
    console.error(`urls.txt가 없습니다: ${URLS_FILE}\n예시 형식은 이 스크립트 상단 주석 참고.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(URLS_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8')) : [];
  const existingIds = new Set(existing.map(v => v.youtubeId));

  const entries = [];
  const skipped = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) { skipped.push({ line, reason: '유튜브 ID 추출 실패' }); continue; }
    if (existingIds.has(parsed.youtubeId)) { skipped.push({ line, reason: '이미 등록됨(중복)' }); continue; }

    const v = await verify(parsed.youtubeId);
    if (!v.ok) { skipped.push({ line, reason: v.reason }); continue; }

    entries.push({
      id: `yt-${parsed.youtubeId}`,
      title: v.title,
      youtubeId: parsed.youtubeId,
      topic: parsed.topic,
      grade: parsed.grade,
      minutes: parsed.minutes ?? 5,      // 미기입 시 5분 기본(추후 수정)
      description: '',                    // ← 한 줄 소개 채우기
      ideas: ['', '', ''],               // ← 수업 활용법 3가지 채우기
      _author: v.author,                  // 참고용(채널명), 최종본에선 지워도 됨
    });
    existingIds.add(parsed.youtubeId);
    console.error(`  ✓ ${parsed.youtubeId}  ${v.title}`);
  }

  console.error(`\n검증 통과: ${entries.length}개 / 건너뜀: ${skipped.length}개`);
  skipped.forEach(s => console.error(`  ✗ ${s.reason} — ${s.line}`));

  if (merge) {
    const merged = existing.concat(entries.map(({ _author, ...e }) => e));
    fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    console.error(`\n→ ${OUT_FILE}에 ${entries.length}개 병합 완료 (총 ${merged.length}개). description·ideas·minutes를 채우세요.`);
  } else {
    // 붙여넣기용 JSON을 표준출력으로
    console.log(JSON.stringify(entries, null, 2));
  }
}

main();
