/* Optional dev panel — remove this file and the dev markup for production.
   Uses the window.UNIMP_DEV bridge exposed by game.js. */
(() => {
  const el = (id) => document.getElementById(id);
  const toggle = el('dev-toggle');
  if (!toggle) return;

  // ---- secret unlock: 3 quick taps/clicks on "Daily Puzzle" ----
  // Works the same by touch or mouse. Taps must land within 1.5s of each other
  // so an ordinary stray tap never accumulates. Unlocking reveals the Dev Panel
  // button; unlocking again hides the button AND collapses the panel, so it
  // fully disappears for sharing a clean link to beta testers.
  const unlock = el('dev-unlock');
  if (unlock) {
    let taps = 0, timer = null;
    const bump = (e) => {
      e.preventDefault();
      taps++;
      clearTimeout(timer);
      timer = setTimeout(() => { taps = 0; }, 1500);
      if (taps >= 3) {
        taps = 0;
        clearTimeout(timer);
        const nowHidden = !toggle.hidden;   // about to hide?
        toggle.hidden = nowHidden;
        if (nowHidden) el('dev-panel').classList.remove('open');
      }
    };
    unlock.addEventListener('click', bump);
    unlock.style.cursor = 'default';        // don't hint that it's tappable
    unlock.style.userSelect = 'none';       // avoid selecting the text on rapid taps
  }

  toggle.addEventListener('click', () => {
    el('dev-panel').classList.toggle('open');
  });

  el('dev-new').addEventListener('click', () => {
    window.UNIMP_DEV.loadRandom();
    el('dev-result').textContent = 'Loaded a fresh random puzzle.';
  });

  // ---- show / hide the four answer words ----
  let answersShown = false;

  function renderAnswers() {
    const w = window.UNIMP_DEV.getWords();
    const out = el('dev-answers-out');
    if (!w) { out.textContent = 'no puzzle loaded'; return; }
    // Group by ORIENTATION, not fixed lane. Since the lane-swap fix, a horizontal
    // word can occupy either the top OR bottom lane (and vertical either left or
    // right), and the free letter / hints follow the player — so labelling a word
    // "UP" would be a lie the game itself doesn't honour. Each pair is "either
    // word, either lane of that orientation".
    out.innerHTML =
      `<div style="color:#F7B25E">&harr; ACROSS &nbsp; ${w.topWord} &middot; ${w.bottomWord}</div>` +
      `<div style="color:#7FB0F5">&varr; DOWN &nbsp; ${w.leftWord} &middot; ${w.rightWord}</div>`;
  }

  // Fires after ANY puzzle load — the dev button, Shift+N, or the daily load —
  // so the shown answers can never go stale.
  window.UNIMP_DEV.onPuzzleLoad = () => {
    if (answersShown) renderAnswers();
  };

  el('dev-answers').addEventListener('click', () => {
    answersShown = !answersShown;
    el('dev-answers').textContent = answersShown ? 'Hide Answers' : 'Show Answers';
    if (answersShown) renderAnswers();
    else el('dev-answers-out').innerHTML = '';
  });

  el('dev-test').addEventListener('click', () => {
    const btn = el('dev-test');
    if (btn.dataset.running === '1') return;   // ignore double-clicks while running
    btn.dataset.running = '1';
    const N = 20;
    const DEADLINE = Date.now() + 8000;   // hard 8s budget — never hang the page
    let win = 0, trap = 0, bad = 0, i = 0;
    el('dev-result').textContent = 'Testing… 0/' + N;

    // One puzzle per tick so the page stays responsive, AND a wall-clock cap so a
    // rare pathological word-combo (which can make one generate() grind through
    // all its retries) can't freeze the tab. If time runs out we report what we
    // finished rather than spinning forever.
    function step() {
      if (i >= N || Date.now() > DEADLINE) {
        const done = i;
        const note = i < N ? `\n(stopped at ${done}/${N} — 8s cap)` : '';
        el('dev-result').textContent =
          `Winnable: ${win}/${done}\nTrap-free: ${trap}/${done}\nProblems: ${bad}${note}`;
        btn.dataset.running = '0';
        return;
      }
      const p = window.UNIMP_DEV.generate();
      if (!p) {
        bad++;
      } else {
        const T = p.words.topWord.split(''), L = p.words.leftWord.split('');
        const B = p.words.bottomWord.split(''), R = p.words.rightWord.split('');
        if (window.UNIMP_DEV.validateWinnable(p.grid, T, L, B, R)) win++;
        if (window.UNIMP_DEV.isTrapFree(p.grid, T, L, B, R)) trap++; else bad++;
      }
      i++;
      el('dev-result').textContent = `Testing… ${i}/${N}`;
      setTimeout(step, 0);
    }
    setTimeout(step, 0);
  });
})();
