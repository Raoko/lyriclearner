/* LyricLearner — play a real song, pause before each line, guess the lyric. */
'use strict';

const $ = (sel) => document.querySelector(sel);
const LS_KEY = 'lyriclearner.songs.v1';
const LRCLIB = 'https://lrclib.net/api';   // allows CORS, so this works on static hosting too

const STARTER_PACK = [
  { trackName: 'Tití Me Preguntó', artistName: 'Bad Bunny', lrclibId: 17906524, videoId: 'Cr8K88UcO0s' },
  { trackName: 'Me Porto Bonito', artistName: 'Bad Bunny ft. Chencho Corleone', lrclibId: 20453735, videoId: 'saGYMhApaH8' },
  { trackName: 'Dákiti', artistName: 'Bad Bunny & Jhay Cortez', lrclibId: 576, videoId: 'TmKh7lAwnBI' },
  { trackName: 'Callaíta', artistName: 'Bad Bunny', lrclibId: 1004116, videoId: 'acEOASYioGY' },
  { trackName: 'Ojitos Lindos', artistName: 'Bad Bunny ft. Bomba Estéreo', lrclibId: 22269344, videoId: 'wAjHQXrIj9o' },
  { trackName: 'Efecto', artistName: 'Bad Bunny', lrclibId: 584, videoId: 'Nk8C9FdCdJQ' },
  { trackName: 'Moscow Mule', artistName: 'Bad Bunny', lrclibId: 20667007, videoId: 'p38WgakuYDo' },
  { trackName: 'La Canción', artistName: 'J Balvin & Bad Bunny', lrclibId: 6678008, videoId: 'LxOTsiV4tkQ' },
  { trackName: 'Yonaguni', artistName: 'Bad Bunny', lrclibId: 1596, videoId: 'doLMt10ytHY' },
  { trackName: 'MÍA', artistName: 'Bad Bunny ft. Drake', lrclibId: 7448627, videoId: 'OSUxrSe5GbI' },
];

/* ============================== state ============================== */

let currentSong = null;   // { key, trackName, artistName, syncedLyrics, videoId, offset, mode, freq }
let game = null;          // active game state
let player = null;        // YT.Player
let ytReadyPromise = null;

/* ============================== screens ============================ */

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('#screen-' + name).classList.add('active');
  if (name === 'home') {
    stopGame();
    renderLibrary();
  }
}

document.querySelectorAll('.back-btn').forEach(btn =>
  btn.addEventListener('click', () => showScreen(btn.dataset.goto))
);

/* ============================== library ============================= */

function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { return []; }
}

function saveToLibrary(song) {
  const lib = loadLibrary().filter(s => s.key !== song.key);
  lib.unshift(song);
  localStorage.setItem(LS_KEY, JSON.stringify(lib.slice(0, 50)));
}

function removeFromLibrary(key) {
  localStorage.setItem(LS_KEY, JSON.stringify(loadLibrary().filter(s => s.key !== key)));
  renderLibrary();
}

function renderLibrary() {
  const lib = loadLibrary();
  $('#library-section').classList.toggle('hidden', lib.length === 0);
  const list = $('#library-list');
  list.innerHTML = '';
  for (const song of lib) {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `
      <span class="art">🎵</span>
      <span class="info"><b></b><span></span></span>
      <span class="dur">${song.bestScore ? '★ ' + song.bestScore + '%' : ''}</span>
      <button class="del" title="Remove">✕</button>`;
    div.querySelector('.info b').textContent = song.trackName;
    div.querySelector('.info span').textContent = song.artistName;
    div.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromLibrary(song.key);
    });
    div.addEventListener('click', () => openSetup(song));
    list.appendChild(div);
  }
}

/* ============================== search ============================== */

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (!q) return;
  const status = $('#search-status');
  const list = $('#search-results');
  list.innerHTML = '';
  status.textContent = 'Searching…';
  status.classList.remove('error');
  try {
    const res = await fetch(LRCLIB + '/search?q=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const results = (await res.json()).filter(r => r.syncedLyrics);
    if (results.length === 0) {
      status.textContent = 'No synced lyrics found for that search. Try adding the artist name.';
      return;
    }
    status.textContent = `${results.length} result${results.length > 1 ? 's' : ''} with synced lyrics:`;
    for (const r of results.slice(0, 15)) {
      const div = document.createElement('div');
      div.className = 'result-item';
      const mins = Math.floor(r.duration / 60), secs = String(Math.round(r.duration % 60)).padStart(2, '0');
      div.innerHTML = `
        <span class="art">🎶</span>
        <span class="info"><b></b><span></span></span>
        <span class="dur">${mins}:${secs}</span>`;
      div.querySelector('.info b').textContent = r.trackName;
      div.querySelector('.info span').textContent = r.artistName + (r.albumName ? ' · ' + r.albumName : '');
      div.addEventListener('click', () => openSetup({
        key: 'lrclib-' + r.id,
        trackName: r.trackName,
        artistName: r.artistName,
        syncedLyrics: r.syncedLyrics,
        videoId: '',
        offset: 0,
      }));
      list.appendChild(div);
    }
  } catch (err) {
    status.textContent = 'Search failed: ' + err.message;
    status.classList.add('error');
  }
});

