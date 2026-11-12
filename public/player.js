/* Player screen: join with a funny name, then guess prices on your own device. */
(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io();
  const STORE = 'hcay-player';

  const FIRST = ['Captain', 'Sir', 'Lady', 'Professor', 'Doctor', 'Big', 'Lil', 'Sneaky', 'Thrifty', 'Budget', 'Discount', 'Clearance', 'Cashback', 'Frugal', 'Bargain'];
  const LAST = ['Coupon', 'Penny Pincher', 'Doorbuster', 'Price Tag', 'Cart Goblin', 'Sale Shark', 'Receipt', 'Wallet Hugger', 'Half Off', 'Markdown', 'Clipper', 'Layaway', 'Bin Diver', 'BOGO', 'Rebate'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  let session = load();
  let state = null;
  let renderedKey = '';
  let countdown = null;
  let editing = null; // round number the player is re-guessing, if any

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
  }
  function save(v) {
    try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch { /* private mode */ }
  }

  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('room') || '').toUpperCase();
  $('code').value = urlCode || session?.code || '';
  $('name').value = '';

  function showJoin(error = '') {
    $('join').hidden = false;
    $('game').hidden = true;
    $('joinError').textContent = error;
    ($('code').value ? $('name') : $('code')).focus();
  }

  function join() {
    const code = $('code').value.trim().toUpperCase();
    const name = $('name').value.trim();
    if (code.length !== 4) return showJoin('Room codes are 4 letters.');
    if (!name) return showJoin('Pick a funny name first.');
    $('joinBtn').disabled = true;
    socket.emit('player:join', { code, name }, (res) => {
      $('joinBtn').disabled = false;
      if (res.error) return showJoin(res.error);
      session = { code: res.code, playerId: res.playerId };
      save(session);
    });
  }

  function rejoin() {
    if (!session || (urlCode && urlCode !== session.code)) return showJoin();
    socket.emit('player:join', session, (res) => {
      if (res.error) { save(null); session = null; showJoin(); }
    });
  }

  $('joinBtn').addEventListener('click', join);
  $('name').addEventListener('keydown', (e) => e.key === 'Enter' && join());
  $('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('name').focus());
  $('code').addEventListener('input', () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('randomName').addEventListener('click', () => { $('name').value = `${pick(FIRST)} ${pick(LAST)}`; });

  socket.on('connect', () => (session ? rejoin() : showJoin()));
  socket.on('player:kicked', () => {
    save(null); session = null; state = null; renderedKey = '';
    showJoin('That game is over. Thanks for shopping!');
  });
  socket.on('player:state', (s) => {
    state = s;
    $('join').hidden = true;
    $('game').hidden = false;
    $('meName').textContent = s.name;
    $('meScore').textContent = s.score;
    render();
  });

  const money = (n) => {
    const v = Number(n);
    const digits = Number.isInteger(v) ? 0 : 2;
    return `${esc(state.currency)}${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
  };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function render() {
    const s = state;
    // Don't wipe the input while someone is typing; only redraw when something meaningful changed.
    if (editing !== null && (s.phase !== 'guessing' || s.round?.number !== editing)) editing = null;
    const key = [s.phase, s.round?.number, s.myGuess, s.score, s.rank, editing].join('|');
    if (key === renderedKey) return;
    renderedKey = key;
    clearInterval(countdown);
    const view = $('view');

    if (s.phase === 'lobby') {
      view.innerHTML = `
        <div class="center stack">
          <div class="big-number">You're in!</div>
          <p class="muted">Look at the host's screen. The first item drops soon.</p>
        </div>`;
      return;
    }

    const r = s.round;
    const label = r.bonus ? `⭐ Bonus round` : `Round ${r.number} of ${r.total}`;
    if (s.phase === 'guessing') {
      const rule = r.ceiling === null
        ? '<p style="margin:0"><b>No ceiling!</b> Highest guess wins.</p>'
        : `<p style="margin:0">Ceiling <span class="price">${money(r.ceiling)}</span></p>
           <p class="muted small" style="margin:0">Go as high as you dare. Over the ceiling and you're disqualified.</p>`;
      const header = `
        <div class="row spread"><span class="chip">${label}</span><span class="chip" id="timer" hidden></span></div>
        <img class="round-img" src="${r.image}" alt="">
        ${r.title ? `<h2 style="margin:0">${esc(r.title)}</h2>` : ''}
        ${rule}`;
      if (s.myGuess !== null && editing === null) {
        view.innerHTML = `${header}
          <div class="center stack">
            <div class="muted">Your guess is locked in</div>
            <div class="big-number">${money(s.myGuess)}</div>
            ${r.ceiling !== null && s.myGuess > r.ceiling ? '<p class="over-warn">That\'s over the ceiling. You will be disqualified!</p>' : ''}
            <button id="change" class="btn" type="button">Change my guess</button>
          </div>`;
        $('change').onclick = () => { editing = r.number; render(); };
      } else {
        view.innerHTML = `${header}
          <div>
            <label for="guess">Your guess (${esc(s.currency)})</label>
            <input id="guess" class="guess-input" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0">
            <p id="overWarn" class="over-warn"></p>
          </div>
          <button id="send" class="btn primary big block" type="button">Lock it in</button>
          <p id="guessError" class="error"></p>`;
        const send = () => {
          const amount = $('guess').value;
          if (amount === '') return ($('guessError').textContent = 'Type a price.');
          socket.emit('player:guess', { amount }, (res) => {
            if (res.error) return ($('guessError').textContent = res.error);
            editing = null;
            render();
          });
        };
        $('send').onclick = send;
        $('guess').addEventListener('keydown', (e) => e.key === 'Enter' && send());
        $('guess').addEventListener('input', () => {
          const over = r.ceiling !== null && Number($('guess').value) > r.ceiling;
          $('overWarn').textContent = over ? 'Careful! That is over the ceiling and will be disqualified.' : '';
        });
        $('guess').focus();
      }
      if (s.remainingMs !== null) startTimer(Date.now() + s.remainingMs);
      return;
    }

    // reveal, leaderboard, final
    const won = s.pointsThisRound;
    const final = s.phase === 'final';
    let line, verdict;
    if (s.myGuess === null) {
      line = "You didn't guess this round.";
      verdict = 'No points this time.';
    } else if (s.disqualified) {
      line = `You guessed ${money(s.myGuess)}, over the ${money(r.ceiling)} ceiling.`;
      verdict = '💥 Disqualified! Too rich for this sale.';
    } else {
      line = `You guessed ${money(s.myGuess)}.`;
      verdict = won === 2 ? 'Highest without going over! Big spender.' : won === 1 ? 'Second highest. Not bad.' : 'Too cheap! Someone went higher.';
    }
    view.innerHTML = `
      <div class="center stack">
        <span class="chip">${label}</span>
        <p style="margin:0">${line}</p>
        <div class="points-pop">${won ? `+${won}` : '+0'}</div>
        <p class="muted" style="margin:0">${verdict}</p>
        ${s.winner ? `<p class="small" style="margin:0">Round winner: <b>${esc(s.winner.name)}</b> with ${money(s.winner.amount)}</p>` : ''}
        <p style="margin:0">You're <b>#${s.rank}</b> of ${s.playerCount} with <b>${s.score}</b> points.</p>
        ${final ? '<div class="big-number" style="color:var(--yellow)">Game over!</div><p class="muted">Check the host\'s screen for the podium.</p>' : '<p class="muted">Next item coming up…</p>'}
      </div>`;
  }

  function startTimer(deadline) {
    const tick = () => {
      const el = $('timer');
      if (!el) return clearInterval(countdown);
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      el.hidden = false;
      el.textContent = `⏱ ${left}s`;
    };
    tick();
    countdown = setInterval(tick, 250);
  }
})();
