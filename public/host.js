/* Host screen: set up 7 rounds, then run the game on your shared screen. */
(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io();
  const ROUNDS = 7;
  const SESSION = 'hcay-host';

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------------- Saved setup (IndexedDB, because images are too big for localStorage) ----------------
  const db = {
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('how-cheap-are-you', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async get(key) {
      try {
        const d = await this.open();
        return await new Promise((res) => {
          const r = d.transaction('kv').objectStore('kv').get(key);
          r.onsuccess = () => res(r.result);
          r.onerror = () => res(undefined);
        });
      } catch { return undefined; }
    },
    async set(key, value) {
      try {
        const d = await this.open();
        d.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
      } catch { /* storage blocked; the game still works, it just won't remember */ }
    },
  };

  const BONUS = ROUNDS - 1; // round 7 is the bonus round, with no ceiling
  const SETUP_KEY = 'setup-v2';
  const blankRound = () => ({ image: '', title: '', ceiling: '' });
  const DEFAULT_ROUNDS = [
    { image: '/img/arrabbiata.svg', title: 'A plate of Arrabbiata in a normally priced restaurant', ceiling: '30' },
    { image: '/img/concert-ticket.svg', title: 'A ticket to a Backstreet Boys concert', ceiling: '500' },
    { image: '/img/private-jet.svg', title: 'A private jet', ceiling: '4000000' },
    { image: '/img/rusty-bike.svg', title: "Emmanuelle's old rusty bike", ceiling: '30' },
    { image: '/img/flight-ticket.svg', title: 'A round-trip flight between Saudi Arabia and Germany', ceiling: '2000' },
    { image: '/img/video-game.svg', title: 'GTA V', ceiling: '200' },
    { image: '/img/spy-date.svg', title: 'The tip you leave after a date with a Chinese spy in a fancy restaurant', ceiling: '' },
  ];
  const defaultSetup = () => ({ currency: '€', rounds: DEFAULT_ROUNDS.map((r) => ({ ...r })) });
  let setup = defaultSetup();

  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => db.set(SETUP_KEY, setup), 300);
  }

  function normalise(data) {
    const rounds = Array.from({ length: ROUNDS }, (_, i) => ({ ...blankRound(), ...(data?.rounds?.[i] || {}) }));
    return { currency: data?.currency || '€', rounds };
  }

  // Shrink photos so a game with 7 phone pictures stays small and loads fast for everyone.
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Not an image'));
        img.onload = () => {
          const MAX = 1200;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderSetup() {
    $('currency').value = setup.currency;
    const cur = esc(setup.currency);
    $('slots').innerHTML = setup.rounds.map((r, i) => `
      <div class="panel slot" data-i="${i}">
        <h3>${i === BONUS ? 'Bonus round ⭐' : `Round ${i + 1}`}</h3>
        <div class="drop ${r.image ? 'has' : ''}" tabindex="0" role="button" aria-label="Choose image for round ${i + 1}">
          ${r.image ? `<img src="${r.image}" alt="">` : '<span>Drop an image here<br>or click to choose</span>'}
        </div>
        <input type="file" accept="image/*" hidden>
        <div style="margin-top:10px">
          <label>What is it?</label>
          <input type="text" data-k="title" maxlength="120" value="${esc(r.title)}" placeholder="Dave's emotional support mug">
        </div>
        <div style="margin-top:10px">
          ${i === BONUS
            ? '<p class="muted small" style="margin:6px 0 0">No ceiling. The highest guess wins.</p>'
            : `<label class="ceil-label">Ceiling price (${cur})</label><input type="number" data-k="ceiling" min="0" step="0.01" value="${esc(r.ceiling)}" placeholder="100">`}
        </div>
      </div>`).join('');

    $('slots').querySelectorAll('.slot').forEach((slot) => {
      const i = Number(slot.dataset.i);
      const drop = slot.querySelector('.drop');
      const file = slot.querySelector('input[type=file]');
      const setImage = async (f) => {
        if (!f) return;
        try {
          setup.rounds[i].image = await shrinkImage(f);
          persist();
          renderSetup();
        } catch {
          $('setupError').textContent = `Round ${i + 1}: that file isn't an image I can read.`;
        }
      };
      drop.addEventListener('click', () => file.click());
      drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && file.click());
      file.addEventListener('change', () => setImage(file.files[0]));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); setImage(e.dataTransfer.files[0]); });
      slot.querySelectorAll('input[data-k]').forEach((input) => {
        input.addEventListener('input', () => {
          setup.rounds[i][input.dataset.k] = input.value;
          slot.classList.remove('bad');
          persist();
        });
      });
    });
  }

  $('currency').addEventListener('input', () => {
    setup.currency = $('currency').value || '$';
    persist();
    document.querySelectorAll('.ceil-label').forEach((l) => (l.textContent = `Ceiling price (${setup.currency})`));
  });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Replace all 7 rounds with the default items?')) return;
    setup = defaultSetup();
    persist();
    renderSetup();
  });

  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(setup)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'how-cheap-are-you-game.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      setup = normalise(JSON.parse(await f.text()));
      persist();
      renderSetup();
      $('setupError').textContent = '';
    } catch {
      $('setupError').textContent = "That doesn't look like a saved game file.";
    }
    e.target.value = '';
  });

  function checkSetup() {
    document.querySelectorAll('.slot').forEach((s) => s.classList.remove('bad'));
    for (let i = 0; i < ROUNDS; i++) {
      const r = setup.rounds[i];
      const c = Number(r.ceiling);
      let msg = '';
      if (!r.image) msg = 'needs an image';
      else if (i !== BONUS && (r.ceiling === '' || !(c > 0))) msg = 'needs a ceiling price';
      if (msg) {
        const slot = document.querySelector(`.slot[data-i="${i}"]`);
        slot.classList.add('bad');
        slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return `Round ${i + 1} ${msg}.`;
      }
    }
    return '';
  }

  $('openLobby').addEventListener('click', () => {
    const err = checkSetup();
    $('setupError').textContent = err;
    if (err) return;
    $('openLobby').disabled = true;
    // Bundled pictures are sent as full URLs so they also work on players' phones.
    const rounds = setup.rounds.map((r, i) => ({
      image: r.image.startsWith('/') ? location.origin + r.image : r.image,
      title: r.title.trim(),
      ceiling: i === BONUS ? null : Number(r.ceiling),
    }));
    socket.emit('host:create', { rounds, currency: setup.currency }, (res) => {
      $('openLobby').disabled = false;
      if (res.error) return ($('setupError').textContent = res.error);
      session = { code: res.code, hostKey: res.hostKey };
      window.track?.('game-started');
      try { sessionStorage.setItem(SESSION, JSON.stringify(session)); } catch {}
    });
  });

  // ---------------- Live game ----------------
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION)); } catch {}
  let state = null;
  let lastKey = '';
  let countdown;

  const send = (event, extra = {}) => socket.emit(event, { ...session, ...extra });
  const money = (n) => {
    const v = Number(n);
    const digits = Number.isInteger(v) ? 0 : 2;
    return `${esc(state.currency)}${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
  };
  const joinUrl = () => `${location.origin}/?room=${state.code}`;

  function showSetup() {
    $('live').hidden = true;
    $('setup').hidden = false;
    renderSetup();
  }

  socket.on('connect', () => {
    if (!session) return showSetup();
    socket.emit('host:resume', session, (res) => {
      if (res.error) {
        session = null;
        try { sessionStorage.removeItem(SESSION); } catch {}
        showSetup();
      }
    });
  });

  socket.on('host:state', (s) => {
    state = s;
    $('setup').hidden = true;
    $('live').hidden = false;
    $('codeSmall').textContent = s.code;
    $('joinHost').textContent = location.host;
    renderLive();
  });

  $('endBtn').addEventListener('click', () => {
    if (!confirm('End this game for everyone? Scores will be lost.')) return;
    send('host:end');
    session = null;
    state = null;
    try { sessionStorage.removeItem(SESSION); } catch {}
    showSetup();
  });

  const seenPills = new Set();
  function namePills(players, guessed, removable) {
    if (!players.length) return '<p class="muted">Nobody yet. Paste the link in the meeting chat!</p>';
    return `<div class="names">${players.map((p) => `
      <span class="name-pill ${guessed?.includes(p.id) ? 'done' : ''} ${p.online ? '' : 'off'} ${pop(p.id + (guessed?.includes(p.id) ? ':g' : ''))}">
        ${guessed?.includes(p.id) ? '✅' : ''}${esc(p.name)}
        ${removable ? `<button class="x" data-kick="${p.id}" title="Remove ${esc(p.name)}">✕</button>` : ''}
      </span>`).join('')}</div>`;
  }

  // Only animate a pill the first time it appears, not on every update.
  function pop(key) {
    if (seenPills.has(key)) return '';
    seenPills.add(key);
    return 'new';
  }

  function wireKicks() {
    document.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', () => {
      const p = state.players.find((x) => x.id === b.dataset.kick);
      if (p && confirm(`Remove ${p.name} from the game?`)) send('host:kick', { playerId: p.id });
    }));
  }

  function renderLive() {
    const s = state;
    const key = [s.phase, s.round?.number].join('|');
    const phaseChanged = key !== lastKey;
    lastKey = key;
    const screen = $('screen');
    $('joinHint').hidden = false;

    if (s.phase === 'lobby') {
      screen.innerHTML = `
        <div class="lobby">
          <div class="panel stack">
            <div class="muted">Grab your phone and go to</div>
            <div class="join-url">${esc(location.host)}</div>
            <div class="muted">and enter the code</div>
            <div class="join-code">${s.code}</div>
            <div class="row">
              <button id="copyLink" class="btn" type="button">Copy invite link</button>
              <span id="copied" class="muted small"></span>
            </div>
          </div>
          <div class="panel stack">
            <div class="row spread"><div class="counter">${s.players.length} shopper${s.players.length === 1 ? '' : 's'} in line</div></div>
            ${namePills(s.players, null, true)}
          </div>
        </div>
        <div class="controls">
          <button id="go" class="btn primary big" type="button" ${s.players.length ? '' : 'disabled'}>Start round 1</button>
        </div>`;
      $('copyLink').onclick = async () => {
        try { await navigator.clipboard.writeText(joinUrl()); $('copied').textContent = 'Copied! Paste it in the meeting chat.'; }
        catch { $('copied').textContent = joinUrl(); }
      };
      $('go').onclick = () => send('host:startRound');
      wireKicks();
      return;
    }

    const r = s.round;

    if (s.phase === 'guessing') {
      if (phaseChanged || !$('guessNames')) {
        screen.innerHTML = `
          <div class="stage">
            <img class="stage-img" src="${r.image}" alt="">
            <div class="stack">
              <div class="round-label">${roundLabel(r)}</div>
              <div class="item-title">${r.title ? esc(r.title) : 'What does this cost?'}</div>
              ${ceilingLine(r)}
              <div class="timer" id="timer" hidden></div>
              <div class="counter" id="guessCount"></div>
              <div id="guessNames"></div>
              <button id="lock" class="btn primary big" type="button">Lock guesses &amp; reveal</button>
            </div>
          </div>`;
        $('lock').onclick = () => send('host:lock');
        clearInterval(countdown);
        if (s.remainingMs !== null) {
          const deadline = Date.now() + s.remainingMs;
          const tick = () => {
            const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            const el = $('timer');
            if (!el) return clearInterval(countdown);
            el.hidden = false;
            el.textContent = `${left}s`;
            el.classList.toggle('hurry', left <= 10);
          };
          tick();
          countdown = setInterval(tick, 250);
        }
      }
      const total = s.players.length;
      $('guessCount').textContent = `${s.guessedIds.length} of ${total} guessed`;
      $('guessNames').innerHTML = namePills(s.players, s.guessedIds, false);
      return;
    }
    clearInterval(countdown);

    if (s.phase === 'reveal') {
      const last = r.number === r.total;
      const rows = s.results.length ? s.results.map((g, i) => `
        <li class="${g.points === 2 ? 'win1' : g.points === 1 ? 'win2' : ''} ${g.disqualified ? 'bust' : ''}">
          <span class="pos">${g.disqualified ? '✕' : i + 1}</span>
          <span class="who">${esc(g.name)}</span>
          <span><b>${money(g.amount)}</b>${g.disqualified ? ' <span class="dq">OVER · DISQUALIFIED</span>' : ''}</span>
          <span class="pts">${g.points ? `+${g.points}` : ''}</span>
        </li>`).join('') : '<p class="muted">Nobody guessed. Bold strategy.</p>';
      const winner = s.results[0] && !s.results[0].disqualified ? s.results[0] : null;
      screen.innerHTML = `
        <div class="stage">
          <img class="stage-img" src="${r.image}" alt="">
          <div class="stack">
            <div class="round-label">${roundLabel(r)} · the guesses are in</div>
            ${r.title ? `<div class="item-title" style="margin:0">${esc(r.title)}</div>` : ''}
            ${ceilingLine(r)}
            ${winner
              ? `<div class="winner-line">🏆 <b>${esc(winner.name)}</b> went highest${r.hasCeiling ? ' without going over' : ''}</div><div><span class="price answer-reveal">${money(winner.amount)}</span></div>`
              : `<div class="winner-line">${s.results.length ? '💥 Everyone went over the ceiling. Nobody scores!' : ''}</div>`}
            <ul class="results">${rows}</ul>
          </div>
        </div>
        <div class="controls">
          <button id="board" class="btn primary big" type="button">${last ? 'Final results 🏆' : 'Show leaderboard'}</button>
        </div>`;
      $('board').onclick = () => send('host:showLeaderboard');
      if (phaseChanged) window.track?.('round-played', `${s.players.length} players`);
      if (phaseChanged && winner) burst(40);
      return;
    }

    const board = s.players.map((p, i) => `
      <li class="r${i + 1}" style="animation-delay:${Math.min(i, 12) * 70}ms">
        <span class="rank">#${i + 1}</span>
        <span>${esc(p.name)}</span>
        <span class="score">${p.score}</span>
      </li>`).join('');

    if (s.phase === 'leaderboard') {
      screen.innerHTML = `
        <h2 class="screen-title">Leaderboard <span class="hi">after round ${r.number}</span></h2>
        <ol class="board">${board}</ol>
        <div class="controls">
          <button id="next" class="btn primary big" type="button">Start round ${r.number + 1}</button>
        </div>`;
      $('next').onclick = () => send('host:startRound');
      return;
    }

    if (s.phase === 'final') {
      const [a, b, c] = s.players;
      const step = (p, cls, n) => p ? `
        <div class="step ${cls}">
          <div class="pname">${esc(p.name)}</div>
          <div class="pscore">${p.score} pts</div>
          <div class="block">${n}</div>
        </div>` : '<div class="step"></div>';
      screen.innerHTML = `
        <h2 class="screen-title">The <span class="hi">Cheapest</span> Of Them All</h2>
        ${a ? `<p class="cheapest">👑 <b>${esc(a.name)}</b> knows the price of everything.</p>` : ''}
        <div class="podium">${step(b, 'p2', 2)}${step(a, 'p1', 1)}${step(c, 'p3', 3)}</div>
        <ol class="board">${board}</ol>
        <div class="controls">
          <button id="again" class="btn big" type="button">Back to setup</button>
        </div>`;
      $('again').onclick = () => {
        send('host:end');
        session = null;
        try { sessionStorage.removeItem(SESSION); } catch {}
        showSetup();
      };
      if (phaseChanged) {
        burst(160);
        window.track?.('game-finished', `${s.players.length} players`);
      }
    }
  }

  function roundLabel(r) {
    return r.bonus ? `⭐ Bonus round (${r.number} of ${r.total})` : `Round ${r.number} of ${r.total}`;
  }

  function ceilingLine(r) {
    if (!r.hasCeiling) return '<div class="ceiling">No ceiling this time. <b>Highest guess wins.</b></div>';
    if (r.ceiling === null) {
      return '<div class="ceiling">🤫 There\'s a <b>secret ceiling</b>.<div class="muted small" style="margin-top:6px">Go as high as you dare. Go over it and you\'re disqualified.</div></div>';
    }
    return `<div class="ceiling">The secret ceiling was <span class="price">${money(r.ceiling)}</span></div>`;
  }

  function burst(n) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#ffe14a', '#ff3b3b', '#3ee08f', '#ffffff', '#c9ced6'];
    const box = $('confetti');
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      el.style.left = `${Math.random() * 100}%`;
      el.style.background = colors[i % colors.length];
      el.style.animationDuration = `${1.8 + Math.random() * 2.2}s`;
      el.style.animationDelay = `${Math.random() * 0.6}s`;
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(el);
      setTimeout(() => el.remove(), 5000);
    }
  }

  // Load the saved setup before anything renders.
  db.get(SETUP_KEY).then((saved) => {
    if (saved) setup = normalise(saved);
    if (!session && socket.connected) showSetup();
  });
})();
