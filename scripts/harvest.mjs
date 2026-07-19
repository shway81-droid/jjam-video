#!/usr/bin/env node
/**
 * 유튜브 검색 후보 수집 + 임베드 검증 도구 (서브에이전트 공용)
 *
 *   node scripts/harvest.mjs search "검색어"
 *     → 검색 결과 후보를 JSON으로 출력: [{id,title,sec,len,ch,views}]
 *       sec=길이(초). 5~10분 필터는 300<=sec<=630 권장.
 *
 *   node scripts/harvest.mjs verify <id> [<id> ...]
 *     → 각 영상 임베드 가능 여부: [{id,ok,title,author}]
 *       ok:true 인 것만 사이트에 넣을 수 있음(비공개·삭제·임베드차단 자동 제외).
 */

const mode = process.argv[2];

// ── 검색: ytInitialData에서 videoRenderer 추출 ────────────
function collectVideoRenderers(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) collectVideoRenderers(x, out); return; }
  if (node.videoRenderer) out.push(node.videoRenderer);
  for (const k of Object.keys(node)) collectVideoRenderers(node[k], out);
}

function lenToSec(s) {
  if (!s) return null;
  const p = s.split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
}

async function search(query) {
  const r = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query),
    { headers: { 'Accept-Language': 'ko-KR' } });
  const html = await r.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) { console.log('[]'); return; }
  const data = JSON.parse(m[1]);
  const rends = [];
  collectVideoRenderers(data, rends);
  const seen = new Set();
  const items = [];
  for (const v of rends) {
    if (!v.videoId || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    const len = v.lengthText?.simpleText || null;   // 없으면 라이브/쇼츠 → 제외 대상
    items.push({
      id: v.videoId,
      title: v.title?.runs?.[0]?.text || '',
      sec: lenToSec(len),
      len,
      ch: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
      views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
    });
  }
  console.log(JSON.stringify(items, null, 1));
}

// ── 검증: oEmbed로 임베드 가능 여부 + 제목 ────────────────
async function verify(ids) {
  const out = [];
  for (const id of ids) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (r.ok) { const j = await r.json(); out.push({ id, ok: true, title: j.title, author: j.author_name }); }
      else out.push({ id, ok: false, status: r.status });
    } catch (e) { out.push({ id, ok: false, error: e.message }); }
  }
  console.log(JSON.stringify(out, null, 1));
}

if (mode === 'search') search(process.argv[3] || '');
else if (mode === 'verify') verify(process.argv.slice(3));
else { console.error('usage: harvest.mjs search "<query>" | verify <id>...'); process.exit(1); }
