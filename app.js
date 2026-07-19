/* ===================================================================
   짬짬이 영상 — 런처 로직
   - data/videos.json 로드 → 필터(시간·학년·주제) / 룰렛 / 오늘의 추천 / 저장함
   - 저장함은 localStorage 사용(서버 없음, 정적 사이트)
   =================================================================== */

'use strict';

// ── 상수 ──────────────────────────────────────────────────
const TIME_BUCKETS = [3, 4, 5, 6, 7, 8, 9, 10];   // 분 단위 필터 (선택 분과 정확히 일치)
const GRADES = ['저학년', '중학년', '고학년'];
const STORAGE_KEY = 'jjamvideo:saved';

// 계기교육 달력(월-일 → 주제). 오늘 또는 가장 가까운 다가오는 계기를 자동 선택.
const CALENDAR = [
  { md: '03-01', name: '삼일절',            topic: '역사' },
  { md: '04-05', name: '식목일',            topic: '환경생태' },
  { md: '04-20', name: '장애인의 날',       topic: '장애인식개선' },
  { md: '04-21', name: '과학의 날',         topic: '과학·탐구' },
  { md: '04-22', name: '지구의 날',         topic: '환경생태' },
  { md: '05-05', name: '어린이날',          topic: '인권' },
  { md: '05-08', name: '어버이날',          topic: '가족' },
  { md: '05-15', name: '스승의 날',         topic: '인성' },
  { md: '05-20', name: '세계인의 날',       topic: '다문화' },
  { md: '05-31', name: '바다의 날',         topic: '환경생태' },
  { md: '06-06', name: '현충일',            topic: '생명존중' },
  { md: '06-25', name: '6·25 전쟁일',       topic: '통일' },
  { md: '07-17', name: '제헌절',            topic: '민주시민' },
  { md: '08-15', name: '광복절',            topic: '역사' },
  { md: '10-02', name: '노인의 날',         topic: '인권' },
  { md: '10-03', name: '개천절',            topic: '역사' },
  { md: '10-09', name: '한글날',            topic: '예술·문화' },
  { md: '10-25', name: '독도의 날',         topic: '독도' },
  // jaturi 계기 확장 (음력 명절은 2026년 근사치)
  { md: '02-17', name: '설날',              topic: '가족' },
  { md: '04-19', name: '4·19 혁명 기념일',   topic: '민주시민' },
  { md: '05-24', name: '부처님오신날',       topic: '인성' },
  { md: '07-08', name: '정보보호의 날',      topic: '미디어리터러시' },
  { md: '09-25', name: '추석',              topic: '가족' },
  { md: '10-01', name: '국군의 날',          topic: '역사' },
  { md: '11-09', name: '소방의 날',          topic: '안전' },
  { md: '11-11', name: '농업인의 날',        topic: '경제' },
  { md: '12-25', name: '성탄절',            topic: '힐링·재미' },
];

// 주제 표시 순서(데이터에 없는 주제는 자동으로 뒤에 붙음)
const TOPIC_ORDER = [
  '인성', '진로', '건강·보건', '자기주도학습', '생명존중', '세계시민',
  '가족', '역사', '다문화', '학교폭력예방', '힐링·재미', '경제', '인권',
  '독도', '민주시민', '예술·문화', '스포츠', 'AI교육', '미디어리터러시',
  '장애인식개선', '안전', '과학·탐구', '학급자치', '통일', '환경생태',
];

// ── 상태 ──────────────────────────────────────────────────
let VIDEOS = [];
let TOPICS = [];
const state = {
  time: 'all',
  grade: 'all',
  topic: 'all',
  savedOnly: false,
  occasionOn: false,   // 계기교육 칩 활성 여부
};
let OCCASION = null;        // 오늘 또는 가장 가까운 다가오는 계기 { name, topic, md, diff, m, d }
let activeOcc = null;        // 현재 필터 중인 계기(오늘 계기 또는 달력에서 고른 계기)
let occasionHasTags = false; // 현재 계기 전용 영상(occasions 태그)이 있는지
let saved = loadSaved();

// ── DOM ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const grid        = $('grid');
const emptyMsg    = $('emptyMsg');
const gridTitle   = $('gridTitle');
const resultCount = $('resultCount');
const todayCard   = $('todayCard');
const savedCount  = $('savedCount');

