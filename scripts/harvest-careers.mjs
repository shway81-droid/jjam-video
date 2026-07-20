#!/usr/bin/env node
/**
 * 진로교육(직업 인터뷰) 영상 일괄 수집 → data/videos.json 병합.
 *   node scripts/harvest-careers.mjs         # 미리보기(파일 미수정)
 *   node scripts/harvest-careers.mjs --write # 통과분을 videos.json에 실제 추가
 *
 * 입력: scripts/careers-input.json  [{ n, job, id }]  (직업명 + 유튜브 11자리 ID)
 *
 * 길이·제목 확보 방법:
 *   • YT_API_KEY 환경변수가 있으면 → YouTube Data API v3 (권장·정확).
 *     공식 API라 GitHub Actions 등 데이터센터 IP에서도 봇 차단 없이 동작한다.
 *   • 키가 없으면 → oEmbed(제목) + InnerTube/Invidious/Piped(길이).
 *     단, YouTube가 데이터센터 IP의 길이 조회를 광범위하게 차단하므로 CI에선 대부분 실패한다.
 *     이 경로는 사용자 PC(주거용 IP) 등에서만 안정적으로 동작한다.
 * 통과 기준(이 사이트의 "짬짬이" 원칙):
 *   - 임베드 가능
 *   - 길이 3~10분 (TIME_BUCKETS 범위 = 정확일치 필터 대상)
 * 통과분만 topic:"진로" 항목으로 생성해 기존과 중복 제거 후 추가한다.
 *
 * ※ 광고 여부는 자동 판정하지 않는다(watch 페이지 봇 차단으로 CI에서 불가).
 *   기존 264편의 "무광고 검증" 기준과 달리 이 배치는 광고 미검증이므로,
 *   필요하면 사이트 접근이 자유로운 환경에서 scripts/check-ads.mjs 로 사후 점검한다.
 * ※ youtube.com oEmbed 가 대부분 막힌 egress 차단 환경에서는 아무것도 추가하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIDEOS = path.join(ROOT, 'data', 'videos.json');
// 입력 목록: 커밋되는 scripts/careers-input.json 우선, 없으면 .incoming 폴백.
const RAW = [path.join(ROOT, 'scripts', 'careers-input.json'), path.join(ROOT, '.incoming', 'careers-raw.json')]
  .find(p => fs.existsSync(p));
const WRITE = process.argv.includes('--write');

const MIN_MIN = 3, MAX_MIN = 10;                 // TIME_BUCKETS 범위
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(path.join(ROOT, '.incoming'), { recursive: true });
console.log(process.env.YT_API_KEY
  ? '· 길이·제목 조회: YouTube Data API v3 (권장)'
  : '· 길이·제목 조회: oEmbed+InnerTube/프록시 (키 없음 — CI에선 대부분 실패, 주거용 IP 권장)');
const videos = JSON.parse(fs.readFileSync(VIDEOS, 'utf-8'));
const existing = new Set(videos.map(v => v.youtubeId));
const raw = JSON.parse(fs.readFileSync(RAW, 'utf-8'));

async function oembed(id) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (r.ok) { const j = await r.json(); return { ok: true, title: j.title, author: j.author_name }; }
      if (r.status === 401) return { ok: false, reason: '임베드차단' };
      if (r.status === 404) return { ok: false, reason: '삭제/비공개' };
      if (r.status === 403) return { ok: false, reason: 'egress차단(google 미허용)', blocked: true };
    } catch { /* 재시도 */ }
    await sleep(700);
  }
  return { ok: false, reason: 'rate-limit 의심' };
}

// 영상 길이(초) 조회.
// youtube watch 페이지는 데이터센터/CI IP에서 봇 차단(동의창)으로 lengthSeconds를 못 읽는다.
// 대신 공개 프록시(Invidious/Piped) API를 여러 인스턴스 폴백으로 사용한다.
const INVIDIOUS = [
  'https://invidious.nerdvpn.de', 'https://inv.nadeko.net', 'https://invidious.jing.rocks',
];
const PIPED = [
  'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de',
];

