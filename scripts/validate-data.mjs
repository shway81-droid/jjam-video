/* ===================================================================
   data/videos.json 정적 검증 — CI 게이트 (.github/workflows/ci.yml)
   ===================================================================
   빌드 단계가 없는 정적 사이트라, 잘못된 데이터는 배포된 뒤 화면에서야 드러난다.
   여기서 "런처(app.js)가 실제로 소화할 수 있는 데이터인가"를 미리 확인한다.

   검증 기준은 app.js의 상수에서 직접 읽어 온다(하드코딩 X).
   → app.js와 데이터가 따로 노는 상황(예: 학년 이름을 바꿨는데 데이터는 그대로)을 잡는다.

   실행: node scripts/validate-data.mjs
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ── app.js에서 검증 기준 상수 추출 ────────────────────────────────
// 패턴을 못 찾으면 조용히 넘어가지 않고 실패시킨다(리팩터링으로 검증이 무력화되는 것 방지).
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf-8');

function extract(label, re, parse) {
  const m = APP.match(re);
  if (!m) {
    err(`app.js에서 ${label}를 찾지 못했습니다 — 상수 이름이 바뀌었다면 이 스크립트도 함께 고쳐야 합니다.`);
    return null;
  }
  return parse(m);
}

const TIME_BUCKETS = extract('TIME_BUCKETS', /const TIME_BUCKETS = \[([^\]]*)\]/, (m) =>
  m[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)));

const GRADES = extract('GRADES', /const GRADES = \[([^\]]*)\]/, (m) =>
  [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

const TOPIC_ORDER = extract('TOPIC_ORDER', /const TOPIC_ORDER = \[([\s\S]*?)\];/, (m) =>
  [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

const CALENDAR_NAMES = extract('CALENDAR', /const CALENDAR = \[([\s\S]*?)\n\];/, (m) =>
  [...m[1].matchAll(/name:\s*'([^']+)'/g)].map((x) => x[1]));

const LUNAR_MD_RAW = extract('LUNAR_MD', /const LUNAR_MD = \{([\s\S]*?)\n\};/, (m) => m[1]);

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

// ── videos.json 로드 ─────────────────────────────────────────────
const DATA_PATH = path.join(ROOT, 'data', 'videos.json');
let videos;
try {
  videos = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
} catch (e) {
  console.error(`  ✗ data/videos.json 파싱 실패 — ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(videos) || videos.length === 0) {
  console.error('  ✗ data/videos.json 은 비어 있지 않은 배열이어야 합니다.');
  process.exit(1);
}

// ── 항목별 검증 ──────────────────────────────────────────────────
const REQUIRED = ['id', 'title', 'youtubeId', 'topic', 'grade', 'minutes', 'description', 'ideas'];
const OPTIONAL = ['occasions'];
const ALLOWED = new Set([...REQUIRED, ...OPTIONAL]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SAMPLE_ID = 'SAMPLE';   // app.js가 예시 카드로 처리하는 플레이스홀더
const seenId = new Map();
const seenYoutube = new Map();

const nonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';

videos.forEach((v, i) => {
  const where = `videos[${i}] (${v && v.id ? v.id : 'id 없음'})`;

  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    err(`${where}: 객체가 아닙니다.`);
    return;
  }

  for (const k of REQUIRED) {
    if (v[k] === undefined || v[k] === null) err(`${where}: 필수 필드 '${k}' 누락`);
  }
  // 오타 필드(youtubeID 등)가 조용히 무시되는 것을 막는다.
  for (const k of Object.keys(v)) {
    if (!ALLOWED.has(k)) err(`${where}: 알 수 없는 필드 '${k}'`);
  }

  if (!nonEmptyStr(v.id)) {
    err(`${where}: id 는 비어 있지 않은 문자열이어야 합니다.`);
  } else if (seenId.has(v.id)) {
    err(`${where}: id '${v.id}' 중복 (videos[${seenId.get(v.id)}]와 동일)`);
  } else {
    seenId.set(v.id, i);
  }

  if (!nonEmptyStr(v.title)) err(`${where}: title 이 비어 있습니다.`);
  if (!nonEmptyStr(v.description)) err(`${where}: description 이 비어 있습니다.`);

  if (v.youtubeId === SAMPLE_ID) {
    // app.js가 지원하는 예시 카드 플레이스홀더(README 참조). 배포본에 남지 않도록 알린다.
    warn(`${where}: youtubeId 가 '${SAMPLE_ID}' 예시 값입니다 — 실제 영상 ID로 바꿔 주세요.`);
  } else if (!nonEmptyStr(v.youtubeId) || !YOUTUBE_ID.test(v.youtubeId)) {
    err(`${where}: youtubeId '${v.youtubeId}' 형식 오류 — 영문·숫자·'-'·'_' 11자여야 합니다.`);
  } else if (seenYoutube.has(v.youtubeId)) {
    err(`${where}: youtubeId '${v.youtubeId}' 중복 (${seenYoutube.get(v.youtubeId)}와 같은 영상)`);
  } else {
    seenYoutube.set(v.youtubeId, v.id);
  }

  // 시간 필터는 '정확히 일치'로 동작한다(app.js: v.minutes !== state.time).
  // → TIME_BUCKETS 밖의 값은 어떤 시간 칩으로도 찾을 수 없는 영상이 된다.
  if (!Number.isInteger(v.minutes) || !TIME_BUCKETS.includes(v.minutes)) {
    err(`${where}: minutes ${v.minutes} 는 시간 필터(${TIME_BUCKETS.join('·')}분)로 찾을 수 없습니다.`);
  }

  if (!Array.isArray(v.grade) || v.grade.length === 0) {
    err(`${where}: grade 는 비어 있지 않은 배열이어야 합니다.`);
  } else {
    for (const g of v.grade) {
      if (!GRADES.includes(g)) err(`${where}: 알 수 없는 학년 '${g}' (가능: ${GRADES.join('·')})`);
    }
    if (new Set(v.grade).size !== v.grade.length) err(`${where}: grade 에 중복 값이 있습니다.`);
  }

  if (!nonEmptyStr(v.topic)) {
    err(`${where}: topic 이 비어 있습니다.`);
  } else if (!TOPIC_ORDER.includes(v.topic)) {
    // 치명적이지는 않다(app.js가 미등록 주제를 목록 뒤에 자동으로 붙임).
    warn(`${where}: 주제 '${v.topic}' 이 app.js의 TOPIC_ORDER 에 없어 필터 맨 뒤에 표시됩니다.`);
  }

  // README가 약속한 "수업 활용 아이디어 3가지" — 모달 레이아웃도 3개를 전제로 한다.
  if (!Array.isArray(v.ideas) || v.ideas.length !== 3) {
    err(`${where}: ideas 는 3개여야 합니다 (현재 ${Array.isArray(v.ideas) ? v.ideas.length : '배열 아님'}).`);
  } else if (!v.ideas.every(nonEmptyStr)) {
    err(`${where}: ideas 에 빈 항목이 있습니다.`);
  }

  if (v.occasions !== undefined) {
    if (!Array.isArray(v.occasions) || v.occasions.length === 0) {
      err(`${where}: occasions 는 비어 있지 않은 배열이어야 합니다.`);
    } else {
      for (const o of v.occasions) {
        // 달력에 없는 계기명은 어떤 계기 칩으로도 도달할 수 없다 → 태그가 사문화된다.
        if (!CALENDAR_NAMES.includes(o)) {
          err(`${where}: 계기 '${o}' 가 app.js의 CALENDAR 에 없습니다 — 이 태그로는 영상에 도달할 수 없습니다.`);
        }
      }
    }
  }
});

// ── 음력 명절 표 유효기간 ────────────────────────────────────────
// 표에 없는 연도는 계기 후보에서 조용히 빠지므로, 만료 전에 미리 알린다.
{
  const lunarNames = [...LUNAR_MD_RAW.matchAll(/'([^']+)':\s*\{([\s\S]*?)\}/g)];
  const thisYear = new Date().getFullYear();
  for (const [, name, body] of lunarNames) {
    const years = [...body.matchAll(/(\d{4}):/g)].map((m) => Number(m[1]));
    const last = Math.max(...years);
    if (last < thisYear) {
      err(`LUNAR_MD['${name}'] 표가 ${last}년에서 끝나 올해(${thisYear}) 날짜를 계산할 수 없습니다.`);
    } else if (last - thisYear <= 2) {
      warn(`LUNAR_MD['${name}'] 표가 ${last}년까지만 있습니다 — 연도를 더 채워 두세요.`);
    }
  }
}

// ── 결과 ─────────────────────────────────────────────────────────
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.error(`  ✗ ${e}`);

if (errors.length) {
  console.error(`\n❌ 영상 데이터 검증 실패 — 오류 ${errors.length}건`);
  process.exit(1);
}

console.log(`\n✅ 영상 데이터 검증 통과 — ${videos.length}편${warnings.length ? ` (경고 ${warnings.length}건)` : ''}`);
