/* ===================================================================
   data/videos.json → 런처가 받는 파생 데이터 생성
   ===================================================================
   사람이 고치는 단일 소스는 계속 data/videos.json 하나다(README 그대로).
   이 스크립트가 거기서 두 개의 파생 파일을 만든다.

     data/videos.index.json   목록·필터·검색에 필요한 필드만, 공백 없이
     data/videos.detail.json  모달을 열 때만 쓰는 필드(ideas), 공백 없이

   왜 나누나:
   - videos.json 은 사람이 읽기 좋게 들여쓰기가 들어가 있어 절반 이상이 공백이다.
   - `ideas`(활용 아이디어 3가지)는 카드 그리드에서 전혀 쓰지 않는데도
     첫 화면에서 425편치를 전부 내려받고 있었다.
   - `description` 은 검색 대상이라(app.js: title+description+topic) 목록에 남긴다.

   실행:
     node scripts/gen-data.mjs           파생 파일 생성
     node scripts/gen-data.mjs --check   생성물이 최신인지 확인 (CI 게이트)
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const SOURCE = path.join(ROOT, 'data', 'videos.json');
const INDEX = path.join(ROOT, 'data', 'videos.index.json');
const DETAIL = path.join(ROOT, 'data', 'videos.detail.json');

// 목록에서 쓰지 않는 필드 — 모달 전용
const DETAIL_FIELDS = ['ideas'];

const videos = JSON.parse(fs.readFileSync(SOURCE, 'utf-8'));

const index = videos.map((v) => {
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (!DETAIL_FIELDS.includes(k)) out[k] = val;
  }
  return out;
});

const detail = {};
for (const v of videos) {
  const d = {};
  for (const k of DETAIL_FIELDS) if (v[k] !== undefined) d[k] = v[k];
  if (Object.keys(d).length) detail[v.id] = d;
}

const outputs = [
  { file: INDEX, name: 'videos.index.json', json: JSON.stringify(index) },
  { file: DETAIL, name: 'videos.detail.json', json: JSON.stringify(detail) },
];

let drift = false;
for (const o of outputs) {
  const before = fs.existsSync(o.file) ? fs.readFileSync(o.file, 'utf-8') : null;
  if (before === o.json) {
    console.log(`  = data/${o.name} 최신 상태`);
  } else if (CHECK) {
    drift = true;
    console.log(`  ✗ data/${o.name} 가 videos.json 과 불일치 — \`node scripts/gen-data.mjs\` 실행 필요`);
  } else {
    fs.writeFileSync(o.file, o.json);
    console.log(`  ↻ data/${o.name} 생성 (${(o.json.length / 1024).toFixed(1)} KB)`);
  }
}

if (drift) {
  console.error('\n❌ 파생 데이터가 최신이 아닙니다.');
  process.exit(1);
}

const srcKB = (fs.statSync(SOURCE).size / 1024).toFixed(1);
const idxKB = (outputs[0].json.length / 1024).toFixed(1);
const detKB = (outputs[1].json.length / 1024).toFixed(1);
console.log(`\n✅ 파생 데이터 ${CHECK ? '동기화 확인' : '생성 완료'} — ` +
  `원본 ${srcKB} KB → 첫 화면 ${idxKB} KB (+ 모달용 ${detKB} KB는 나중에 따로 받음)`);