// ── 저장함(localStorage) ──────────────────────────────────
function loadSaved() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
  catch { return new Set(); }
}
function persistSaved() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved]));
  savedCount.textContent = saved.size;
}
function toggleSaved(id) {
  if (saved.has(id)) saved.delete(id); else saved.add(id);
  persistSaved();
}

// ── 유틸 ──────────────────────────────────────────────────
function thumbUrl(v) {
  if (!v.youtubeId || v.youtubeId === 'SAMPLE') return null;
  return `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`;
}
function gradeLabel(v) {
  if (!v.grade || v.grade.length === 3) return '전학년';
  return v.grade.join('·');
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── 필터 칩 렌더링 ────────────────────────────────────────
function makeChip(label, active, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (active ? ' active' : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderChips() {
  // 시간
  const timeWrap = $('timeChips');
  timeWrap.innerHTML = '';
  timeWrap.appendChild(makeChip('전체', state.time === 'all', () => setFilter('time', 'all')));
  TIME_BUCKETS.forEach(m =>
    timeWrap.appendChild(makeChip(`${m}분`, state.time === m, () => setFilter('time', m))));

  // 학년
  const gradeWrap = $('gradeChips');
  gradeWrap.innerHTML = '';
  gradeWrap.appendChild(makeChip('전체', state.grade === 'all', () => setFilter('grade', 'all')));
  GRADES.forEach(g =>
    gradeWrap.appendChild(makeChip(g, state.grade === g, () => setFilter('grade', g))));

  // 주제
  const topicWrap = $('topicChips');
  topicWrap.innerHTML = '';
  topicWrap.appendChild(makeChip('전체', state.topic === 'all', () => setFilter('topic', 'all')));
  TOPICS.forEach(t =>
    topicWrap.appendChild(makeChip(t, state.topic === t, () => setFilter('topic', t))));
}

function setFilter(key, val) {
  state[key] = val;
  state.savedOnly = false;
  state.occasionOn = false; activeOcc = null;   // 일반 필터를 만지면 계기교육 모드 해제
  renderChips();
  renderGrid();
}

// ── 계기교육: 오늘 또는 가장 가까운 다가오는 계기 찾기 ──────
function findOccasion() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best = null, bestDiff = Infinity;
  for (const o of CALENDAR) {
    const [mm, dd] = o.md.split('-').map(Number);
    // 올해·내년 후보를 모두 보고 연말 wrap 처리
    for (const yy of [now.getFullYear(), now.getFullYear() + 1]) {
      const d = new Date(yy, mm - 1, dd);
      const diff = Math.round((d - today) / 86400000);
      if (diff >= 0 && diff < bestDiff) {
        bestDiff = diff;
        best = { ...o, m: mm, d: dd, diff };
      }
    }
  }
  return best;
}

function renderOccasionChip() {
  const chip = $('occasionChip');
  if (!OCCASION) { chip.hidden = true; return; }
  const tag = OCCASION.diff === 0 ? '오늘의 계기' : `D-${OCCASION.diff}`;
  chip.textContent = `📅 ${tag} · ${OCCASION.name}`;
  // 칩은 '오늘의 계기'가 활성일 때만 강조(달력에서 다른 계기를 고르면 해제된 것처럼)
  const isToday = state.occasionOn && activeOcc && activeOcc.name === OCCASION.name;
  chip.classList.toggle('active', isToday);
}

// CALENDAR 항목(md만 있음) → {name,topic,md,m,d,diff} 정규화
function occFromCal(o) {
  const [mm, dd] = o.md.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let diff = Infinity;
  for (const yy of [now.getFullYear(), now.getFullYear() + 1]) {
    const df = Math.round((new Date(yy, mm - 1, dd) - today) / 86400000);
    if (df >= 0 && df < diff) diff = df;
  }
  return { ...o, m: mm, d: dd, diff };
}

// 계기별 영상 수 { n, mode } — 전용(tag) 우선, 없으면 주제(topic) 폴백
function occCount(o) {
  const tag = VIDEOS.filter(v => (v.occasions || []).includes(o.name)).length;
  if (tag > 0) return { n: tag, mode: 'tag' };
  return { n: VIDEOS.filter(v => v.topic === o.topic).length, mode: 'topic' };
}

// 특정 계기를 활성화(오늘 계기 또는 달력 선택)
function activateOccasion(occ) {
  activeOcc = occ;
  state.occasionOn = true;
  occasionHasTags = VIDEOS.some(v => (v.occasions || []).includes(occ.name));
  state.savedOnly = false;
  state.topic = 'all';
  state.time = 'all';
  state.grade = 'all';
  renderChips();
  renderOccasionChip();
  renderGrid();
  document.querySelector('.grid-head').scrollIntoView({ behavior: 'smooth' });
}

function deactivateOccasion() {
  state.occasionOn = false;
  activeOcc = null;
  renderChips();
  renderOccasionChip();
  renderGrid();
}

function toggleOccasion() {
  if (!OCCASION) return;
  const todayActive = state.occasionOn && activeOcc && activeOcc.name === OCCASION.name;
  if (todayActive) deactivateOccasion();
  else activateOccasion(OCCASION);
}

// ── 필터 적용 ─────────────────────────────────────────────
function matches(v) {
  if (state.savedOnly && !saved.has(v.id)) return false;
  // 계기교육 모드: 계기 전용 영상(occasions 태그) 우선, 없으면 주제로 폴백
  if (state.occasionOn && activeOcc) {
    if (occasionHasTags) {
      if (!(v.occasions || []).includes(activeOcc.name)) return false;
    } else if (v.topic !== activeOcc.topic) return false;
  }
  // 시간: 선택한 분과 정확히 일치하는 길이만
  if (state.time !== 'all' && v.minutes !== state.time) return false;
  if (state.grade !== 'all' && !(v.grade || []).includes(state.grade)) return false;
  if (state.topic !== 'all' && v.topic !== state.topic) return false;
  return true;
}

// ── 영상 카드 ─────────────────────────────────────────────
function makeCard(v) {
  const card = document.createElement('article');
  card.className = 'card';

  const url = thumbUrl(v);
  let thumb;
  if (url) {
    thumb = document.createElement('img');
    thumb.className = 'card-thumb';
    thumb.loading = 'lazy';
    thumb.alt = v.title;
    thumb.src = url;
  } else {
    thumb = document.createElement('div');
    thumb.className = 'card-thumb placeholder';
    thumb.textContent = '▶';
  }

  const body = document.createElement('div');
  body.className = 'card-body';
  const star = saved.has(v.id) ? '<span class="card-star">⭐ 저장됨</span>' : '';
  body.innerHTML = `
    ${star}
    <div class="card-title">${escapeHtml(v.title)}</div>
    <div class="card-pills">
      <span class="pill">${escapeHtml(v.topic)}</span>
      <span class="pill pill-time">${v.minutes}분</span>
      <span class="pill pill-grade">${gradeLabel(v)}</span>
    </div>`;

  card.appendChild(thumb);
  card.appendChild(body);
  card.addEventListener('click', () => openModal(v));
  return card;
}

function renderGrid() {
  const list = VIDEOS.filter(matches);
  if (state.occasionOn && activeOcc) {
    const when = activeOcc.diff === 0 ? '오늘' : `${activeOcc.m}/${activeOcc.d}`;
    gridTitle.textContent = occasionHasTags
      ? `📅 ${activeOcc.name} (${when}) 계기교육`
      : `📅 ${activeOcc.name} (${when}) 계기교육 · ${activeOcc.topic} 주제`;
  } else {
    gridTitle.textContent = state.savedOnly ? '⭐ 저장함' : '영상 둘러보기';
  }
  resultCount.textContent = `${list.length}개`;
  grid.innerHTML = '';
  if (list.length === 0) {
    emptyMsg.hidden = false;
    if (state.occasionOn && activeOcc) {
      emptyMsg.textContent = `${activeOcc.name} 계기교육 영상이 아직 없어요.`;
    } else if (state.savedOnly) {
      emptyMsg.textContent = '아직 저장한 영상이 없어요. 마음에 드는 영상을 ⭐ 저장해 보세요.';
    } else {
      emptyMsg.textContent = '조건에 맞는 영상이 없어요. 필터를 바꿔보세요.';
    }
    return;
  }
  emptyMsg.hidden = true;
  list.forEach(v => grid.appendChild(makeCard(v)));
}

// ── 오늘의 추천 ───────────────────────────────────────────
function renderToday(v) {
  const url = thumbUrl(v);
  const thumb = url
    ? `<img class="tc-thumb" src="${url}" alt="" loading="lazy">`
    : `<div class="tc-thumb card-thumb placeholder">▶</div>`;
  todayCard.innerHTML = `
    <div class="tc-inner">
      ${thumb}
      <div class="tc-text">
        <span class="tc-tag">🍿 오늘의 추천 · ${v.minutes}분</span>
        <div class="tc-title">${escapeHtml(v.title)}</div>
        <div class="tc-desc">${escapeHtml(v.description || '')}</div>
      </div>
    </div>`;
  todayCard.onclick = () => openModal(v);
}
function reshuffleToday() {
  if (VIDEOS.length) renderToday(pick(VIDEOS));
}

// ── 룰렛(현재 필터 안에서 랜덤) ───────────────────────────
function roulette() {
  const pool = VIDEOS.filter(matches);
  const list = pool.length ? pool : VIDEOS;
  if (!list.length) return;
  let ticks = 0;
  const timer = setInterval(() => {
    renderToday(pick(list));
    if (++ticks >= 12) {
      clearInterval(timer);
      const chosen = pick(list);
      renderToday(chosen);
      openModal(chosen);
    }
  }, 90);
}

// ── 모달 ──────────────────────────────────────────────────
let modalVideo = null;
function openModal(v) {
  modalVideo = v;
  const player = $('mPlayer');
  if (v.youtubeId && v.youtubeId !== 'SAMPLE') {
    player.innerHTML =
      `<iframe src="https://www.youtube-nocookie.com/embed/${v.youtubeId}?rel=0&autoplay=1"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen title="${escapeHtml(v.title)}"></iframe>`;
  } else {
    player.innerHTML = `<div class="ph">예시 영상입니다.<br>data/videos.json의 youtubeId를<br>실제 유튜브 영상 ID로 교체하세요.</div>`;
  }
  $('mTopic').textContent = v.topic;
  $('mTime').textContent  = `${v.minutes}분`;
  $('mGrade').textContent = gradeLabel(v);
  $('mTitle').textContent = v.title;
  $('mDesc').textContent  = v.description || '';

  const ideas = $('mIdeas');
  ideas.innerHTML = '';
  (v.ideas || []).forEach((t, i) => {
    const li = document.createElement('li');
    li.dataset.n = i + 1;
    li.textContent = t;
    ideas.appendChild(li);
  });

  updateSaveBtn();
  $('modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('modal').hidden = true;
  $('mPlayer').innerHTML = '';   // iframe 제거 → 재생 정지
  document.body.style.overflow = '';
  modalVideo = null;
}
function updateSaveBtn() {
  const b = $('mSaveBtn');
  const on = modalVideo && saved.has(modalVideo.id);
  b.textContent = on ? '⭐ 저장됨' : '⭐ 저장';
  b.classList.toggle('ghost', !on);
}

// ── 공유 ──────────────────────────────────────────────────
async function shareVideo() {
  if (!modalVideo) return;
  const text = `[짬짬이 영상] ${modalVideo.title}`;
  const url = modalVideo.youtubeId && modalVideo.youtubeId !== 'SAMPLE'
    ? `https://youtu.be/${modalVideo.youtubeId}` : location.href;
  try {
    if (navigator.share) await navigator.share({ title: text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); alert('링크를 복사했어요!'); }
  } catch { /* 사용자가 취소 */ }
}

// ── HTML 이스케이프 ───────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 이벤트 바인딩 ─────────────────────────────────────────
function bindEvents() {
  $('rouletteBtn').addEventListener('click', roulette);
  $('reshuffleBtn').addEventListener('click', reshuffleToday);
  $('occasionChip').addEventListener('click', toggleOccasion);

  $('savedBtn').addEventListener('click', () => {
    state.savedOnly = !state.savedOnly;
    state.occasionOn = false; activeOcc = null;
    if (state.savedOnly) { state.time = 'all'; state.grade = 'all'; state.topic = 'all'; renderChips(); renderOccasionChip(); }
    renderGrid();
    document.querySelector('.grid-head').scrollIntoView({ behavior: 'smooth' });
  });

  // ── 계기교육 달력 ──
  $('calBtn').addEventListener('click', openCal);
  document.querySelectorAll('[data-cal-close]').forEach(el => el.addEventListener('click', closeCal));
  $('calDate').addEventListener('change', e => {
    if (!e.target.value) return;
    const [, mm, dd] = e.target.value.split('-').map(Number);
    closeCal();
    activateOccasion(findOccasionForDate(mm, dd));
  });

  $('fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });

  $('mSaveBtn').addEventListener('click', () => {
    if (!modalVideo) return;
    toggleSaved(modalVideo.id);
    updateSaveBtn();
    renderGrid();
  });
  $('mShareBtn').addEventListener('click', shareVideo);

  document.querySelectorAll('[data-close]').forEach(el =>
    el.addEventListener('click', closeModal));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeCal(); } });
}

// ── 계기교육 달력 모달 ────────────────────────────────────
// 날짜(월/일)에서 그 날 또는 가장 가까운 다가오는 계기를 찾음
function findOccasionForDate(mm, dd) {
  const doy = (m, d) => Math.round((new Date(2025, m - 1, d) - new Date(2025, 0, 0)) / 86400000);
  const target = doy(mm, dd);
  let best = null, bestDelta = Infinity;
  for (const o of CALENDAR) {
    const [om, od] = o.md.split('-').map(Number);
    const delta = (doy(om, od) - target + 366) % 366;   // 그 날 이후 가장 가까운 계기(연말 wrap)
    if (delta < bestDelta) { bestDelta = delta; best = o; }
  }
  return occFromCal(best);
}

function buildCalList() {
  const list = $('calList');
  list.innerHTML = '';
  const byMonth = {};
  CALENDAR.forEach(o => {
    const m = Number(o.md.split('-')[0]);
    (byMonth[m] = byMonth[m] || []).push(o);
  });
  Object.keys(byMonth).map(Number).sort((a, b) => a - b).forEach(m => {
    const h = document.createElement('div');
    h.className = 'cal-month';
    h.textContent = `${m}월`;
    list.appendChild(h);
    const days = document.createElement('div');
    days.className = 'cal-days';
    byMonth[m].sort((a, b) => a.md.localeCompare(b.md)).forEach(o => {
      const { n, mode } = occCount(o);
      const dd = Number(o.md.split('-')[1]);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-item';
      b.innerHTML =
        `<span class="cal-date">${m}/${dd}</span>` +
        `<span class="cal-name">${escapeHtml(o.name)}</span>` +
        `<span class="cal-cnt">${n}개${mode === 'topic' ? ' <em>주제</em>' : ''}</span>`;
      b.addEventListener('click', () => { closeCal(); activateOccasion(occFromCal(o)); });
      days.appendChild(b);
    });
    list.appendChild(days);
  });
}

function openCal() {
  buildCalList();
  $('calModal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeCal() {
  const m = $('calModal');
  if (m) { m.hidden = true; if ($('modal').hidden) document.body.style.overflow = ''; }
}

// ── 주제 목록 만들기 ──────────────────────────────────────
// jaturi.me처럼 정의된 전체 카테고리를 항상 노출한다(브라우즈용).
// 데이터에만 있는 신규 주제는 뒤에 자동으로 덧붙인다.
function buildTopics() {
  const present = new Set(VIDEOS.map(v => v.topic));
  const extra = [...present].filter(t => !TOPIC_ORDER.includes(t)).sort();
  TOPICS = [...TOPIC_ORDER, ...extra];
}

// ── 초기화 ────────────────────────────────────────────────
async function init() {
  bindEvents();
  persistSaved();
  try {
    const res = await fetch('data/videos.json', { cache: 'no-cache' });
    VIDEOS = await res.json();
  } catch (e) {
    grid.innerHTML = '';
    emptyMsg.hidden = false;
    emptyMsg.textContent = 'videos.json을 불러오지 못했어요. 로컬 서버(python -m http.server)로 열어주세요.';
    return;
  }
  buildTopics();
  OCCASION = findOccasion();
  renderChips();
  renderOccasionChip();
  renderGrid();
  reshuffleToday();
}

init();
