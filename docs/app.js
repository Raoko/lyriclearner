/* LyricLearner — play a real song, pause before each line, guess the lyric. */
'use strict';

const $ = (sel) => document.querySelector(sel);
const LS_KEY = 'lyriclearner.songs.v1';
const LRCLIB = 'https://lrclib.net/api';   // allows CORS, so this works on static hosting too

// lyric-video uploads: no long intros, so they track the LRC timing better than official videos
const STARTER_PACK = [
  { trackName: 'Tití Me Preguntó', artistName: 'Bad Bunny', lrclibId: 17906524, videoId: 'qBUKfQRbzuk' },
  { trackName: 'Me Porto Bonito', artistName: 'Bad Bunny ft. Chencho Corleone', lrclibId: 20453735, videoId: 'OblNX5rGJJM' },
  { trackName: 'Dákiti', artistName: 'Bad Bunny & Jhay Cortez', lrclibId: 576, videoId: '30YlLGeUReY' },
  { trackName: 'Callaíta', artistName: 'Bad Bunny', lrclibId: 1004116, videoId: 'RFE6v8FpfWs' },
  { trackName: 'Ojitos Lindos', artistName: 'Bad Bunny ft. Bomba Estéreo', lrclibId: 22269344, videoId: 'mJfkCSTNLhY' },
  { trackName: 'Efecto', artistName: 'Bad Bunny', lrclibId: 584, videoId: 'T71O6XB6qE8' },
  { trackName: 'Moscow Mule', artistName: 'Bad Bunny', lrclibId: 20667007, videoId: 'vgGM87RcRko' },
  { trackName: 'La Canción', artistName: 'J Balvin & Bad Bunny', lrclibId: 6678008, videoId: 'W6ctTolhr3Y' },
  { trackName: 'Yonaguni', artistName: 'Bad Bunny', lrclibId: 1596, videoId: 'fGlarRSIbfM' },
  { trackName: 'MÍA', artistName: 'Bad Bunny ft. Drake', lrclibId: 7448627, videoId: '635ynSfnTN0' },
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
        // reuse saved copy if they've played it before; migrate it when the pack's video changed
        const saved = loadLibrary().find(x => x.key === 'starter-' + s.lrclibId);
        if (saved) {
          if (saved.videoId !== s.videoId) {
            saved.videoId = s.videoId;
            saved.offset = 0;          // old offset was tuned to the old video
          }
          return openSetup(saved);
        }
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

function openSetup(song) {
  currentSong = { freq: 1, ...song };
  currentSong.mode = 'builder';   // the one mode: line-by-line with loops and saved progress
  currentSong.freq = 1;
  if (!currentSong.builderSpan) currentSong.builderSpan = 'lines';
  // builder progress changed meaning from words to lines — old counts don't translate
  if (!currentSong.builderV2) { currentSong.builderCount = 0; currentSong.builderV2 = true; }

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
  if (currentSong.videoId !== videoId) currentSong.offset = 0;  // old offset fit the old video
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

const LEAD = 0.35;         // pause this many seconds before the quizzed line starts
                           // (pauseVideo has real latency — too small and you hear the first word)
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
    state: 'loading',          // loading | playing | quiz | feedback | linerepeat | builderplay | looppause | done
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
    expectSeek: null,          // seek in flight: ignore stale clock readings until it lands
    videoError: false,
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
    // builder tests one full line at a time, in order
    game.lines.forEach(ln => { ln.quiz = false; });
    game.builderCount = Math.min(currentSong.builderCount || 0, game.lines.length);
    game.builderLine = -1;                  // line being tested / replayed
    game.builderGot = false;
    game.builderSkip = false;
    game.total = game.lines.length;
  }

  showScreen('game');
  renderLyrics();
  updateStats();
  updateLoopBar();
  $('#quiz-area').classList.add('hidden');
  $('#feedback-area').classList.add('hidden');
  $('#start-overlay').classList.add('hidden');
  $('#start-overlay').innerHTML = '<span class="play-circle">▶</span>Tap to start';
  $('#sync-value').textContent = (currentSong.offset >= 0 ? '+' : '') + currentSong.offset.toFixed(2) + 's';

  await ensureYouTubeAPI();
  if (player) { player.destroy(); player = null; }
  player = new YT.Player('yt-player', {
    videoId: currentSong.videoId,
    playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1 },
    events: {
      // iOS blocks autoplay with sound — playback must start from a real tap
      onReady: () => { $('#start-overlay').classList.remove('hidden'); },
      onError: (e) => {
        // 101/150 = embedding disabled by the uploader, 100 = video removed/private
        if (!game) return;
        game.videoError = true;
        const why = (e.data === 101 || e.data === 150) ? 'This video blocks playback in apps'
          : e.data === 100 ? 'This video was removed or is private'
          : 'This video won\'t play';
        const o = $('#start-overlay');
        o.innerHTML = `<span class="play-circle">⚠</span>${why} — tap to pick another`;
        o.classList.remove('hidden');
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED && game && game.state !== 'done') {
          if (isAdPlaying()) return;   // an ad finishing is not the song finishing
          if (game.state === 'linerepeat') {
            gameSeek(lineTime(game.repLine) - 0.5);
            player.playVideo();
          } else if (currentSong.mode === 'builder') {
            if (game.state === 'builderplay') builderLineEnded();
            else if (builderTarget() !== null) restartBuilderPass();
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
  if (game.videoError) return gotoVideoPicker();
  $('#start-overlay').classList.add('hidden');
  showGraceNote();
  if (currentSong.mode === 'builder') {
    if (builderTarget() !== null) restartBuilderPass();
    else builderComplete();               // song already fully built
    return;
  }
  game.state = 'playing';
  player.playVideo();
});

// swap the current song's video: back to the link screen, keep lyrics and progress
function gotoVideoPicker() {
  stopGame();
  $('#setup-title').textContent = currentSong.trackName;
  $('#setup-artist').textContent = currentSong.artistName;
  $('#yt-url').value = '';
  $('#yt-search-link').href = 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(currentSong.artistName + ' ' + currentSong.trackName + ' lyrics');
  $('#setup-status').textContent = '';
  validateSetup();
  showScreen('setup');
}

function stopGame() {
  setLyricsFull(false);
  closeSheet();
  $('#stop-loop-btn').classList.add('hidden');
  if (game && game.ticker) clearInterval(game.ticker);
  if (player) { try { player.destroy(); } catch {} player = null; }
  game = null;
}

function lineTime(i) {
  return game.lines[i].t + currentSong.offset;
}

// All in-game jumps go through here. YouTube keeps reporting the OLD position for a
// few hundred ms after seekTo — acting on that stale clock caused wrong pauses,
// seek storms, and stalled flows. The tick ignores the clock until the seek lands.
function gameSeek(tTarget) {
  const clamped = Math.max(0, tTarget);
  game.expectSeek = { t: clamped, at: Date.now() };
  player.seekTo(clamped, true);
}

// The iframe API has no ad events, but while an ad plays the player reports the
// ad's own short duration — if the "video" is far too short to be our song, it's an ad.
function isAdPlaying() {
  if (typeof player.getDuration !== 'function') return false;
  const dur = player.getDuration();
  if (!dur) return true;   // metadata not loaded yet — don't run game logic on nothing
  const lastT = game.lines[game.lines.length - 1].t;
  return dur < Math.min(120, lastT * 0.5);
}

function tick() {
  if (!game || !player || typeof player.getCurrentTime !== 'function') return;
  if (isAdPlaying()) return;   // let the ad run; the game resumes when the song starts
  const t = player.getCurrentTime();
  if (typeof t !== 'number') return;

  // a seek is in flight — don't act on the clock until the player lands near the target
  if (game.expectSeek) {
    if (Math.abs(t - game.expectSeek.t) > 1.5 && Date.now() - game.expectSeek.at < 3000) return;
    game.expectSeek = null;
  }

  // "Loop it": seamlessly cycle one line, any mode, no pauses
  if (game.state === 'linerepeat') {
    const end = game.repLine + 1 < game.lines.length
      ? lineTime(game.repLine + 1) - LEAD
      : lineTime(game.repLine) + 6;
    if (t >= end) gameSeek(lineTime(game.repLine) - 0.5);
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

  if (game.state !== 'playing') return;

  // builder mode: pause right before the line being learned
  if (currentSong.mode === 'builder') {
    const target = builderTarget();
    if (target !== null && t >= lineTime(target) - LEAD) {
      player.pauseVideo();
      game.idx = target;
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
      gameSeek(lineTime(game.loopStart) - 2);
      game.state = 'playing';
      player.playVideo();
    }, 1000);
  } else {
    gameSeek(lineTime(game.loopStart) - 2);
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
  // the bar only exists while a loop is being picked or is running — otherwise no clutter
  const bar = document.querySelector('.loop-bar');
  const hint = $('#loop-hint'), clear = $('#loop-clear'), modeBtn = $('#loop-mode-btn');
  const active = game.loopStart !== null, armed = game.loopSel !== null;
  if (currentSong.mode === 'builder' || (!active && !armed)) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  modeBtn.classList.toggle('hidden', !active);
  modeBtn.textContent = game.loopRepeat ? '🔂 Repeat mode' : '🎓 Quiz mode';
  clear.classList.remove('hidden');
  if (active) {
    hint.textContent = `🔁 Looping lines ${game.loopStart + 1}–${game.loopEnd + 1}`;
    clear.textContent = '✕ Clear loop';
  } else {
    hint.textContent = '🔁 Now tap the last line of the section';
    clear.textContent = '✕ Cancel';
  }
}

/* ---------- builder (learn one line at a time) ---------- */

// the next line index to learn, or null when the song is done
function builderTarget() {
  return game.builderCount < game.lines.length ? game.builderCount : null;
}

function enterBuilderQuiz(target) {
  game.state = 'quiz';
  game.builderLine = target;
  game.revealIdx = null;

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

  const ws = words(game.lines[target].text);
  $('#quiz-prompt').innerHTML =
    `Line ${game.builderCount + 1}/${game.total}: ` +
    promptWithBlanks(ws, ws.map((_, j) => j));
  renderLyrics();
}

function builderAnswer(got, skipped = false) {
  if (!game || game.state !== 'quiz') return;
  game.builderGot = got;
  game.builderSkip = skipped;
  game.revealIdx = game.builderLine;   // watch the words as the line you recalled plays
  game.state = 'builderplay';
  $('#quiz-area').classList.add('hidden');
  renderLyrics();
  player.playVideo();
}

// "Loop it": cycle just the current line continuously, revealed, no card, no prompts —
// pure listening. Only a floating pill to tap when it has sunk in. Works in every mode.
function startLineLoop() {
  if (!game || game.state !== 'quiz') return;
  const builder = currentSong.mode === 'builder';
  game.repLine = builder ? game.builderLine : game.quizIdx;
  game.revealIdx = game.repLine;
  game.state = 'linerepeat';
  $('#quiz-area').classList.add('hidden');
  $('#stop-loop-btn').classList.remove('hidden');
  renderLyrics();
  gameSeek(lineTime(game.repLine) - 0.5);
  player.playVideo();
}

$('#stop-loop-btn').addEventListener('click', () => {
  if (!game || game.state !== 'linerepeat') return;
  $('#stop-loop-btn').classList.add('hidden');
  if (currentSong.mode === 'builder') return restartBuilderPass();  // re-test the word with a run-up
  // drive: hide the line again and ride in from the previous one; the same quiz pauses again
  game.revealIdx = null;
  const line = game.lines[game.quizIdx];
  line.attempts = (line.attempts || 0) + 1;
  game.state = 'playing';
  renderLyrics();
  gameSeek(game.quizIdx > 0 ? lineTime(game.quizIdx - 1) - 0.5 : lineTime(0) - 3);
  player.playVideo();
});

function builderLineEnded() {
  player.pauseVideo();
  game.revealIdx = null;
  if (game.builderGot) {
    game.builderCount++;
    if (!game.builderSkip) game.score += 5;
    currentSong.builderCount = game.builderCount;
    saveToLibrary(currentSong);
    updateStats();
    const next = builderTarget();
    if (next === null) return builderComplete();
    if (currentSong.builderSpan !== 'song') {
      // the line that just played was the run-up — we're at the next line's doorstep
      game.idx = next;
      return enterBuilderQuiz(next);
    }
  }
  restartBuilderPass();
}

function restartBuilderPass() {
  const target = builderTarget();
  // always at least one line of run-up before the target so it flows
  const startLine = currentSong.builderSpan === 'song' ? 0 : Math.max(0, target - 1);
  game.builderLine = -1;
  game.revealIdx = null;
  game.idx = startLine;
  game.state = 'playing';
  renderLyrics();
  // if the target IS the first line, give a few seconds of intro as the run-up instead
  const pre = startLine === target ? 3 : 1;
  gameSeek(lineTime(startLine) - pre);
  player.playVideo();
}

function builderComplete() {
  game.state = 'done';
  clearInterval(game.ticker);
  try { player.pauseVideo(); } catch {}
  $('#res-accuracy').textContent = '100%';
  $('#res-score').textContent = game.score;
  $('#res-streak').textContent = game.total;
  $('#results-emoji').textContent = '🧠';
  $('#results-title').textContent = 'Every line memorized!';
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
  $('#drive-miss').textContent = '🔁 Loop it';
  $('#drive-got').textContent = 'Next →';
  renderHintWords(line);
  renderLyrics();

  const ws = words(line.text);

  if (mode === 'drive') {
    line.attempts = line.attempts || 0;
    $('#quiz-prompt').textContent = line.attempts
      ? 'Try it again:'
      : 'Say the next line:';
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
  if (!game || game.state !== 'quiz') return;
  if (currentSong.mode === 'builder') return builderAnswer(true);
  const line = game.lines[game.quizIdx];
  // Next always counts as got it — repeats are learning, not failure
  resolveQuiz(1, line.text);
  resumeAfterFeedback();   // no feedback card in drive mode — reveal in the panel and keep rolling
});

$('#drive-miss').addEventListener('click', () => {
  if (!game || game.state !== 'quiz' || !player) return;
  startLineLoop();   // same continuous listening loop in every mode
});

$('#skip-btn').addEventListener('click', () => {
  if (!game || game.state !== 'quiz') return;
  if (currentSong.mode === 'builder') return builderAnswer(true, true);  // advance, no points
  resolveQuiz(0, game.lines[game.quizIdx].text, true);
});

$('#replay-btn').addEventListener('click', () => {
  if (!game || game.state !== 'quiz' || !player) return;
  gameSeek(lineTime(game.quizIdx) - LEAD - 6);
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
$('#lyrics-close').addEventListener('click', () => setLyricsFull(false));
// tapping the empty space of the lyrics (not a line) also expands
$('#lyrics-panel').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) setLyricsFull(true);
});

/* ---------- the one ⋯ menu ---------- */

function openSheet() {
  // quiz-only actions hide when there's no quiz waiting
  if (!game || game.state !== 'quiz') {
    ['#hint-btn', '#replay-btn', '#span-btn', '#skip-btn'].forEach(s => $(s).classList.add('hidden'));
  }
  $('#fs-item').textContent = $('#screen-game').classList.contains('lyrics-full')
    ? '⛶ Exit full-screen lyrics' : '⛶ Full-screen lyrics';
  $('#sheet-scrim').classList.remove('hidden');
  $('#more-sheet').classList.remove('hidden');
}
function closeSheet() {
  $('#sheet-scrim').classList.add('hidden');
  $('#more-sheet').classList.add('hidden');
}
$('#more-btn').addEventListener('click', openSheet);
$('#sheet-scrim').addEventListener('click', closeSheet);
$('#fs-item').addEventListener('click', () => {
  setLyricsFull(!$('#screen-game').classList.contains('lyrics-full'));
  closeSheet();
});
$('#change-video-item').addEventListener('click', () => {
  closeSheet();
  gotoVideoPicker();
});
$('#start-over-item').addEventListener('click', () => {
  if (!game) return;
  closeSheet();
  game.builderCount = 0;
  currentSong.builderCount = 0;
  saveToLibrary(currentSong);
  game.score = 0;
  game.streak = 0;
  game.bestStreak = 0;
  updateStats();
  $('#quiz-area').classList.add('hidden');
  $('#stop-loop-btn').classList.add('hidden');
  $('#start-overlay').classList.add('hidden');
  restartBuilderPass();
});
// acting on the quiz closes the sheet so you see the result; sync and span stay open to fiddle
['#hint-btn', '#replay-btn', '#skip-btn'].forEach(s => $(s).addEventListener('click', closeSheet));

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
    if (currentSong.mode === 'builder' && game.state === 'quiz' && i === game.builderLine) {
      // the tested line: all blanks, recall it from memory
      div.classList.add('current');
      div.innerHTML = words(line.text)
        .map(w => `<span class="w-blank">${escapeHtml(w.raw)}</span>`).join(' ');
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
  // one calm number in the header; score and streak wait for the results screen
  const label = currentSong.mode === 'builder'
    ? `${game.builderCount}/${game.total} lines`
    : `${game.lines.filter(l => l.quiz && l.result !== null).length}/${game.total}`;
  $('#stat-progress').textContent = label;
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