/* ============================== starter pack ======================== */

function renderStarterPack() {
  const list = $('#starter-list');
  list.innerHTML = '';
  for (const s of STARTER_PACK) {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `<span class="art">🐰</span><span class="info"><b></b><span></span></span><span class="dur">▶</span>`;
    div.querySelector('.info b').textContent = s.trackName;
    div.querySelector('.info span').textContent = s.artistName;
    div.addEventListener('click', async () => {
      const dur = div.querySelector('.dur');
      dur.textContent = '…';
      try {
        // reuse saved copy (with its sync offset) if they've played it before
        const saved = loadLibrary().find(x => x.key === 'starter-' + s.lrclibId);
        if (saved) return openSetup(saved);
        const res = await fetch(`${LRCLIB}/get/${s.lrclibId}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        openSetup({
          key: 'starter-' + s.lrclibId,
          trackName: s.trackName,
          artistName: s.artistName,
          syncedLyrics: data.syncedLyrics,
          videoId: s.videoId,
          offset: 0,
        });
      } catch (err) {
        dur.textContent = '⚠';
        $('#search-status').textContent = 'Could not load lyrics: ' + err.message;
        $('#search-status').classList.add('error');
      }
    });
    list.appendChild(div);
  }
}

/* ============================== setup =============================== */

// one global practice mode picked on the home screen: drive or builder
let globalMode = localStorage.getItem('lyriclearner.mode') || 'drive';
if (!['drive', 'builder'].includes(globalMode)) globalMode = 'drive';

function renderModeSwitch() {
  document.querySelectorAll('#mode-switch .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.gmode === globalMode));
}
document.querySelectorAll('#mode-switch .seg-btn').forEach(b =>
  b.addEventListener('click', () => {
    globalMode = b.dataset.gmode;
    localStorage.setItem('lyriclearner.mode', globalMode);
    renderModeSwitch();
  }));

function openSetup(song) {
  currentSong = { freq: 1, ...song };
  currentSong.mode = globalMode;
  currentSong.freq = 1;
  if (!currentSong.builderSpan) currentSong.builderSpan = 'lines';

  // video already known (starter pack / library) — skip setup, straight into the game
  if (currentSong.videoId) {
    saveToLibrary(currentSong);
    startGame();
    return;
  }

  $('#setup-title').textContent = song.trackName;
  $('#setup-artist').textContent = song.artistName;
  $('#yt-url').value = song.videoId ? 'https://www.youtube.com/watch?v=' + song.videoId : '';
  $('#yt-search-link').href = 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(song.artistName + ' ' + song.trackName + ' lyrics');
  $('#setup-status').textContent = '';
  setSeg('#mode-seg', 'mode', currentSong.mode);
  setSeg('#freq-seg', 'freq', String(currentSong.freq));
  validateSetup();
  showScreen('setup');
}

function setSeg(segSel, dataKey, value) {
  document.querySelectorAll(segSel + ' .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset[dataKey] === value));
}

document.querySelectorAll('#mode-seg .seg-btn').forEach(b =>
  b.addEventListener('click', () => { currentSong.mode = b.dataset.mode; setSeg('#mode-seg', 'mode', b.dataset.mode); }));
document.querySelectorAll('#freq-seg .seg-btn').forEach(b =>
  b.addEventListener('click', () => { currentSong.freq = Number(b.dataset.freq); setSeg('#freq-seg', 'freq', b.dataset.freq); }));

function parseVideoId(url) {
  const m = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

$('#yt-url').addEventListener('input', validateSetup);
function validateSetup() {
  $('#start-btn').disabled = !parseVideoId($('#yt-url').value);
}

$('#start-btn').addEventListener('click', () => {
  const videoId = parseVideoId($('#yt-url').value);
  if (!videoId) return;
  currentSong.videoId = videoId;
  saveToLibrary(currentSong);
  startGame();
});

/* ============================== LRC parsing ========================= */

function parseLRC(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!times.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!content) continue;
    for (const t of times) {
      lines.push({ t: Number(t[1]) * 60 + Number(t[2]), text: content });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

/* ============================== text compare ======================== */

function normWord(w) {
  return w.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9']/g, '');
}

function words(line) {
  return line.split(/\s+/).map(w => ({ raw: w, norm: normWord(w) })).filter(w => w.norm);
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// kept for the planned voice-recognition mode: fuzzy word matching against sung/spoken input
function wordMatches(guess, target) {
  if (!guess) return false;
  if (guess === target) return true;
  return target.length >= 5 && levenshtein(guess, target) <= 1;  // forgive one typo on longer words
}

/* ============================== YouTube ============================= */

function ensureYouTubeAPI() {
  if (ytReadyPromise) return ytReadyPromise;
  ytReadyPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytReadyPromise;
}

/* ============================== game ================================ */

const LEAD = 0.2;          // pause this many seconds before the quizzed line starts
const TICK_MS = 80;

async function startGame() {
  const lines = parseLRC(currentSong.syncedLyrics);
  if (lines.length < 4) {
    $('#setup-status').textContent = 'These lyrics have too few synced lines to play.';
    $('#setup-status').classList.add('error');
    return;
  }

  game = {
    lines,
    idx: 0,                    // next line index to reach
    quizIdx: null,             // line currently being quizzed
    state: 'loading',          // loading | playing | quiz | feedback | drivereplay | done
    revealIdx: null,           // line shown revealed during a drive-mode replay
    loopSel: null,             // first line tapped while picking a loop section
    loopStart: null,           // active A-B loop range (line indices)
    loopEnd: null,
    loopRepeat: false,         // true = just replay the section (no quizzing, 1s pause between passes)
    score: 0,
    streak: 0,
    bestStreak: 0,
    total: 0,
    ticker: null,
  };

  // quiz every Nth line, starting with the very first
  game.lines.forEach((ln, i) => {
    ln.quiz = i % currentSong.freq === 0;
    ln.result = null;
    ln.frac = 0;
    ln.attempts = 0;
    ln.hints = 0;
  });
  game.total = game.lines.filter(l => l.quiz).length;

  if (currentSong.mode === 'builder') {
    // builder quizzes words cumulatively, not lines
    game.lines.forEach(ln => { ln.quiz = false; });
    game.builderWords = [];                 // every word in reading order: { lineIdx }
    game.builderLineInfo = game.lines.map((ln, i) => {
      const ws = words(ln.text);
      const info = { first: game.builderWords.length, count: ws.length };
      ws.forEach(() => game.builderWords.push({ lineIdx: i }));
      return info;
    });
    game.builderCount = Math.min(currentSong.builderCount || 0, game.builderWords.length);
    game.builderLine = -1;                  // line of the word being quizzed / replayed
    game.builderGot = false;
    game.builderSkip = false;
    game.builderReveal = false;             // true = show the target word during the replay
    game.total = game.builderWords.length;
  }

  showScreen('game');
  renderLyrics();
  updateStats();
  updateLoopBar();
  $('#quiz-area').classList.add('hidden');
  $('#feedback-area').classList.add('hidden');
  $('#start-overlay').classList.add('hidden');
  $('#sync-value').textContent = (currentSong.offset >= 0 ? '+' : '') + currentSong.offset.toFixed(2) + 's';

  await ensureYouTubeAPI();
  if (player) { player.destroy(); player = null; }
  player = new YT.Player('yt-player', {
    videoId: currentSong.videoId,
    playerVars: { playsinline: 1, rel: 0, controls: 1 },
    events: {
      // iOS blocks autoplay with sound — playback must start from a real tap
      onReady: () => { $('#start-overlay').classList.remove('hidden'); },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED && game && game.state !== 'done') {
          if (currentSong.mode === 'builder') {
            if (game.state === 'linerepeat') {
              player.seekTo(Math.max(0, lineTime(game.builderLine) - 0.6), true);
              player.playVideo();
            }
            else if (game.state === 'builderplay') builderLineEnded();
            else if (builderTarget()) restartBuilderPass();
            else builderComplete();
          } else if (game.loopStart !== null) { wrapLoop(); player.playVideo(); }
          else finishGame();
        }
      },
    },
  });

  game.ticker = setInterval(tick, TICK_MS);
}

// brief non-blocking "get ready" flash over the video at song start
function showGraceNote() {
  const g = $('#grace-note');
  g.classList.remove('hidden');
  g.style.opacity = '1';
  setTimeout(() => { g.style.opacity = '0'; }, 1500);
  setTimeout(() => { g.classList.add('hidden'); }, 2200);
}

$('#start-overlay').addEventListener('click', () => {
  if (!game || !player) return;
  $('#start-overlay').classList.add('hidden');
  showGraceNote();
  if (currentSong.mode === 'builder') {
    if (builderTarget()) restartBuilderPass();
    else builderComplete();               // song already fully built
    return;
  }
  game.state = 'playing';
  player.playVideo();
});

function stopGame() {
  setLyricsFull(false);
  if (game && game.ticker) clearInterval(game.ticker);
  if (player) { try { player.destroy(); } catch {} player = null; }
  game = null;
}

function lineTime(i) {
  return game.lines[i].t + currentSong.offset;
}

function tick() {
  if (!game || !player || typeof player.getCurrentTime !== 'function') return;
  const t = player.getCurrentTime();
  if (typeof t !== 'number') return;

  // builder "Loop it": seamlessly cycle the target line, no pauses
  if (game.state === 'linerepeat') {
    const end = game.builderLine + 1 < game.lines.length
      ? lineTime(game.builderLine + 1) - LEAD
      : lineTime(game.builderLine) + 6;
    if (t >= end) player.seekTo(Math.max(0, lineTime(game.builderLine) - 0.6), true);
    return;
  }

  // builder mode: the target line is playing after an answer; when it ends, advance/restart
  if (game.state === 'builderplay') {
    const end = game.builderLine + 1 < game.lines.length
      ? lineTime(game.builderLine + 1) - LEAD
      : lineTime(game.builderLine) + 6;
    if (t >= end) builderLineEnded();
    return;
  }

  // drive mode: replaying the missed line with the text shown; when it ends, ask again
  if (game.state === 'drivereplay') {
    const end = game.quizIdx + 1 < game.lines.length
      ? lineTime(game.quizIdx + 1) - LEAD
      : lineTime(game.quizIdx) + 6;
    if (t >= end) {
      player.pauseVideo();
      player.seekTo(Math.max(0, lineTime(game.quizIdx) - LEAD), true);
      game.revealIdx = null;
      enterQuiz(game.quizIdx);
    }
    return;
  }

  if (game.state !== 'playing') return;

  // builder mode: pause right before the line holding the word being learned
  if (currentSong.mode === 'builder') {
    const target = builderTarget();
    if (target && t >= lineTime(target.lineIdx) - LEAD) {
      player.pauseVideo();
      enterBuilderQuiz(target);
      return;
    }
  }

  // active loop: jump back to the section start once its last line has played
  if (game.loopStart !== null) {
    const wrapAt = game.loopEnd + 1 < game.lines.length
      ? lineTime(game.loopEnd + 1) - LEAD
      : lineTime(game.loopEnd) + 6;
    if (t >= wrapAt) return wrapLoop();
  }

  // advance past lines whose moment has passed
  const repeatLoop = game.loopRepeat && game.loopStart !== null;
  while (game.idx < game.lines.length && t >= lineTime(game.idx) - LEAD) {
    const line = game.lines[game.idx];
    if (line.quiz && line.result === null && !repeatLoop) {
      player.pauseVideo();
      enterQuiz(game.idx);
      return;
    }
    game.idx++;
    renderLyrics();
  }
  if (game.idx >= game.lines.length && game.loopStart === null) finishGame();
}

/* ---------- A-B section loop ---------- */

function wrapLoop() {
  // re-arm the quizzes inside the loop and replay the section
  for (let i = game.loopStart; i <= game.loopEnd; i++) {
    game.lines[i].result = null;
    game.lines[i].attempts = 0;
    game.lines[i].hints = 0;
  }
  game.idx = game.loopStart;
  game.quizIdx = null;
  game.revealIdx = null;
  renderLyrics();
  if (game.loopRepeat) {
    // repeat mode: a one-second breather between passes
    player.pauseVideo();
    game.state = 'looppause';
    setTimeout(() => {
      if (!game || game.state !== 'looppause') return;
      player.seekTo(Math.max(0, lineTime(game.loopStart) - 2), true);
      game.state = 'playing';
      player.playVideo();
    }, 1000);
  } else {
    player.seekTo(Math.max(0, lineTime(game.loopStart) - 2), true);
  }
}

function onLineTap(i) {
  if (!game || game.state === 'done') return;
  if (currentSong.mode === 'builder') return;       // no section loops in builder mode
  if (game.loopStart !== null) return;              // loop active — use ✕ Clear loop
  if (game.loopSel === null) {
    game.loopSel = i;                               // first tap: arm the section start
    updateLoopBar();
    renderLyrics();
  } else {
    const a = Math.min(game.loopSel, i), b = Math.max(game.loopSel, i);
    game.loopSel = null;
    startLoop(a, b);
  }
}

function startLoop(a, b) {
  game.loopStart = a;
  game.loopEnd = b;
  // cancel any in-flight quiz and jump straight into the section
  game.state = 'playing';
  $('#quiz-area').classList.add('hidden');
  $('#feedback-area').classList.add('hidden');
  updateLoopBar();
  wrapLoop();
  player.playVideo();
}

$('#loop-clear').addEventListener('click', () => {
  if (!game) return;
  game.loopSel = null;
  game.loopStart = null;
  game.loopEnd = null;
  if (game.state === 'looppause') { game.state = 'playing'; player.playVideo(); }
  updateLoopBar();
  renderLyrics();
});

$('#loop-mode-btn').addEventListener('click', () => {
  if (!game || game.loopStart === null) return;
  game.loopRepeat = !game.loopRepeat;
  if (game.loopRepeat && game.state === 'quiz') {
    // a quiz is open inside the loop — dismiss it and keep the music rolling
    $('#quiz-area').classList.add('hidden');
    game.quizIdx = null;
    game.state = 'playing';
    player.playVideo();
  }
  updateLoopBar();
  renderLyrics();
});

function updateLoopBar() {
  const hint = $('#loop-hint'), clear = $('#loop-clear'), modeBtn = $('#loop-mode-btn');
  if (currentSong.mode === 'builder') {
    hint.textContent = '🧠 Building the song one word at a time — learned words stay hidden';
    clear.classList.add('hidden');
    modeBtn.classList.add('hidden');
    return;
  }
  modeBtn.classList.toggle('hidden', game.loopStart === null);
  modeBtn.textContent = game.loopRepeat ? '🔂 Repeat mode' : '🎓 Quiz mode';
  if (game.loopStart !== null) {
    hint.textContent = `🔁 Looping lines ${game.loopStart + 1}–${game.loopEnd + 1}`;
    clear.textContent = '✕ Clear loop';
    clear.classList.remove('hidden');
  } else if (game.loopSel !== null) {
    hint.textContent = '🔁 Now tap the last line of the section';
    clear.textContent = '✕ Cancel';
    clear.classList.remove('hidden');
  } else {
    hint.textContent = '🔁 Tap a lyric line to loop a section';
    clear.classList.add('hidden');
  }
}

/* ---------- builder (learn one word at a time) ---------- */

function builderTarget() {
  return game.builderCount < game.builderWords.length ? game.builderWords[game.builderCount] : null;
}

// how many leading words of line i are hidden right now
function builderHiddenInLine(i) {
  const info = game.builderLineInfo[i];
  if (!info) return 0;
  // learned words stay hidden; the target word is hidden too unless "Show me" revealed it
  const eff = (game.builderReveal && game.builderLine === i) ? game.builderCount : game.builderCount + 1;
  return Math.max(0, Math.min(eff - info.first, info.count));
}

function builderLineHtml(i) {
  const hid = builderHiddenInLine(i);
  return words(game.lines[i].text).map((w, j) =>
    j < hid ? `<span class="w-blank">${escapeHtml(w.raw)}</span>` : escapeHtml(w.raw)
  ).join(' ');
}

function enterBuilderQuiz(target) {
  game.state = 'quiz';
  game.builderLine = target.lineIdx;
  game.builderReveal = false;

  $('#quiz-area').classList.remove('hidden');
  $('#feedback-area').classList.add('hidden');
  $('#choice-buttons').classList.add('hidden');
  $('#hint-words').classList.add('hidden');
  $('#hint-btn').classList.add('hidden');
  $('#replay-btn').classList.add('hidden');
  $('#drive-buttons').classList.remove('hidden');
  $('#drive-miss').classList.remove('hidden');
  $('#drive-miss').textContent = '🔁 Loop it';
  $('#drive-got').textContent = 'Next →';
  $('#skip-btn').classList.remove('hidden');
  $('#span-btn').classList.remove('hidden');
  updateSpanBtn();

  const ws = words(game.lines[target.lineIdx].text);
  const hid = builderHiddenInLine(target.lineIdx);
  $('#quiz-prompt').innerHTML =
    `🧠 Word ${game.builderCount + 1} of ${game.builderWords.length} — pull the next word from memory: ` +
    promptWithBlanks(ws, [...Array(hid).keys()]);
  renderLyrics();
}

function builderAnswer(got, skipped = false) {
  if (!game || game.state !== 'quiz') return;
  game.builderGot = got;
  game.builderSkip = skipped;
  game.builderReveal = false;
  game.state = 'builderplay';
  $('#quiz-area').classList.add('hidden');
  renderLyrics();
  player.playVideo();
}

// "Loop it": replay just the target line continuously, word revealed, no pauses —
// practice singing along, then tap Ready to be tested on it again
function builderStartLineLoop() {
  if (!game || game.state !== 'quiz') return;
  game.builderReveal = true;
  game.state = 'linerepeat';
  $('#quiz-prompt').textContent = '🔁 Looping this line — sing along until it sticks:';
  $('#drive-miss').classList.add('hidden');
  $('#drive-got').textContent = '✓ Ready — test me';
  $('#skip-btn').classList.add('hidden');
  $('#span-btn').classList.add('hidden');
  renderLyrics();
  player.seekTo(Math.max(0, lineTime(game.builderLine) - 0.6), true);
  player.playVideo();
}

function builderLineEnded() {
  player.pauseVideo();
  if (game.builderGot) {
    game.builderCount++;
    if (!game.builderSkip) game.score += 5;
    currentSong.builderCount = game.builderCount;
    saveToLibrary(currentSong);
    updateStats();
    if (!builderTarget()) return builderComplete();
  }
  restartBuilderPass();
}

function restartBuilderPass() {
  const target = builderTarget();
  // always at least one line of run-up before the target so it flows
  const startLine = currentSong.builderSpan === 'song' ? 0 : Math.max(0, target.lineIdx - 1);
  game.builderLine = -1;
  game.builderReveal = false;
  game.idx = startLine;
  game.state = 'playing';
  renderLyrics();
  // if the target IS the first line, give a few seconds of intro as the run-up instead
  const pre = startLine === target.lineIdx ? 3 : 1;
  player.seekTo(Math.max(0, lineTime(startLine) - pre), true);
  player.playVideo();
}

function builderComplete() {
  game.state = 'done';
  clearInterval(game.ticker);
  try { player.pauseVideo(); } catch {}
  $('#res-accuracy').textContent = '100%';
  $('#res-score').textContent = game.score;
  $('#res-streak').textContent = game.builderWords.length;
  $('#results-emoji').textContent = '🧠';
  $('#results-title').textContent = 'Every word memorized!';
  currentSong.bestScore = 100;
  currentSong.builderCount = 0;            // fresh start next run
  saveToLibrary(currentSong);
  showScreen('results');
}

$('#span-btn').addEventListener('click', () => {
  currentSong.builderSpan = currentSong.builderSpan === 'song' ? 'lines' : 'song';
  saveToLibrary(currentSong);
  updateSpanBtn();
});

function updateSpanBtn() {
  $('#span-btn').textContent = currentSong.builderSpan === 'song'
    ? '↩ Restart: whole song' : '↩ Restart: 1 line back';
}

/* ---------- quiz ---------- */

function enterQuiz(i) {
  game.state = 'quiz';
  game.quizIdx = i;
  const line = game.lines[i];
  const mode = currentSong.mode;

  $('#quiz-area').classList.remove('hidden');
  $('#feedback-area').classList.add('hidden');
  $('#choice-buttons').classList.add('hidden');
  $('#drive-buttons').classList.add('hidden');
  $('#replay-btn').classList.remove('hidden');
  $('#hint-btn').classList.remove('hidden');
  $('#span-btn').classList.add('hidden');
  $('#drive-miss').classList.remove('hidden');
  $('#drive-miss').textContent = '↻ Missed it';
  $('#drive-got').textContent = '✓ Got it';
  renderHintWords(line);
  renderLyrics();

  const ws = words(line.text);

  if (mode === 'drive') {
    line.attempts = line.attempts || 0;
    $('#quiz-prompt').textContent = line.attempts
      ? 'One more time — say the line, then check yourself:'
      : 'Say the next line out loud, then check yourself:';
    $('#drive-buttons').classList.remove('hidden');
    $('#replay-btn').classList.add('hidden');   // "Missed it" already replays the line
  } else {
    // blank one meaningful word, offer 4 choices
    const candidates = ws.map((w, j) => ({ w, j })).filter(x => x.w.norm.length >= 3);
    const pick = candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : { w: ws[ws.length - 1], j: ws.length - 1 };
    line.blankIdx = [pick.j];
    $('#quiz-prompt').innerHTML = 'Next line: ' + promptWithBlanks(ws, line.blankIdx);

    const pool = new Set();
    const allWords = game.lines.flatMap(l => words(l.text)).filter(w => w.norm.length >= 3 && w.norm !== pick.w.norm);
    while (pool.size < 3 && pool.size < allWords.length) {
      pool.add(allWords[Math.floor(Math.random() * allWords.length)].raw.replace(/[^\p{L}\p{N}']/gu, ''));
    }
    const options = shuffle([pick.w.raw.replace(/[^\p{L}\p{N}']/gu, ''), ...pool]);
    const grid = $('#choice-buttons');
    grid.innerHTML = '';
    grid.classList.remove('hidden');
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        const right = normWord(opt) === pick.w.norm;
        btn.classList.add(right ? 'right' : 'wrong');
        grid.querySelectorAll('button').forEach(b => b.disabled = true);
        setTimeout(() => resolveQuiz(right ? 1 : 0, line.text), right ? 350 : 900);
      });
      grid.appendChild(btn);
    }
  }
}

function promptWithBlanks(ws, blankIdx) {
  return '<span class="blanked">' + ws.map((w, j) =>
    blankIdx.includes(j) ? '____' : escapeHtml(w.raw)).join(' ') + '</span>';
}

function renderHintWords(line) {
  const el = $('#hint-words');
  if (!line.hints) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  const ws = words(line.text);
  el.classList.remove('hidden');
  el.textContent = '💡 ' + ws.slice(0, line.hints).map(w => w.raw).join(' ') + (line.hints < ws.length ? ' …' : '');
}

$('#hint-btn').addEventListener('click', () => {
  if (!game || game.state !== 'quiz') return;
  const line = game.lines[game.quizIdx];
  line.hints = Math.min(line.hints + 1, words(line.text).length);
  renderHintWords(line);
});

$('#drive-got').addEventListener('click', () => {
  if (!game) return;
  if (currentSong.mode === 'builder' && game.state === 'linerepeat') {
    // done practicing — hide the word and test the same one again with a run-up
    $('#quiz-area').classList.add('hidden');
    return restartBuilderPass();
  }
  if (game.state !== 'quiz') return;
  if (currentSong.mode === 'builder') return builderAnswer(true);
  const line = game.lines[game.quizIdx];
  // full credit first try, half credit after replays
  resolveQuiz(line.attempts ? 0.5 : 1, line.text);
  resumeAfterFeedback();   // no feedback card in drive mode — reveal in the panel and keep rolling
});

$('#drive-miss').addEventListener('click', () => {
  if (!game || game.state !== 'quiz' || !player) return;
  if (currentSong.mode === 'builder') return builderStartLineLoop();
  const line = game.lines[game.quizIdx];
  line.attempts = (line.attempts || 0) + 1;
  game.streak = 0;
  updateStats();
  // rewind to the start of the line, show it, play it, then ask again
  game.revealIdx = game.quizIdx;
  game.state = 'drivereplay';
  $('#quiz-area').classList.add('hidden');
  renderLyrics();
  player.seekTo(Math.max(0, lineTime(game.quizIdx) - LEAD), true);
  player.playVideo();
});

$('#skip-btn').addEventListener('click', () => {
  if (!game || game.state !== 'quiz') return;
  if (currentSong.mode === 'builder') return builderAnswer(true, true);  // advance, no points
  resolveQuiz(0, game.lines[game.quizIdx].text, true);
});

$('#replay-btn').addEventListener('click', () => {
  if (!game || game.state !== 'quiz' || !player) return;
  const pausePoint = lineTime(game.quizIdx) - LEAD;
  player.seekTo(Math.max(0, pausePoint - 6), true);
  player.playVideo();
  game.state = 'playing';   // ticker will re-pause at the same quiz line
});

function resolveQuiz(frac, fullText, skipped = false) {
  const line = game.lines[game.quizIdx];
  if (line.hints) frac = Math.max(0, frac - line.hints / words(fullText).length);  // peeked words aren't yours
  const good = frac >= 0.8;
  line.result = good ? 'good' : (frac > 0 ? 'partial' : 'bad');
  line.frac = frac;   // latest attempt wins, so loop practice updates your result
  if (good) {
    game.streak++;
    game.bestStreak = Math.max(game.bestStreak, game.streak);
    game.score += 10 + Math.min(game.streak, 5) * 2;
  } else {
    if (frac > 0) game.score += Math.round(frac * 10);
    game.streak = 0;
  }
  updateStats();

  game.state = 'feedback';
  $('#quiz-area').classList.add('hidden');
  const fb = $('#feedback-line');

  fb.innerHTML = `<span class="${good ? 'w-good' : ''}">${escapeHtml(fullText)}</span>`;
  const verdict = skipped ? 'Skipped' :
    good ? pickRandom(['Nailed it! 🎯', 'Perfect! ⭐', 'You know this one! 🔥']) :
    frac > 0 ? `Almost — ${Math.round(frac * 100)}% right` :
    pickRandom(['Not quite — here it is 👆', 'Tough one!']);
  fb.innerHTML += `<span class="verdict">${verdict}</span>`;

  $('#feedback-area').classList.remove('hidden');

  if (good && !skipped) {
    setTimeout(() => { if (game && game.state === 'feedback') resumeAfterFeedback(); }, 900);
  }
}

$('#continue-btn').addEventListener('click', resumeAfterFeedback);

function resumeAfterFeedback() {
  if (!game) return;
  $('#feedback-area').classList.add('hidden');
  game.idx = game.quizIdx + 1;
  game.quizIdx = null;
  game.state = 'playing';
  renderLyrics();
  player.playVideo();
}

/* ---------- full-screen lyrics ---------- */

function setLyricsFull(on) {
  $('#screen-game').classList.toggle('lyrics-full', on);
  $('#lyrics-close').classList.toggle('hidden', !on);
}
$('#lyrics-expand').addEventListener('click', () => setLyricsFull(true));
$('#lyrics-close').addEventListener('click', () => setLyricsFull(false));
// tapping the empty space of the lyrics (not a line) also expands
$('#lyrics-panel').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) setLyricsFull(true);
});

/* ---------- rendering ---------- */

function renderLyrics() {
  const panel = $('#lyrics-panel');
  panel.innerHTML = '';
  game.lines.forEach((line, i) => {
    const div = document.createElement('div');
    div.className = 'lyr-line';
    if (i === game.loopSel) div.classList.add('loop-sel');
    if (game.loopStart !== null && i >= game.loopStart && i <= game.loopEnd) div.classList.add('in-loop');
    div.addEventListener('click', () => onLineTap(i));
    if (currentSong.mode === 'builder' && (i < game.idx || i === game.builderLine)) {
      // learned words stay blanked; the rest of the line shows
      div.classList.add(i === game.builderLine ? 'current' : 'past');
      div.innerHTML = builderLineHtml(i);
    } else if (i < game.idx) {
      div.classList.add('past');
      if (line.result === 'good') div.innerHTML = `<span class="w-good">✓</span> ${escapeHtml(line.text)}`;
      else if (line.result) div.innerHTML = `<span class="w-bad">✗</span> ${escapeHtml(line.text)}`;
      else div.textContent = line.text;
    } else if (i === game.revealIdx) {
      div.classList.add('current');
      div.textContent = line.text;
    } else if (game.loopRepeat && game.loopStart !== null && i >= game.loopStart && i <= game.loopEnd) {
      div.classList.add('past');   // repeat mode: read along with the whole section
      div.textContent = line.text;
    } else if (i === game.idx && game.state === 'quiz') {
      div.classList.add('current');
      div.textContent = '🎤 …?';
    } else {
      // upcoming lines: real text behind a heavy blur, Apple Music style
      div.classList.add('future');
      div.textContent = line.text;
    }
    panel.appendChild(div);
  });
  // keep the active line vertically centered, gliding smoothly like a lyrics app
  const cur = panel.children[Math.min(game.idx, panel.children.length - 1)];
  if (cur) {
    panel.scrollTo({
      top: cur.offsetTop - panel.clientHeight / 2 + cur.offsetHeight / 2,
      behavior: 'smooth',
    });
  }
}

function updateStats() {
  $('#stat-score').textContent = game.score + ' pts';
  if (currentSong.mode === 'builder') {
    $('#stat-streak').textContent = '🧠';
    $('#stat-progress').textContent = game.builderCount + '/' + game.total + ' words';
    return;
  }
  const answered = game.lines.filter(l => l.quiz && l.result !== null).length;
  $('#stat-streak').textContent = '🔥 ' + game.streak;
  $('#stat-progress').textContent = answered + '/' + game.total;
}

/* ---------- sync offset ---------- */

$('#sync-earlier').addEventListener('click', () => adjustOffset(-0.25));
$('#sync-later').addEventListener('click', () => adjustOffset(0.25));
function adjustOffset(d) {
  currentSong.offset = Math.round((currentSong.offset + d) * 100) / 100;
  $('#sync-value').textContent = (currentSong.offset >= 0 ? '+' : '') + currentSong.offset.toFixed(2) + 's';
  saveToLibrary(currentSong);
}

/* ---------- results ---------- */

function finishGame() {
  if (!game || game.state === 'done') return;
  game.state = 'done';
  clearInterval(game.ticker);
  try { player.pauseVideo(); } catch {}

  const correct = game.lines.filter(l => l.quiz).reduce((s, l) => s + (l.frac || 0), 0);
  const acc = game.total ? Math.round((correct / game.total) * 100) : 0;
  $('#res-accuracy').textContent = acc + '%';
  $('#res-score').textContent = game.score;
  $('#res-streak').textContent = game.bestStreak;
  $('#results-emoji').textContent = acc >= 90 ? '🏆' : acc >= 70 ? '🎉' : acc >= 40 ? '💪' : '🌱';
  $('#results-title').textContent =
    acc >= 90 ? 'You own this song!' :
    acc >= 70 ? 'Nice work!' :
    acc >= 40 ? 'Getting there!' : 'Keep practicing!';

  if (!currentSong.bestScore || acc > currentSong.bestScore) currentSong.bestScore = acc;
  saveToLibrary(currentSong);
  showScreen('results');
}

$('#again-btn').addEventListener('click', () => startGame());

/* ============================== utils =============================== */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================== boot ================================ */

renderLibrary();
renderStarterPack();
renderModeSwitch();
