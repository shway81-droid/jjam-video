#!/usr/bin/env node
/**
 * 진로교육(직업 인터뷰) 영상 일괄 수집 → data/videos.json 병합.
 *   node scripts/harvest-careers.mjs         # 미리보기(파일 미수정)
 *   node scripts/harvest-careers.mjs --write # 통과분을 videos.json에 실제 추가
 *
 * 입력: scripts/careers-input.json  [{ n, job, id }]  (직업명 + 유튜브 11자리 ID)
 *
 * 각 ID에 대해 YouTube에서 직접:
 *   1) oEmbed → 실제 제목·채널(임베드 가능=재생 가능 여부)
 *   2) watch 페이지 → lengthSeconds(길이) + adPlacements/playerAds(광고 여부)
 * 통과 기준(이 사이트의 "짬짬이·무광고" 원칙):
 *   - 임베드 가능
 *   - 길이 3~10분 (TIME_BUCKETS 범위 = 정확일치 필터 대상)
 *   - 광고 없음
 * 통과분만 topic:"진로" 항목으로 생성해 기존과 중복 제거 후 추가한다.
 *
 * ※ YouTube(google) 도메인에 egress가 열린 환경에서 실행해야 한다.
 *   차단된 환경에서는 각 항목이 blocked 로 집계되어 아무것도 추가하지 않는다.
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

async function meta(id) {
  for (let a = 0; a < 4; a++) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ko&gl=KR`,
        { headers: {
          'Accept-Language': 'ko-KR',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          // 데이터센터/EU IP에서 뜨는 동의창 우회 (CI 러너 대응)
          'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI',
        } });
      if (res.status === 403) return { blocked: true };
      const html = await res.text();
      if (!/"videoDetails"|"playabilityStatus"/.test(html)) { await sleep(900); continue; }
      const sec = Number((html.match(/"lengthSeconds":"(\d+)"/) || [])[1] || 0);
      const hasAds = /"adPlacements"|"playerAds"|"adSlots"/.test(html);
      return { sec, hasAds };
    } catch { await sleep(900); }
  }
  return {};
}

// 직업명 기반 설명·활용아이디어(사이트 톤에 맞춘 템플릿).
function buildDesc(job) {
  if (!job) return '실제 직업인의 하루와 일하는 모습을 생생하게 들여다보는 진로 탐색 영상이에요.';
  return `${job}이(가) 실제로 어떤 일을 하고 어떤 하루를 보내는지 생생하게 보여 주는 진로 탐색 영상이에요.`;
}
function buildIdeas(job) {
  const j = job || '이 직업';
  return [
    `${j}이(가) 하는 일과 필요한 능력을 한 가지씩 적어 보기`,
    `이 직업의 좋은 점과 힘든 점을 짝과 이야기 나누기`,
    `내 흥미·강점과 이 직업이 어울리는지 별점으로 표시하고 이유 말하기`,
  ];
}

const kept = [], dropped = [];
let blockedCount = 0, i = 0, done = 0;

async function worker() {
  while (i < raw.length) {
    const r = raw[i++];
    const emb = await oembed(r.id);
    if (emb.blocked) { blockedCount++; done++; continue; }
    if (!emb.ok) { dropped.push({ ...r, why: emb.reason }); done++; await sleep(120); continue; }
    const m = await meta(r.id);
    if (m.blocked) { blockedCount++; done++; continue; }
    const minutes = Math.round((m.sec || 0) / 60);
    if (!m.sec) { dropped.push({ ...r, why: '길이확인실패' }); done++; await sleep(120); continue; }
    if (minutes < MIN_MIN || minutes > MAX_MIN) { dropped.push({ ...r, why: `길이 ${minutes}분(범위밖)`, sec: m.sec }); done++; await sleep(120); continue; }
    if (m.hasAds) { dropped.push({ ...r, why: '광고있음' }); done++; await sleep(120); continue; }
    kept.push({
      id: `yt-${r.id}`,
      title: emb.title || r.job || '진로 영상',
      youtubeId: r.id,
      topic: '진로',
      grade: ['중학년', '고학년'],
      minutes,
      description: buildDesc(r.job),
      ideas: buildIdeas(r.job),
    });
    done++;
    if (done % 20 === 0) process.stderr.write(`  ...${done}/${raw.length}\n`);
    await sleep(150);
  }
}

const CONC = 4;
await Promise.all(Array.from({ length: CONC }, worker));

console.log(`\n===== 진로 영상 수집 결과 =====`);
console.log(`입력 ${raw.length}편 · 통과 ${kept.length}편 · 제외 ${dropped.length}편 · egress차단 ${blockedCount}편`);
if (blockedCount) {
  console.log(`\n⚠️  ${blockedCount}편이 google(youtube) egress 차단으로 조회 불가.`);
  console.log(`   → YouTube 접근이 허용된 환경에서 다시 실행하세요. (아무것도 추가하지 않음)`);
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
  fs.writeFileSync(path.join(ROOT, '.incoming', 'careers-kept.json'), JSON.stringify(fresh, null, 2));
  console.log(`\n미리보기 모드. --write 로 실제 반영. (통과분 .incoming/careers-kept.json 저장)`);
}