async function fetchJson(url, ms = 4000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

// YouTube InnerTube player API — watch 페이지(동의창)와 달리 데이터센터/CI IP에서도
// videoDetails.lengthSeconds 를 얻을 수 있다. 클라이언트별로 응답이 다르므로
// WEB → ANDROID → iOS 순으로 시도하고 하나라도 길이가 나오면 채택한다.
const IT_CLIENTS = [
  { key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', ua: 'Mozilla/5.0', client: { clientName: 'WEB', clientVersion: '2.20240401.00.00', hl: 'ko', gl: 'KR' } },
  { key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
  { key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc', ua: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)', client: { clientName: 'IOS', clientVersion: '19.09.3', hl: 'ko', gl: 'KR' } },
];
async function innertubeSec(id) {
  for (const c of IT_CLIENTS) {
    try {
      const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${c.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua },
        body: JSON.stringify({ videoId: id, context: { client: c.client } }),
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) { const j = await r.json(); const s = Number(j?.videoDetails?.lengthSeconds || 0); if (s > 0) return s; }
    } catch { /* 다음 클라이언트 */ }
  }
  return 0;
}

// ── YouTube Data API v3 (권장) ────────────────────────────
// 공식 API라 데이터센터/CI IP에서도 봇 차단 없이 길이·제목·임베드여부를 정확히 준다.
// 환경변수 YT_API_KEY 가 있으면 최우선 사용. (videos.list 1건당 1 unit, 180편=180 unit)
const YT_KEY = process.env.YT_API_KEY || '';
function iso8601ToSec(s) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || '');
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}
async function dataApiMeta(id) {
  try {
    const j = await fetchJson(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet,status&id=${id}&key=${YT_KEY}`, 8000);
    const it = j.items && j.items[0];
    if (!it) return { exists: false };
    return {
      exists: true,
      sec: iso8601ToSec(it.contentDetails?.duration),
      title: it.snippet?.title || '',
      embeddable: it.status?.embeddable !== false,
    };
  } catch { return { exists: true, sec: 0 }; }   // API 오류 → 길이확인실패로 처리
}

// idx 로 인스턴스를 회전시켜 특정 인스턴스에 부하가 몰리지 않게 한다.
async function durationSec(id, idx = 0) {
  const it = await innertubeSec(id);
  if (it > 0) return it;
  const inv = INVIDIOUS.map((_, k) => INVIDIOUS[(idx + k) % INVIDIOUS.length]);
  const pip = PIPED.map((_, k) => PIPED[(idx + k) % PIPED.length]);
  for (const base of inv) {
    try {
      const j = await fetchJson(`${base}/api/v1/videos/${id}?fields=lengthSeconds`);
      const sec = Number(j.lengthSeconds || 0);
      if (sec > 0) return sec;
    } catch { /* 다음 인스턴스 */ }
  }
  for (const base of pip) {
    try {
      const j = await fetchJson(`${base}/streams/${id}`);
      const sec = Number(j.duration || 0);
      if (sec > 0) return sec;
    } catch { /* 다음 인스턴스 */ }
  }
  return 0;
}

// 한국어 조사 선택: 마지막 글자 받침 유무로 이/가·을/를 등을 고른다.
// (한글이 아니면 받침 없음으로 간주 → 영문·숫자로 끝나는 직업명도 자연스럽게 처리)
function hasBatchim(word) {
  if (!word) return false;
  // 끝의 괄호·공백 등은 건너뛰고 마지막 '의미 글자'로 판정.
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word.charCodeAt(i);
    if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28 !== 0;   // 한글 → 받침 유무
    if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) return false; // 영문·숫자 → 받침 없음 취급
    // 그 외(괄호·기호·공백) → 계속 앞으로
  }
  return false;
}
const josa = (w, withB, noB) => w + (hasBatchim(w) ? withB : noB);

// 직업명 기반 설명·활용아이디어(사이트 톤에 맞춘 템플릿).
function buildDesc(job) {
  if (!job) return '실제 직업인의 하루와 일하는 모습을 생생하게 들여다보는 진로 탐색 영상이에요.';
  return `${josa(job, '이', '가')} 실제로 어떤 일을 하고 어떤 하루를 보내는지 생생하게 보여 주는 진로 탐색 영상이에요.`;
}
function buildIdeas(job) {
  const j = job || '이 직업';
  return [
    `${josa(j, '이', '가')} 하는 일과 필요한 능력을 한 가지씩 적어 보기`,
    `이 직업의 좋은 점과 힘든 점을 짝과 이야기 나누기`,
    `내 흥미·강점과 이 직업이 어울리는지 별점으로 표시하고 이유 말하기`,
  ];
}

const kept = [], dropped = [];
let blockedCount = 0, i = 0, done = 0;

async function worker() {
  while (i < raw.length) {
    const idx = i, r = raw[i++];
    let title = '', sec = 0, embeddable = true, why = null;
    if (YT_KEY) {
      // 권장 경로: 공식 Data API 한 번으로 제목·길이·임베드여부 확보.
      const d = await dataApiMeta(r.id);
      if (d.exists === false) why = '삭제/비공개';
      else { title = d.title; sec = d.sec; embeddable = d.embeddable; }
    } else {
      // 키 없음: oEmbed(제목·임베드) + InnerTube/프록시(길이). CI에서는 길이 조회가 자주 막힘.
      const emb = await oembed(r.id);
      if (emb.blocked) { blockedCount++; done++; continue; }
      if (!emb.ok) why = emb.reason;
      else { title = emb.title; sec = await durationSec(r.id, idx); }
    }
    if (why) { dropped.push({ ...r, why }); done++; await sleep(80); continue; }
    if (!embeddable) { dropped.push({ ...r, why: '임베드차단' }); done++; await sleep(80); continue; }
    const minutes = Math.round(sec / 60);
    if (!sec) { dropped.push({ ...r, why: '길이확인실패' }); done++; await sleep(80); continue; }
    if (minutes < MIN_MIN || minutes > MAX_MIN) { dropped.push({ ...r, why: `길이 ${minutes}분(범위밖)`, sec }); done++; await sleep(80); continue; }
    kept.push({
      id: `yt-${r.id}`,
      // 카드 제목: 직업명 우선(간결). 직업명이 없으면 실제 유튜브 제목.
      title: r.job || title || '진로 영상',
      youtubeId: r.id,
      topic: '진로',
      grade: ['중학년', '고학년'],
      minutes,
      description: buildDesc(r.job),
      ideas: buildIdeas(r.job),
    });
    done++;
    if (done % 10 === 0) process.stderr.write(`  ...${done}/${raw.length} (통과 ${kept.length})\n`);
    await sleep(80);
  }
}

const CONC = 4;
await Promise.all(Array.from({ length: CONC }, worker));

console.log(`\n===== 진로 영상 수집 결과 =====`);
console.log(`입력 ${raw.length}편 · 통과 ${kept.length}편 · 제외 ${dropped.length}편 · oEmbed차단 ${blockedCount}편`);
// oEmbed(youtube.com) 자체가 대부분 막힌 경우 = egress 차단 환경 → 반영하지 않고 종료.
if (blockedCount > raw.length / 2) {
  console.log(`\n⚠️  대부분(${blockedCount}편)이 youtube.com 차단으로 조회 불가 → egress 차단 환경.`);
  console.log(`   YouTube 접근이 가능한 환경(GitHub Actions 등)에서 실행하세요. (아무것도 추가하지 않음)`);
  process.exit(2);
}
if (dropped.length) {
  console.log(`\n[제외 목록]`);
  dropped.forEach(d => console.log(`  ✗ ${d.why} | #${d.n} ${d.job || '(제목미표시)'} | ${d.id}`));
}
// 통과분 중 기존 중복 최종 제거
const fresh = kept.filter(v => !existing.has(v.youtubeId));
console.log(`\n통과 ${kept.length}편 중 신규 ${fresh.length}편(기존중복 ${kept.length - fresh.length} 제외).`);

// 통과분은 항상 백업(아티팩트/복구용).
fs.writeFileSync(path.join(ROOT, '.incoming', 'careers-kept.json'), JSON.stringify(fresh, null, 2));
if (WRITE && fresh.length) {
  const merged = videos.concat(fresh);
  fs.writeFileSync(VIDEOS, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\n✅ data/videos.json 에 ${fresh.length}편 추가 (총 ${merged.length}편).`);
} else if (!WRITE) {
  console.log(`\n미리보기 모드. --write 로 실제 반영. (통과분 .incoming/careers-kept.json 저장)`);
}
