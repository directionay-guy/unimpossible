/* ============================================================================
   UNIMPOSSIBLE — vanilla JS engine
   A daily word game from the creator of Directionary.

   Ported faithfully from the React reference. No frameworks, no build step.
   Sections:
     1. Word bank load
     2. Seeded RNG + date key (daily puzzle + midnight rollover)
     3. Generator (placement, decoys, trap-free gate)  -- verbatim algorithms
     4. Anchor (free starting letter)
     5. Game state
     6. Board application + reset
     7. Rendering
     8. Drag & drop interaction
     9. Win/loss, hints, scoring
    10. Modals (help/about/stats/share) + dismissal
    11. Stats (localStorage)
    12. Boot + daily rollover watcher
   ============================================================================ */

(() => {
  'use strict';

  /* ---- constants ---------------------------------------------------------- */
  const LAUNCH_DATE = '2026-08-11';   // puzzle #1 = this date (adjust at launch)
  const START_MOVES = 100;
  const MAX_HINTS = 5;
  const WORD_TRIES = 60;
  const PLACEMENT_TRIES = 25;

  const LANE = {
    top:    { soft: '#7FB0F5', mid: '#3B82F6', deep: '#2563EB', dir: 'blue' },
    left:   { soft: '#74D69B', mid: '#22C55E', deep: '#16A34A', dir: 'green' },
    bottom: { soft: '#F7B25E', mid: '#F97316', deep: '#EA580C', dir: 'orange' },
    right:  { soft: '#F58FC2', mid: '#EC4899', deep: '#DB2777', dir: 'pink' },
  };

  /* ---- 1. word bank ------------------------------------------------------- */
  let WORD_BANK = [];

  /* ---- 2. seeded RNG + date ---------------------------------------------- */
  // Mulberry32 seeded PRNG so every player gets the same daily board.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  // ONE source of truth for "today" — used for BOTH the seed and the rollover
  // check, in local time. (This single-source rule is what prevents the
  // Directionary midnight-reload bug.)
  function getTodayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function getPuzzleNumber(dayKey) {
    const launch = new Date(LAUNCH_DATE + 'T00:00:00');
    const today = new Date(dayKey + 'T00:00:00');
    const diff = Math.floor((today - launch) / 86400000);
    return diff + 1;
  }

  // Active RNG — swapped between seeded (daily) and Math.random (dev/Shift+N).
  let rng = Math.random;

  function shuffleArr(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---- 3. generator (verbatim algorithms) -------------------------------- */
  function buildDemands(top, left, bottom, right) {
    const d = [];
    for (let c = 0; c < 6; c++) {
      d.push({ letter: top[c], line: 'col', index: c });
      d.push({ letter: bottom[c], line: 'col', index: c });
    }
    for (let r = 0; r < 6; r++) {
      d.push({ letter: left[r], line: 'row', index: r });
      d.push({ letter: right[r], line: 'row', index: r });
    }
    return d;
  }

  function placeDemands(top, left, bottom, right) {
    const order = shuffleArr(buildDemands(top, left, bottom, right));
    const g = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ''));
    const candidates = (d) => {
      const cells = [];
      if (d.line === 'col') { for (let r = 0; r < 6; r++) cells.push({ row: r, col: d.index }); }
      else { for (let c = 0; c < 6; c++) cells.push({ row: d.index, col: c }); }
      return shuffleArr(cells);
    };
    const backtrack = (i) => {
      if (i === order.length) return true;
      const d = order[i];
      for (const cell of candidates(d)) {
        if (g[cell.row][cell.col] === '') {
          g[cell.row][cell.col] = d.letter;
          if (backtrack(i + 1)) return true;
          g[cell.row][cell.col] = '';
        }
      }
      return false;
    };
    if (!backtrack(0)) return null;
    return g;
  }

  function fillDecoys(g, top, left, bottom, right) {
    const realLetters = [...new Set([...top, ...left, ...bottom, ...right])];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (g[r][c] !== '') continue;
        const forbidden = new Set([top[c], bottom[c], left[r], right[r]]);
        const pool = shuffleArr(realLetters.filter((l) => !forbidden.has(l)));
        let chosen = pool[0];
        if (!chosen) {
          const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
          chosen = shuffleArr(alpha.filter((l) => !forbidden.has(l)))[0];
        }
        g[r][c] = chosen;
      }
    }
    return g;
  }

  function validateWinnable(g, top, left, bottom, right) {
    if (!g || !Array.isArray(g)) return false;
    const colHas = (col, letter) => { for (let r = 0; r < 6; r++) if (g[r][col] === letter) return true; return false; };
    const rowHas = (row, letter) => { for (let c = 0; c < 6; c++) if (g[row][c] === letter) return true; return false; };
    for (let c = 0; c < 6; c++) if (!colHas(c, top[c]) || !colHas(c, bottom[c])) return false;
    for (let r = 0; r < 6; r++) if (!rowHas(r, left[r]) || !rowHas(r, right[r])) return false;
    let filled = 0;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (g[r][c] !== '') filled++;
    return filled === 36;
  }

  // ---- trap detection ----
  function buildSolveSlots(g, top, left, bottom, right) {
    const colCells = (c, L) => { const o = []; for (let r = 0; r < 6; r++) if (g[r][c] === L) o.push(r + ',' + c); return o; };
    const rowCells = (r, L) => { const o = []; for (let c = 0; c < 6; c++) if (g[r][c] === L) o.push(r + ',' + c); return o; };
    const slots = [];
    for (let c = 0; c < 6; c++) { slots.push(colCells(c, top[c])); slots.push(colCells(c, bottom[c])); }
    for (let r = 0; r < 6; r++) { slots.push(rowCells(r, left[r])); slots.push(rowCells(r, right[r])); }
    return slots;
  }
  function solvableWith(slots, forceIdx, forceCell) {
    const order = slots.map((s, i) => i).sort((a, b) => slots[a].length - slots[b].length);
    const used = new Set();
    if (forceIdx !== undefined) {
      if (!slots[forceIdx].includes(forceCell)) return false;
      used.add(forceCell);
    }
    const seq = order.filter((i) => i !== forceIdx);
    const bt = (k) => {
      if (k === seq.length) return true;
      for (const cell of slots[seq[k]]) {
        if (!used.has(cell)) {
          used.add(cell);
          if (bt(k + 1)) return true;
          used.delete(cell);
        }
      }
      return false;
    };
    return bt(0);
  }
  function isTrapFree(g, top, left, bottom, right) {
    const slots = buildSolveSlots(g, top, left, bottom, right);
    if (!solvableWith(slots)) return false;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].length <= 1) continue;
      for (const cell of slots[i]) {
        if (!solvableWith(slots, i, cell)) return false;
      }
    }
    return true;
  }

  // Generate one complete, validated, TRAP-FREE puzzle.
  // Order is critical: trap-check the demand grid FIRST, then fill decoys,
  // then validate the full 36-cell grid.
  function generatePuzzle() {
    for (let w = 0; w < WORD_TRIES; w++) {
      const picks = shuffleArr(WORD_BANK).slice(0, 4);
      const [top, left, bottom, right] = picks.map((wd) => wd.split(''));
      for (let t = 0; t < PLACEMENT_TRIES; t++) {
        const placed = placeDemands(top, left, bottom, right);
        if (!placed) break;
        if (!isTrapFree(placed, top, left, bottom, right)) continue;
        fillDecoys(placed, top, left, bottom, right);
        if (!validateWinnable(placed, top, left, bottom, right)) continue;
        return {
          grid: placed,
          words: { topWord: picks[0], leftWord: picks[1], bottomWord: picks[2], rightWord: picks[3] },
        };
      }
    }
    return null;
  }

  /* ---- 4. anchor (free starting letter) ---------------------------------- */
  function chooseAnchor(g, words) {
    const top = words.topWord.split(''), left = words.leftWord.split('');
    const bottom = words.bottomWord.split(''), right = words.rightWord.split('');
    const cands = [];
    const findInCol = (col, letter) => { for (let r = 0; r < 6; r++) if (g[r][col] === letter) return r; return -1; };
    const findInRow = (row, letter) => { for (let c = 0; c < 6; c++) if (g[row][c] === letter) return c; return -1; };
    for (let c = 0; c < 6; c++) {
      const r1 = findInCol(c, top[c]); if (r1 >= 0) cands.push({ key: `top-${c}`, letter: top[c], row: r1, col: c });
      const r2 = findInCol(c, bottom[c]); if (r2 >= 0) cands.push({ key: `bottom-${c}`, letter: bottom[c], row: r2, col: c });
    }
    for (let r = 0; r < 6; r++) {
      const c1 = findInRow(r, left[r]); if (c1 >= 0) cands.push({ key: `left-${r}`, letter: left[r], row: r, col: c1 });
      const c2 = findInRow(r, right[r]); if (c2 >= 0) cands.push({ key: `right-${r}`, letter: right[r], row: r, col: c2 });
    }
    if (cands.length === 0) return null;
    const leverage = (x) => ((x.row >= 1 && x.row <= 4) ? 1 : 0) + ((x.col >= 1 && x.col <= 4) ? 1 : 0);
    const maxLev = Math.max(...cands.map(leverage));
    const best = cands.filter((x) => leverage(x) === maxLev);
    return best[Math.floor(rng() * best.length)];
  }

  /* ---- 5. game state ------------------------------------------------------ */
  const S = {
    grid: [],                 // current 6x6 (letters or '')
    pristineGrid: null,       // full generated grid (for mode toggles)
    anchorChoice: null,       // fixed anchor for this puzzle
    anchorKey: null,          // active locked slot key, e.g. 'top-2'
    words: null,              // { topWord, leftWord, bottomWord, rightWord }
    lanes: { top: [], left: [], bottom: [], right: [] }, // placed letters per lane
    moved: new Map(),         // laneKey -> "row-col" origin (for ghosts + drag-back)
    score: START_MOVES,
    moveCount: 0,
    hintsUsed: 0,
    hasWon: false,
    hasLost: false,
    assistMode: false,        // false = Unimpossible (default). true = Possible.
    highlight: null,          // { row, col, dir } hinted tile
    puzzleNumber: 0,
    dayKey: null,
    selected: null,           // { source:'grid'|lane, letter, row/col or index, targets/home }
    verified: new Set(),      // lane keys the game itself confirmed (anchor, hinted placements)
    hintedCells: new Set(),   // grid cells a hint has revealed, as "row-col"
    refunded: new Set(),      // words already credited their +6 (by word string)
    startedTracked: false,    // analytics: puzzle_started event fired once this game
  };

  // ---- analytics (GA4) -------------------------------------------------------
  // Fire a named event with optional params. Wrapped so a missing/blocked gtag
  // (ad-blockers, etc.) can NEVER interfere with gameplay. Every event carries
  // the current mode so results can be split Possible vs Unimpossible.
  function track(event, params) {
    try {
      if (typeof gtag !== 'function') return;
      const mode = S.assistMode ? 'possible' : 'unimpossible';
      gtag('event', event, Object.assign({ mode: mode }, params || {}));
    } catch (e) { /* analytics must never break the game */ }
  }

  const gameStarted = () => S.moveCount > 0 || S.hintsUsed > 0;

  /* ---- 6. board application + reset -------------------------------------- */
  function applyBoard(sourceGrid, anchor, showAnchor, fullReset) {
    const baseGrid = sourceGrid.map((row) => [...row]);
    const lanes = { top: ['', '', '', '', '', ''], left: ['', '', '', '', '', ''], bottom: ['', '', '', '', '', ''], right: ['', '', '', '', '', ''] };
    const moved = new Map();
    let anchorKey = null;

    if (showAnchor && anchor) {
      const [lane, idxStr] = anchor.key.split('-');
      const idx = parseInt(idxStr, 10);
      lanes[lane][idx] = anchor.letter;
      baseGrid[anchor.row][anchor.col] = '';
      moved.set(anchor.key, `${anchor.row}-${anchor.col}`);
      anchorKey = anchor.key;
    }

    S.grid = baseGrid;
    S.lanes = lanes;
    S.moved = moved;
    S.anchorKey = anchorKey;
    S.highlight = null;
    S.selected = null;
    S.verified = new Set(anchorKey ? [anchorKey] : []);
    S.hintedCells = new Set();
    if (fullReset) {
      S.hasWon = false; S.hasLost = false;
      S.score = START_MOVES; S.moveCount = 0; S.hintsUsed = 0;
      S.refunded = new Set();
      S.startedTracked = false;   // analytics: allow puzzle_started to fire on the new puzzle
      previewCountdown = false;   // never leave a fresh board showing the clock
      stopCountdown();
    }
    render();
    saveGame();
  }


  // Tell the dev panel (if present) that the board changed.
  function notifyPuzzleLoad() {
    if (window.UNIMP_DEV && typeof window.UNIMP_DEV.onPuzzleLoad === 'function') {
      window.UNIMP_DEV.onPuzzleLoad();
    }
  }

  function loadDailyPuzzle() {
    const dayKey = getTodayKey();
    rng = mulberry32(hashStr('UNIMPOSSIBLE-' + dayKey));
    const puzzle = generatePuzzle();
    if (!puzzle) { console.error('Generator failed.'); return; }
    S.dayKey = dayKey;
    S.puzzleNumber = getPuzzleNumber(dayKey);
    S.words = puzzle.words;
    S.pristineGrid = puzzle.grid.map((r) => [...r]);
    S.anchorChoice = chooseAnchor(puzzle.grid, puzzle.words);
    updateHeader();
    // If there's a saved game for today, restore it; otherwise start fresh.
    if (!restoreGame()) {
      applyBoard(puzzle.grid, S.anchorChoice, S.assistMode, true);
    }
    notifyPuzzleLoad();
  }

  // Dev / Shift+N: fresh RANDOM puzzle (not seeded).
  function loadRandomPuzzle() {
    rng = Math.random;
    const puzzle = generatePuzzle();
    if (!puzzle) { console.error('Generator failed.'); return; }
    S.words = puzzle.words;
    S.pristineGrid = puzzle.grid.map((r) => [...r]);
    S.anchorChoice = chooseAnchor(puzzle.grid, puzzle.words);
    applyBoard(puzzle.grid, S.anchorChoice, S.assistMode, true);
    updateHeader();
    notifyPuzzleLoad();
  }

  function applyModeAnchor(newAssist) {
    if (!S.pristineGrid) return;
    S.assistMode = newAssist;
    applyBoard(S.pristineGrid, S.anchorChoice, newAssist, false);
    saveMode(newAssist);
    updateModeUI();
  }

  /* ---- 7. rendering ------------------------------------------------------- */
  const el = (id) => document.getElementById(id);

  // Ghost map: laneKey origin cells -> letter, so the grid shows where a placed
  // tile came from. Keyed "row-col".
  function ghostMap() {
    const m = new Map();
    for (const [laneKey, origin] of S.moved.entries()) {
      const [lane, idxStr] = laneKey.split('-');
      const idx = parseInt(idxStr, 10);
      const letter = S.lanes[lane][idx];
      if (letter) m.set(origin, letter);
    }
    return m;
  }

  // A horizontal word (top OR bottom) is valid in EITHER horizontal lane; a
  // vertical word (left OR right) is valid in EITHER vertical lane. There's no
  // information on the board distinguishing near from far, so forcing a specific
  // lane was a pure coin-flip — a correct solver failed 3 times out of 4. So a
  // lane "confirms" when it holds either word of its orientation.
  function laneConfirmed(lane) {
    if (!S.words) return false;
    const filled = S.lanes[lane].join('');
    if (lane === 'top' || lane === 'bottom') {
      return filled === S.words.topWord || filled === S.words.bottomWord;
    }
    return filled === S.words.leftWord || filled === S.words.rightWord;
  }

  function render() {
    renderLane('top');
    renderLane('left');
    renderLane('right');
    renderLane('bottom');
    renderGrid();
    renderScore();
  }

  function laneSlotStyle(laneKey, filled, confirmed, isAnchor, isVerified, isTgt, isSel) {
    const c = LANE[laneKey];
    // Permanent states speak in BORDERS; transient states speak in FILL/motion.
    // BOLD (deep border) means exactly one thing: this WORD is correct (Possible
    // mode). The free letter and hinted letters are NOT bolded — otherwise players
    // generalise "correct letters look bold" and get confused when their own
    // correct placements don't. Those letters are instead known by being locked
    // (immovable = free/hint).
    const deep = confirmed;
    let bg = filled ? 'var(--ivory)' : c.soft;
    let extra = '';
    if (isTgt) {
      // the destination to act on: full lane colour, scaled, pulsing
      bg = c.mid;
      extra = 'transform:scale(1.06);';
    }
    // NOTE: when a hint points at one destination, the other legal targets get
    // NO special treatment at all — they render exactly like ordinary empty
    // slots. Dimming them made them stand out in a different way rather than
    // standing down, which defeats the point of the hint.
    if (isSel) {
      // picked up: lift only, no colour change
      bg = 'var(--ivory)';
      extra = 'transform:translateY(-4px) scale(1.12);box-shadow:0 8px 14px rgba(0,0,0,0.6);z-index:5;position:relative;';
    }
    const color = 'var(--ink)';
    // Widen the gap between confirmed and unconfirmed so a bold (correct) word
    // reads clearly even on a small phone: default lanes get a thin 1px edge,
    // a filled-but-unconfirmed tile 2px, and a confirmed word a bold 3px.
    const border = deep ? `4px solid ${c.deep}`
      : filled ? `2px solid ${c.mid}` : `1px solid rgba(22,20,31,0.13)`;
    const shadow = filled ? 'box-shadow:0 2px 4px rgba(22,20,31,0.28);' : '';
    const cursor = isAnchor ? 'cursor:default;' : 'cursor:pointer;';
    return `background:${bg};color:${color};border-radius:4px;border:${border};${shadow}${cursor}${extra}`;
  }

  function renderLane(lane) {
    const container = el('lane-' + lane);
    // Only Possible mode confirms a finished word (thick outline). Unimpossible
    // is pure deduction — a completed word looks identical to an unfinished one,
    // and you only learn you're right when all four click and you win.
    const confirmed = S.assistMode && laneConfirmed(lane);
    const hs = hintedSlot();
    const hintActive = selectedIsHinted();
    let html = '';
    for (let i = 0; i < 6; i++) {
      const letter = S.lanes[lane][i];
      const key = `${lane}-${i}`;
      const isAnchor = S.anchorKey === key;
      const isVerified = S.verified.has(key);
      const tgt = isTarget(lane, i);
      // The hint knows BOTH ends, so light the destination the moment the hint
      // fires — no need to pick up the tile first to see where it goes. It
      // calms down if you pick up some other tile, so it never competes.
      const isHintDest = !!(hs && hs.lane === lane && hs.idx === i);
      const hintDestLit = isHintDest && (!S.selected || hintActive);
      // When the hinted tile is the selected one, only its destination shouts;
      // the other legal targets render as ordinary empty slots.
      const isPrimary = tgt && hintActive && isHintDest;
      const loud = (tgt && (!hintActive || isPrimary)) || hintDestLit;
      const sel = !!(S.selected && S.selected.source === lane && S.selected.index === i);
      const style = laneSlotStyle(lane, !!letter, confirmed, isAnchor, isVerified, loud, sel);
      const pulse = loud ? ' target-pulse' : '';
      html += `<div class="slot${pulse}" data-lane="${lane}" data-idx="${i}" style="${style}">${letter || ''}</div>`;
    }
    container.innerHTML = html;
  }

  /* ---- countdown to the next puzzle ---------------------------------------
     When a game is finished (won or lost) the grid becomes a countdown to the
     next local midnight, while the four solved lanes stay put so the player can
     admire the result. Ticks every second — the live seconds are what make it
     read as a clock rather than a static label. */
  let countdownTimer = null;

  function msUntilMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return Math.max(0, next - now);
  }

  // Lays the clock out across the 6x6 grid:
  //   . N E X T .
  //   . G A M E .
  //   1 3 _ H R .      <- space (not a colon) so the only colon is the real one
  //   3 4 : 1 2 .      <- mins:secs, ticking, so 34 is unambiguous
  function countdownCells() {
    const total = Math.floor(msUntilMidnight() / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return [
      ['', '', '', '', '', ''],
      ['', 'N', 'E', 'X', 'T', ''],
      ['', 'G', 'A', 'M', 'E', ''],
      [h[0], h[1], '', 'H', 'R', ''],
      [m[0], m[1], ':', s[0], s[1], ''],
      ['', '', '', '', '', ''],
    ];
  }

  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(() => {
      if (!showCountdownGrid()) { stopCountdown(); return; }
      // Auto-advance: if the day has actually rolled over while the finished
      // board is on screen, silently load the new day's puzzle — the countdown
      // becomes the changeover. This fires at most ONCE: loadDailyPuzzle sets a
      // new dayKey and clears hasWon/hasLost, and stopCountdown() kills this
      // timer, so the conditions that triggered it are gone before any next
      // tick. (That once-and-done property is what prevents the repeated-reload
      // bug.) The day check uses the single getTodayKey() source of truth.
      if (isGameOver() && getTodayKey() !== S.dayKey) {
        stopCountdown();
        previewCountdown = false;
        loadDailyPuzzle();
        return;
      }
      renderGrid();
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function isGameOver() { return S.hasWon || S.hasLost; }

  // Secret playtest preview (Shift+T): show the countdown without having to
  // finish a game. Purely visual — it doesn't touch score or game state.
  let previewCountdown = false;
  function showCountdownGrid() { return isGameOver() || previewCountdown; }
  function toggleCountdownPreview() {
    previewCountdown = !previewCountdown;
    if (previewCountdown) startCountdown(); else stopCountdown();
    renderGrid();
  }

  function renderCountdownGrid() {
    const container = el('grid');
    const cells = countdownCells();
    let html = '';
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const ch = cells[r][c];
        html += ch
          ? `<div class="cell"><div class="countdown-tile">${ch}</div></div>`
          : `<div class="cell empty"></div>`;
      }
    }
    container.innerHTML = html;
  }

  function renderGrid() {
    if (showCountdownGrid()) { renderCountdownGrid(); return; }
    const container = el('grid');
    const ghosts = ghostMap();
    let html = '';
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const cell = S.grid[r][c];
        const key = `${r}-${c}`;
        const ghost = ghosts.get(key);
        const isHi = S.highlight && S.highlight.row === r && S.highlight.col === c;
        const isSel = !!(S.selected && S.selected.source === 'grid' && S.selected.row === r && S.selected.col === c);
        const homeTgt = isHomeTarget(r, c);
        if (cell) {
          const hintLane = isHi ? LANE[dirToLane(S.highlight.dir)] : null;
          let bg, fg, shadow, border;
          if (isSel && hintLane) {
            // selected AND hinted: lifted, in the destination lane colour so the
            // tile keeps its directional identity while picked up
            bg = hintLane.deep; fg = 'var(--bone)';
            shadow = 'transform:translateY(-3px) scale(1.08);box-shadow:0 6px 12px rgba(0,0,0,0.55);z-index:5;position:relative;';
            border = `2px solid ${hintLane.mid}`;
          } else if (isSel) {
            // selected: signalled ONLY by physically lifting off the board —
            // no colour change at all, so nothing can be mistaken for a clue.
            bg = 'var(--ivory)'; fg = 'var(--ink)';
            shadow = 'transform:translateY(-4px) scale(1.12);box-shadow:0 8px 14px rgba(0,0,0,0.6);z-index:5;position:relative;';
            border = '2px solid var(--ink)';
          } else if (hintLane) {
            // hinted, not selected: the lane-coloured face does the marking, so
            // the outline just needs to define the edge — not shout.
            bg = hintLane.soft; fg = 'var(--ink)';
            shadow = 'box-shadow:0 2px 4px rgba(22,20,31,0.28);';
            border = `2px solid ${hintLane.deep}`;
          } else {
            bg = 'var(--ivory)'; fg = 'var(--ink)';
            shadow = 'box-shadow:0 2px 4px rgba(22,20,31,0.28);';
            border = '1px solid rgba(22,20,31,0.13)';
          }
          // hint holds steady while something is selected — only one thing moves
          const pulse = (isHi && !S.selected) ? ' grid-pulse' : '';
          html += `<div class="cell" data-row="${r}" data-col="${c}">
            <div class="grid-tile${pulse}" data-row="${r}" data-col="${c}"
              style="background:${bg};color:${fg};font-family:var(--font-mark);border:${border};${shadow}cursor:pointer;">${cell}</div>
          </div>`;
        } else if (ghost) {
          const tgtStyle = homeTgt ? 'background:rgba(255,90,60,0.25);border:2px solid var(--coral);' : '';
          const pulse = homeTgt ? ' target-pulse' : '';
          html += `<div class="cell${pulse}" data-row="${r}" data-col="${c}">
            <div class="ghost" style="${tgtStyle}">${ghost}</div>
          </div>`;
        } else {
          html += `<div class="cell empty" data-row="${r}" data-col="${c}"></div>`;
        }
      }
    }
    container.innerHTML = html;
  }

  function dirToLane(dir) {
    return { blue: 'top', green: 'left', orange: 'bottom', pink: 'right' }[dir];
  }

  function renderScore() {
    el('score-value').textContent = S.score;
    updateModeUI();
  }

  function updateModeUI() {
    // middle slot: Hint (Possible) or "no hints" banner (Unimpossible)
    const mid = el('middle-slot');
    if (S.assistMode) {
      const disabled = S.hintsUsed >= MAX_HINTS;
      mid.innerHTML = `
        <div class="hint-row">
          <button id="hint-btn" class="btn-hint rise ${disabled ? 'is-disabled' : ''}" ${disabled ? 'disabled' : ''}>
            <span class="bulb">&#128161;</span> Hint
          </button>
          <span class="hint-note">(${MAX_HINTS - S.hintsUsed} left) uses 1 move each</span>
        </div>
        <div id="hint-msg" class="hint-msg" style="display:none;"></div>`;
      if (!disabled) el('hint-btn').addEventListener('click', giveHint);
    } else {
      mid.innerHTML = `<div class="hardest-banner">&#128293; Unimpossible — no hints</div>`;
    }
    // toggle active states
    el('mode-possible').classList.toggle('active', S.assistMode);
    el('mode-unimpossible').classList.toggle('active', !S.assistMode);
    const lock = el('mode-lock');
    if (lock) lock.style.display = gameStarted() ? 'inline' : 'none';
    el('mode-possible').disabled = gameStarted();
    el('mode-unimpossible').disabled = gameStarted();
    el('toggle-wrap').classList.toggle('locked', gameStarted());
  }

  function updateHeader() {
    el('puzzle-number').textContent = S.puzzleNumber;
  }

  /* ---- 8. tap interaction (tap to select, tap to place) ------------------- */
  // Touch drag-and-drop fights the OS (scroll, text-selection, long-press), so
  // the game is tap-only on every device: tap a tile to pick it up, tap a lit
  // target to place it. Selecting costs nothing; only placing/returning costs
  // a move. This also teaches the rule — selecting shows exactly where a tile
  // is allowed to go.

  // Valid destinations for a grid tile at (row,col): its column's top/bottom
  // slots and its row's left/right slots, minus any already filled.
  function targetsForGridTile(row, col) {
    const t = [];
    if (!S.lanes.top[col]) t.push({ lane: 'top', idx: col });
    if (!S.lanes.bottom[col]) t.push({ lane: 'bottom', idx: col });
    if (!S.lanes.left[row]) t.push({ lane: 'left', idx: row });
    if (!S.lanes.right[row]) t.push({ lane: 'right', idx: row });
    return t;
  }

  function isTarget(lane, idx) {
    if (!S.selected || S.selected.source !== 'grid') return false;
    return S.selected.targets.some((t) => t.lane === lane && t.idx === idx);
  }

  // The exact slot a hint points at: the hint gives a grid tile + a direction,
  // and that pair determines one slot (column lanes use col, row lanes use row).
  function hintedSlot() {
    if (!S.highlight) return null;
    const lane = dirToLane(S.highlight.dir);
    const idx = (lane === 'top' || lane === 'bottom') ? S.highlight.col : S.highlight.row;
    return { lane, idx };
  }

  // True when the currently selected tile is the hinted one — in that case only
  // the hinted destination should shout; the other legal targets stay quiet.
  function selectedIsHinted() {
    return !!(S.selected && S.selected.source === 'grid' && S.highlight
      && S.selected.row === S.highlight.row && S.selected.col === S.highlight.col);
  }
  // When a lane tile is selected for return, its origin grid cell is the target.
  function isHomeTarget(row, col) {
    if (!S.selected || S.selected.source === 'grid') return false;
    return S.selected.home === `${row}-${col}`;
  }

  function clearSelection() {
    S.selected = null;
    render();
  }

  function tapGridTile(row, col) {
    // tapping the selected tile again deselects (free)
    if (S.selected && S.selected.source === 'grid' && S.selected.row === row && S.selected.col === col) {
      clearSelection();
      return;
    }
    // if a lane tile is selected and this is its home cell -> return it there
    if (S.selected && S.selected.source !== 'grid' && S.selected.home === `${row}-${col}`) {
      returnToGrid(row, col);
      return;
    }
    const letter = S.grid[row][col];
    if (!letter) return;
    S.selected = { source: 'grid', letter, row, col, targets: targetsForGridTile(row, col) };
    // NOTE: the hint is NOT cleared here. Tapping only selects — you may change
    // your mind. The hint you paid for survives until the tile is actually placed.
    render();
  }

  function tapLaneSlot(lane, idx) {
    // placing a selected grid tile into a lit target
    if (S.selected && S.selected.source === 'grid' && isTarget(lane, idx)) {
      placeIntoLane(lane, idx);
      return;
    }
    const letter = S.lanes[lane][idx];
    if (!letter) return;
    const key = `${lane}-${idx}`;
    if (S.anchorKey === key) return;            // locked free letter
    if (S.verified.has(key)) return;            // locked hinted letter — it's a
                                                // paid, guaranteed-correct tile;
                                                // taking it back only loses info
    // tapping the selected lane tile again deselects
    if (S.selected && S.selected.source === lane && S.selected.index === idx) {
      clearSelection();
      return;
    }
    // select this placed letter for return; its home cell becomes the target
    const home = S.moved.get(key);
    if (!home) return;
    S.selected = { source: lane, letter, index: idx, home };
    render();
  }

  function placeIntoLane(lane, idx) {
    const sel = S.selected;
    // Analytics: first letter placed = the player actually engaged (fires once).
    if (!S.startedTracked) { S.startedTracked = true; track('puzzle_started'); }
    S.lanes[lane][idx] = sel.letter;
    S.grid[sel.row][sel.col] = '';
    const key = `${lane}-${idx}`;
    S.moved.set(key, `${sel.row}-${sel.col}`);
    // If this tile was hint-revealed, the placement is game-verified.
    if (S.hintedCells.has(`${sel.row}-${sel.col}`)) S.verified.add(key);
    // The hint has now been acted on — clear it.
    if (S.highlight && S.highlight.row === sel.row && S.highlight.col === sel.col) S.highlight = null;
    S.selected = null;
    registerMove();
    if (S.assistMode) refundCorrectWords('each');   // live +6 per word in Possible
    checkWin();
    render();
    // Possible mode only: if this placement just COMPLETED the lane and the six
    // letters aren't a valid answer for that orientation, shake the lane side to
    // side — the human "no". Fires after render() so it lands on the fresh DOM.
    if (S.assistMode && !S.hasWon) maybeShakeWrongWord(lane);
  }

  // A horizontal lane is correct if its word is EITHER across-word; a vertical
  // lane if EITHER down-word (there is no "wrong lane" — the swap is allowed).
  function maybeShakeWrongWord(lane) {
    if (S.lanes[lane].some((c) => !c)) return;         // not full yet — no verdict
    const word = S.lanes[lane].join('');
    const isHoriz = (lane === 'top' || lane === 'bottom');
    const valid = isHoriz
      ? [S.words.topWord, S.words.bottomWord]
      : [S.words.leftWord, S.words.rightWord];
    if (valid.includes(word)) return;                  // it's a correct answer — no shake
    const container = el('lane-' + lane);
    if (!container) return;
    container.classList.remove('shake-no');            // restart if mid-animation
    void container.offsetWidth;                        // reflow so re-adding replays it
    container.classList.add('shake-no');
    setTimeout(() => container.classList.remove('shake-no'), 400);
  }

  function returnToGrid(row, col) {
    const sel = S.selected;
    const key = `${sel.source}-${sel.index}`;
    S.grid[row][col] = sel.letter;
    S.lanes[sel.source][sel.index] = '';
    S.moved.delete(key);
    S.verified.delete(key);
    S.selected = null;
    registerMove();
    render();
  }

  /* ---- 9. moves, win/loss, hints ----------------------------------------- */
  function registerMove() {
    S.moveCount++;
    S.score = Math.max(0, S.score - 1);
    if (S.score <= 0 && !S.hasWon) triggerLoss();
    saveGame();
  }

  const WORD_REFUND = 6;   // a correctly-built word gives back the 6 moves it cost

  // Credit +6 for each correctly-placed word not yet credited. In Possible mode
  // this runs live (words already light up when correct, so a "+6" popup fits and
  // leaks nothing). In Unimpossible we must NOT credit per-word — that would
  // reveal a word is right, which the mode deliberately hides — so there we only
  // call this at the win, when everything is revealed anyway.
  function refundCorrectWords(popupMode) {   // 'each' | 'lump' | 'none'
    if (!S.words) return;
    const all = [S.words.topWord, S.words.bottomWord, S.words.leftWord, S.words.rightWord];
    const horiz = [S.lanes.top.join(''), S.lanes.bottom.join('')];
    const vert = [S.lanes.left.join(''), S.lanes.right.join('')];
    const placed = new Set([...horiz, ...vert].filter(Boolean));
    let credited = 0;
    for (const word of all) {
      if (!S.refunded.has(word) && placed.has(word)) {
        S.refunded.add(word);
        S.score = Math.min(START_MOVES, S.score + WORD_REFUND);
        credited += WORD_REFUND;
        if (popupMode === 'each') flashRefund(WORD_REFUND);
      }
    }
    // 'lump' shows one combined popup for everything credited at once (the win
    // moment in Unimpossible, where per-word popups were suppressed during play).
    if (popupMode === 'lump' && credited > 0) flashRefund(credited);
    const sv = el('score-value');
    if (sv) sv.textContent = S.score;
  }

  // Brief "+6" celebration near the score.
  function flashRefund(pts) {
    const host = el('score-value');
    if (!host || !host.parentElement) return;
    const pop = document.createElement('span');
    pop.className = 'refund-pop';
    pop.textContent = '+' + pts;
    host.parentElement.appendChild(pop);
    setTimeout(() => { pop.remove(); }, 1400);
  }

  function checkWin() {
    if (!S.words) return;
    // Each orientation's two words must occupy its two lanes — each word used
    // exactly once, but in EITHER order. So the horizontal pair {top,bottom}
    // must equal the set of placed horizontal words, and likewise vertical.
    const horiz = [S.lanes.top.join(''), S.lanes.bottom.join('')].sort();
    const vert = [S.lanes.left.join(''), S.lanes.right.join('')].sort();
    const horizTargets = [S.words.topWord, S.words.bottomWord].sort();
    const vertTargets = [S.words.leftWord, S.words.rightWord].sort();
    const match = (a, b) => a[0] === b[0] && a[1] === b[1];
    if (match(horiz, horizTargets) && match(vert, vertTargets)) {
      S.hasWon = true;
      // Credit any words not yet refunded. In Unimpossible nothing was credited
      // during play (to keep it silent), so all four land here at once — no popup,
      // the win itself is the reveal. In Possible most are already credited.
      // win: credit whatever isn't yet credited, as one lump '+N' celebration
      // (in Unimpossible that's all four words at once; in Possible, any stragglers)
      refundCorrectWords('lump');
      recordStat(true);
      startCountdown();
      saveGame();          // persist the WIN — registerMove saved before this ran,
      track('puzzle_won', { score: S.score });   // score reflects the final refunded total
      showWinModal();      // so without this a reload restores the pre-win board
    }
  }

  function triggerLoss() {
    S.hasLost = true;
    recordStat(false);
    startCountdown();
    saveGame();            // persist the loss for the same reason
    track('puzzle_lost');
    showLossModal();
  }

  // Which lane is a given word currently being built in? Since the lane-swap
  // fix lets a horizontal word live in EITHER horizontal lane (and vertical in
  // either vertical lane), a hint must aim at the lane the player is actually
  // using — not the word's original "home" lane. Precedence:
  //   1. a lane already matches THIS word's letters (and not its partner's)
  //   2. else the partner word has claimed a lane -> use the other one
  //   3. else nothing committed -> fall back to the word's home lane
  // Returns { lane, isCol }.
  function laneForWord(which) {
    const home = { top: ['top', 'bottom', true], bottom: ['bottom', 'top', true],
                   left: ['left', 'right', false], right: ['right', 'left', false] }[which];
    const [homeLane, partnerLane, isCol] = home;
    const wordOf = (l) => ({ top: S.words.topWord, bottom: S.words.bottomWord,
                             left: S.words.leftWord, right: S.words.rightWord }[l]);
    const thisWord = wordOf(which);
    const partnerWord = wordOf(partnerLane);

    // Does a lane's placed letters agree with `word` so far (ignoring blanks)?
    const consistent = (laneArr, word) => {
      for (let i = 0; i < 6; i++) if (laneArr[i] && laneArr[i] !== word[i]) return false;
      return true;
    };
    const hasAny = (laneArr) => laneArr.some((x) => x);

    const a = S.lanes[homeLane], b = S.lanes[partnerLane];

    // 1. a lane that fits THIS word but not the partner word = committed to us
    const aFitsThis = hasAny(a) && consistent(a, thisWord);
    const aFitsPartnerOnly = hasAny(a) && consistent(a, partnerWord) && !consistent(a, thisWord);
    const bFitsThis = hasAny(b) && consistent(b, thisWord);
    const bFitsPartnerOnly = hasAny(b) && consistent(b, partnerWord) && !consistent(b, thisWord);

    if (aFitsThis && !consistent(a, partnerWord)) return { lane: homeLane, isCol };
    if (bFitsThis && !consistent(b, partnerWord)) return { lane: partnerLane, isCol };

    // 2. partner clearly owns a lane -> this word takes the other
    if (aFitsPartnerOnly) return { lane: partnerLane, isCol };
    if (bFitsPartnerOnly) return { lane: homeLane, isCol };

    // 2b. this word is started in exactly one lane (ambiguous letters) -> use it
    if (aFitsThis && !bFitsThis) return { lane: homeLane, isCol };
    if (bFitsThis && !aFitsThis) return { lane: partnerLane, isCol };

    // 3. nothing committed -> home lane
    return { lane: homeLane, isCol };
  }

  function giveHint() {
    if (!S.assistMode || S.hintsUsed >= MAX_HINTS) return;
    // Gather every correct letter that can still be validly placed: for each of
    // the four words, find its lane and collect grid tiles that fill a STILL-EMPTY
    // slot of that lane. A lane clogged with wrong guesses simply yields no
    // candidates and is skipped automatically — so the hint always lands on a
    // word that can actually be helped, rather than silently failing on a blocked
    // one. (There is no pre-built hint queue; each press picks live from the board.)
    const words = { top: S.words.topWord, bottom: S.words.bottomWord,
                    left: S.words.leftWord, right: S.words.rightWord };
    const byLane = {};
    for (const which of ['top', 'bottom', 'left', 'right']) {
      const { lane, isCol } = laneForWord(which);
      if (byLane[lane]) continue;                 // dedupe if two resolve to same lane
      const letters = words[which].split('');
      const pool = [];
      for (let i = 0; i < 6; i++) {
        if (S.lanes[lane][i]) continue;           // slot already filled (right OR wrong) -> skip
        const target = letters[i];
        for (let k = 0; k < 6; k++) {
          const r = isCol ? k : i, c = isCol ? i : k;
          if (S.grid[r][c] === target) pool.push({ row: r, col: c, dir: LANE[lane].dir });
        }
      }
      if (pool.length) byLane[lane] = pool;
    }

    const lanesWithOptions = Object.keys(byLane);
    if (!lanesWithOptions.length) {
      // Every correct word's lane is blocked by wrong guesses — no valid hint
      // exists right now. Don't charge the move; tell the player what to do.
      showHintBlockedMessage();
      return;
    }
    const lane = lanesWithOptions[Math.floor(Math.random() * lanesWithOptions.length)];
    const pool = byLane[lane];

    S.highlight = pool[Math.floor(Math.random() * pool.length)];
    S.hintedCells.add(`${S.highlight.row}-${S.highlight.col}`);
    S.hintsUsed++;
    S.score = Math.max(0, S.score - 1);
    if (S.score <= 0 && !S.hasWon) triggerLoss();
    render();
    saveGame();
  }

  // Shown when a hint can't help because wrong letters are filling the lanes.
  // Uses the hint note line under the button so it's seen right where you tapped.
  function showHintBlockedMessage() {
    const msg = document.getElementById('hint-msg');
    if (!msg) return;
    msg.textContent = 'Clear a wrong word first — no hint fits right now.';
    msg.style.display = 'block';
    setTimeout(() => { if (msg) { msg.style.display = 'none'; msg.textContent = ''; } }, 3600);
  }

  /* ---- 10. modals --------------------------------------------------------- */
  let activeModal = null;

  function openModal(name) { activeModal = name; renderModal(); }
  function closeModal() { activeModal = null; renderModal(); }

  function renderModal() {
    const overlay = el('modal-overlay');
    if (!activeModal) { overlay.style.display = 'none'; overlay.innerHTML = ''; return; }
    overlay.style.display = 'flex';
    let body = '';
    if (activeModal === 'help') body = helpBody();
    else if (activeModal === 'about') body = aboutBody();
    else if (activeModal === 'stats') body = statsBody();
    else if (activeModal === 'share') body = shareBody();
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-x rise" id="modal-x" aria-label="Close">&times;</button>
        ${body}
        <div class="modal-foot"><button class="btn-gotit rise" id="modal-gotit">Got it</button></div>
      </div>`;
    el('modal-x').addEventListener('click', closeModal);
    el('modal-gotit').addEventListener('click', closeModal);
    if (activeModal === 'share') el('copy-btn').addEventListener('click', copyShare);
  }

  function helpBody() {
    return `
      <h2 class="modal-title">How to play</h2>

      <div class="rules-h">The goal</div>
      <p>Four six-letter words are hidden in the grid — two read <strong>across</strong>, two read <strong>down</strong>. Their letters are scattered among the squares and mixed with decoys that belong to no word. Move the right letters out to the edges to spell all four, and you win.</p>

      <div class="rules-h">The two modes</div>
      <p><strong class="g">Possible</strong> — one correct letter starts locked in as a foothold, you get 5 hints, and a completed word gets a bold outline once it's correct. This is where you start.</p>
      <p><strong class="c">&#128293; Unimpossible</strong> — no free letter, no hints, no confirmation. Nothing is marked; you only find out you're right when you win. Pure deduction. Switch to it when you're ready for the real challenge.</p>
      <p class="muted">You can switch modes before your first move — after that, it's locked for the day.</p>

      <div class="rules-h">Placing a letter</div>
      <p>Tap a letter in the grid to pick it up — the squares it can legally move to light up. Tap a lit square to drop it there. Letters travel only along their own row or column, never diagonally.</p>

      <div class="rules-h">Taking a letter back</div>
      <p>Tap a letter you've already placed to lift it — its home square lights up — then tap that square to send it back. Or tap a letter you've just picked up a second time to set it down where it was, free.</p>

      <div class="rules-h">Across and down</div>
      <p>The two across words can sit in <em>either</em> the top or bottom edge, and the two down words in <em>either</em> the left or right edge. You just have to find each word and run it the right way — you never have to guess which side it belongs on.</p>

      <div class="rules-h">Score</div>
      <p>You start with <strong>100</strong>. Placing a letter, taking one back, or using a hint each costs a move. But every word you get right <strong>refunds the 6 moves it cost</strong> — so a flawless game scores a perfect <strong>100</strong>. Your remaining moves are your score; don't hit zero.</p>
      <p class="muted">In Possible mode the refund lands the moment a word is correct. In Unimpossible it all comes back at the win — the mode never tells you a word is right until you've won.</p>

      <div class="rules-h">Right and wrong</div>
      <p>In <strong class="g">Possible</strong> mode, a completed <em>correct</em> word gets a bold outline. Complete a word that isn't today's answer and its edge gives a quick side-to-side shake — a little &ldquo;no.&rdquo; <strong class="c">Unimpossible</strong> stays silent either way.</p>

      <div class="rules-h">Hints &amp; the free letter</div>
      <p>The <strong>free letter</strong> (Possible only) is one correct letter already placed for you — a way in, and it costs nothing. A <strong>hint</strong> reveals one correct letter and lights up its square; it's picked at random from anywhere on the board, so it won't always help the word you're stuck on. Each hint costs one move.</p>
      <p class="muted">The free letter and any hinted letters are locked in place — since they're guaranteed correct, you can't pick them back up.</p>
      <p class="muted">Because the free letter and hints appear in specific lanes, they settle which word belongs on which edge — and a hint can reveal that a word you've been building actually belongs on the opposite edge, so you may have to move your letters over.</p>

      <div class="rules-h">The words</div>
      <p>Everyday words — plurals and past tense are fair game, along with some slang and the occasional one you'll want to look up. No proper nouns, no swears.</p>

      <p class="muted">New puzzle every day at midnight.</p>`;
  }

  function aboutBody() {
    return `
      <h2 class="wordmark-sm"><span class="c">unim</span><span class="bone">possible</span></h2>
      <p class="muted"><span class="strike">unwinnable</span>, but not really.</p>
      <p>A daily word puzzle for people who like it hard. Four words hide around the edges of one shared grid, tangled together and buried in decoys. Move the correct letters into their lanes and solve all four.</p>
      <p>The name is a wink: <em>un-im-possible</em> — two negatives that cancel out. It looks unwinnable. It isn't. <strong>Probably the hardest word puzzle in the whole wide world.</strong></p>
      <p class="muted">Which Way To Words?&trade; &nbsp;<strong>#WW2W</strong></p>
      <p class="muted small">From the creator of <a href="https://directionary.net" target="_blank" rel="noopener">Directionary</a> and <a href="https://directionary.net/proTAB" target="_blank" rel="noopener">Directionary&nbsp;Pro</a>.</p>
      <div class="contact">
        <div class="contact-label">Contact &amp; bug reports</div>
        <img src="images/email-designasaur.png" alt="contact email" class="email-img">
      </div>
      <p class="muted small">Unimpossible is available for licensing or purchase.</p>
      <p class="muted small">&copy; 2025 Joel Pickard. All rights reserved.</p>`;
  }

  function statsBody() {
    const st = loadStats();
    return `
      <h2 class="modal-title">Your stats</h2>
      <div class="stats-grid">
        <div class="stat"><div class="stat-num">${st.played}</div><div class="stat-lbl">Played</div></div>
        <div class="stat"><div class="stat-num">${st.won}</div><div class="stat-lbl">Won</div></div>
        <div class="stat"><div class="stat-num">${st.streak}</div><div class="stat-lbl">Streak</div></div>
        <div class="stat"><div class="stat-num">${st.bestStreak}</div><div class="stat-lbl">Best streak</div></div>
        <div class="stat"><div class="stat-num">${st.best === null ? '—' : st.best}</div><div class="stat-lbl">Best score</div></div>
      </div>
      <p class="muted small">Stats are saved on this device only.</p>`;
  }

  function shareBody() {
    const text = buildShareText();
    return `
      <h2 class="modal-title">Share your result</h2>
      <div class="share-preview">${text.replace(/\n/g, '<br>')}</div>
      <div class="share-actions"><button id="copy-btn" class="btn-copy rise">&#128203; Copy result</button></div>
      <p class="muted small">Paste it anywhere — text, chat, or your favorite app.</p>`;
  }

  /* ---- share -------------------------------------------------------------- */
  function buildShareText() {
    const hintsEmoji = S.hintsUsed === 0 ? '\u2B50' : '\uD83D\uDCA1'.repeat(Math.min(S.hintsUsed, 5));
    const scoreEmoji = S.score >= 90 ? '\uD83C\uDFC6' : S.score >= 70 ? '\uD83E\uDD48' : S.score >= 50 ? '\uD83E\uDD49' : S.hasWon ? '\u2705' : '\u274C';
    const badge = S.assistMode ? ' — Possible mode' : ' — \uD83D\uDD25 Unimpossible mode';
    let line;
    if (S.hasWon) line = `${S.score}/100 ${scoreEmoji}\nHints: ${S.hintsUsed}/5 ${hintsEmoji}`;
    else if (S.hasLost) line = `DNF ${scoreEmoji}\nHints: ${S.hintsUsed}/5 ${hintsEmoji}`;
    else if (!gameStarted()) line = `not started yet`;   // don't show a phantom 100/100
    else line = `in progress — ${S.score}/100 so far\nHints: ${S.hintsUsed}/5 ${hintsEmoji}`;
    return `Unimpossible #${S.puzzleNumber}${badge}\n${line}\n\nunimpossiblegame.com #WW2W`;
  }

  function shareResult() {
    // Always use our own share modal, on every device. The native navigator.share
    // sheet is inconsistent — present on some browsers/devices and not others,
    // which made sharing behave differently for different players. Our modal is
    // consistent, branded, and the whole reason we built it. (The modal builds
    // its own share text when it renders.)
    openModal('share');
  }

  function copyShare() {
    const text = buildShareText();
    // Analytics: an actual copy = real intent to share (not just opening the
    // auto-shown modal). Tag with result so we can see who shares — winners,
    // losers, or mid-game. Fires per copy (someone may share more than once).
    const result = S.hasWon ? 'won' : S.hasLost ? 'lost' : 'in_progress';
    track('result_shared', { result: result });
    const btn = el('copy-btn');
    if (btn) { btn.textContent = '\u2713 Copied!'; btn.classList.add('copied'); setTimeout(() => { btn.innerHTML = '\uD83D\uDCCB Copy result'; btn.classList.remove('copied'); }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else { legacyCopy(text); }
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) { /* feedback already shown */ }
  }

  /* ---- win/loss modals ---------------------------------------------------- */
  function showWinModal() {
    const badge = S.assistMode ? `Hints Used: ${S.hintsUsed}/5 ${S.hintsUsed === 0 ? '\u2B50' : ''}` : '\uD83D\uDD25 Solved in Unimpossible Mode \uD83C\uDFC6';
    el('endgame').style.display = 'flex';
    el('endgame').innerHTML = `
      <div class="modal win">
        <button class="modal-x rise" id="win-x" aria-label="Close">&times;</button>
        <div class="big-emoji">\uD83C\uDF89</div>
        <div class="win-title"><span class="c">unim</span>possible — solved</div>
        <div class="muted">Daily Puzzle #${S.puzzleNumber}</div>
        <div class="final">Final Score: <span class="c big">${S.score}</span></div>
        <div class="muted">${badge}</div>
        <div class="modal-foot"><button class="btn-share rise" id="win-share">Share Result</button></div>
        <div class="muted small">Come back tomorrow for a new puzzle!</div>
      </div>`;
    el('win-x').addEventListener('click', () => { el('endgame').style.display = 'none'; });
    // step aside before opening share — same fixed layer, so it would cover it
    el('win-share').addEventListener('click', () => { el('endgame').style.display = 'none'; shareResult(); });
  }

  function showLossModal() {
    el('endgame').style.display = 'flex';
    el('endgame').innerHTML = `
      <div class="modal loss">
        <button class="modal-x rise" id="loss-x" aria-label="Close">&times;</button>
        <div class="big-emoji">\uD83D\uDE14</div>
        <div class="win-title">Out of Moves</div>
        <div class="muted">Unwinnable this time — but not really. Try again tomorrow.</div>
        <div class="answer">
          <div style="color:${LANE.top.soft}">&updownarrow; ${S.words.topWord} &nbsp;&amp;&nbsp; ${S.words.bottomWord}</div>
          <div style="color:${LANE.left.soft}">&leftrightarrow; ${S.words.leftWord} &nbsp;&amp;&nbsp; ${S.words.rightWord}</div>
        </div>
        <div class="modal-foot"><button class="btn-share rise" id="loss-share">Share Result</button></div>
        <div class="muted small">Come back tomorrow for a new puzzle!</div>
      </div>`;
    el('loss-x').addEventListener('click', () => { el('endgame').style.display = 'none'; });
    el('loss-share').addEventListener('click', () => { el('endgame').style.display = 'none'; shareResult(); });
  }

  /* ---- 11. stats + prefs (localStorage) ---------------------------------- */
  const LS = {
    mode: 'unimpossible.mode',
    stats: 'unimpossible.stats',
    lastPlayed: 'unimpossible.lastPlayedDay',
    game: 'unimpossible.gameState',
  };

  // ---- in-progress game save/restore ----
  // Keyed to the day, so a reload mid-game restores exactly where you were, but
  // a stale (previous-day) save is discarded in favour of today's fresh puzzle.
  function saveGame() {
    if (!S.dayKey || !S.words) return;
    try {
      localStorage.setItem(LS.game, JSON.stringify({
        dayKey: S.dayKey,
        words: S.words,               // save the puzzle's words so restore can't
        anchorChoice: S.anchorChoice, // desync from the grid (e.g. after a word-
        pristineGrid: S.pristineGrid, // list swap, which reseeds to a new puzzle)
        grid: S.grid,
        lanes: S.lanes,
        moved: [...S.moved.entries()],
        verified: [...S.verified],
        hintedCells: [...S.hintedCells],
        refunded: [...S.refunded],
        anchorKey: S.anchorKey,
        score: S.score,
        moveCount: S.moveCount,
        hintsUsed: S.hintsUsed,
        hasWon: S.hasWon,
        hasLost: S.hasLost,
        assistMode: S.assistMode,
      }));
    } catch (e) {}
  }

  function restoreGame() {
    try {
      const raw = localStorage.getItem(LS.game);
      if (!raw) return false;
      const g = JSON.parse(raw);
      if (!g || g.dayKey !== S.dayKey) return false;   // stale day -> ignore
      // Saves written before the puzzle identity was stored can't be trusted to
      // match the freshly generated S.words (a word-list change makes the same
      // seed yield a different puzzle). Discard them and start fresh rather than
      // show a board whose answers/anchor/hints don't match.
      if (!g.words) { localStorage.removeItem(LS.game); return false; }
      S.words = g.words;
      if (g.anchorChoice) S.anchorChoice = g.anchorChoice;
      if (g.pristineGrid) S.pristineGrid = g.pristineGrid;
      S.grid = g.grid;
      S.lanes = g.lanes;
      S.moved = new Map(g.moved);
      S.verified = new Set(g.verified || []);
      S.hintedCells = new Set(g.hintedCells || []);
      S.refunded = new Set(g.refunded || []);
      S.anchorKey = g.anchorKey;
      S.score = g.score;
      S.moveCount = g.moveCount;
      S.hintsUsed = g.hintsUsed;
      S.hasWon = g.hasWon;
      S.hasLost = g.hasLost;
      S.assistMode = g.assistMode;
      S.startedTracked = (g.moveCount > 0) || g.hasWon || g.hasLost;  // don't re-fire puzzle_started on restore
      S.selected = null;
      S.highlight = null;
      render();
      // a finished game restored on reload should resume its countdown
      if (isGameOver()) startCountdown();
      return true;
    } catch (e) { return false; }
  }

  function saveMode(assist) { try { localStorage.setItem(LS.mode, assist ? 'possible' : 'unimpossible'); } catch (e) {} }
  function loadMode() {
    try { const v = localStorage.getItem(LS.mode); if (v === 'possible') return true; if (v === 'unimpossible') return false; } catch (e) {}
    return true; // first-run default: Possible (gentler on-ramp; newcomers get feedback)
  }
  function loadStats() {
    try { const s = JSON.parse(localStorage.getItem(LS.stats)); if (s) return s; } catch (e) {}
    return { played: 0, won: 0, streak: 0, bestStreak: 0, best: null };
  }
  function recordStat(won) {
    // only record once per day
    let last;
    try { last = localStorage.getItem(LS.lastPlayed); } catch (e) {}
    if (last === S.dayKey) return;
    const st = loadStats();
    st.played++;
    if (won) {
      st.won++;
      st.streak++;
      if (st.streak > st.bestStreak) st.bestStreak = st.streak;
      if (st.best === null || S.score > st.best) st.best = S.score;
    } else {
      st.streak = 0;
    }
    try {
      localStorage.setItem(LS.stats, JSON.stringify(st));
      localStorage.setItem(LS.lastPlayed, S.dayKey);
    } catch (e) {}
  }

  /* ---- 12. boot + daily rollover ----------------------------------------- */
  function wireStaticButtons() {
    el('mode-possible').addEventListener('click', () => { if (!gameStarted()) applyModeAnchor(true); });
    el('mode-unimpossible').addEventListener('click', () => { if (!gameStarted()) applyModeAnchor(false); });
    el('help-pill').addEventListener('click', () => openModal('help'));
    el('foot-share').addEventListener('click', shareResult);
    el('foot-stats').addEventListener('click', () => openModal('stats'));
    el('foot-about').addEventListener('click', () => openModal('about'));
    el('foot-help').addEventListener('click', () => openModal('help'));
    el('panel-share').addEventListener('click', shareResult);

    // tap interaction (works for mouse click and touch tap alike)
    document.addEventListener('click', (e) => {
      const gt = e.target.closest('.grid-tile');
      const cell = e.target.closest('.cell');
      const slot = e.target.closest('.slot');
      if (gt) { tapGridTile(+gt.dataset.row, +gt.dataset.col); return; }
      if (slot) { tapLaneSlot(slot.dataset.lane, +slot.dataset.idx); return; }
      if (cell) { tapGridTile(+cell.dataset.row, +cell.dataset.col); return; }
      // tapping the board background clears any selection (free)
      if (S.selected && !e.target.closest('.panel') && !e.target.closest('.footer')) clearSelection();
    });

    // Escape closes modals; Shift+N loads a fresh random puzzle.
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (e.key === 'Escape') { if (activeModal) closeModal(); if (el('endgame').style.display === 'flex') el('endgame').style.display = 'none'; return; }
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (activeModal) return;
      if (e.shiftKey && (e.key === 'N' || e.key === 'n')) { e.preventDefault(); loadRandomPuzzle(); }
      if (e.shiftKey && (e.key === 'T' || e.key === 't')) { e.preventDefault(); toggleCountdownPreview(); }
    });

    // click-off to close footer modals
    el('modal-overlay').addEventListener('click', (e) => { if (e.target === el('modal-overlay')) closeModal(); });
    el('endgame').addEventListener('click', (e) => { if (e.target === el('endgame')) el('endgame').style.display = 'none'; });
  }

  // Daily rollover: check periodically; only reload on a genuine day change AND
  // when no game is in progress. Single getTodayKey() source prevents the
  // Directionary reload loop.
  function startRolloverWatch() {
    setInterval(() => {
      const today = getTodayKey();
      if (today !== S.dayKey && !gameStarted() && !S.hasWon && !S.hasLost) {
        loadDailyPuzzle();
      }
    }, 30000);
  }

  async function boot() {
    // load word bank
    try {
      const res = await fetch('game/words.json');
      const data = await res.json();
      WORD_BANK = data.words;
    } catch (e) {
      console.error('Could not load words.json', e);
      el('grid').innerHTML = '<div style="color:var(--bone);padding:20px">Could not load word list.</div>';
      return;
    }
    S.assistMode = loadMode();       // returning player's saved mode; first-timers get Possible
    wireStaticButtons();
    loadDailyPuzzle();
    startRolloverWatch();
  }

  document.addEventListener('DOMContentLoaded', boot);

  // Minimal dev bridge (optional; remove dev.js + the dev panel for production).
  window.UNIMP_DEV = {
    loadRandom: loadRandomPuzzle,
    generate: generatePuzzle,
    isTrapFree: isTrapFree,
    validateWinnable: validateWinnable,
    getWords: () => S.words,
    getPuzzleNumber: () => S.puzzleNumber,
    // dev.js registers a function here; it fires after ANY puzzle load
    // (daily, dev button, or Shift+N) so the panel can refresh itself.
    onPuzzleLoad: null,
  };
})();
