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

  const blankRound = () => ({ image: '', title: '', ceiling: '', answer: '' });
  let setup = { currency: '$', seconds: 45, rounds: Array.from({ length: ROUNDS }, blankRound) };

  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => db.set('setup', setup), 300);
  }

  function normalise(data) {
    const rounds = Array.from({ length: ROUNDS }, (_, i) => ({ ...blankRound(), ...(data?.rounds?.[i] || {}) }));
    return { currency: data?.currency || '$', seconds: data?.seconds ?? 45, rounds };
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
    $('seconds').value = setup.seconds;
    const cur = esc(setup.currency);
    $('slots').innerHTML = setup.rounds.map((r, i) => `
      <div class="panel slot" data-i="${i}">
        <h3>Round ${i + 1}</h3>
        <div class="drop ${r.image ? 'has' : ''}" tabindex="0" role="button" aria-label="Choose image for round ${i + 1}">
          ${r.image ? `<img src="${r.image}" alt="">` : '<span>Drop an image here<br>or click to choose</span>'}
        </div>
        <input type="file" accept="image/*" hidden>
        <div style="margin-top:10px">
          <label>What is it? (optional)</label>
          <input type="text" data-k="title" maxlength="80" value="${esc(r.title)}" placeholder="Dave's emotional support mug">
        </div>
        <div class="two" style="margin-top:10px">
          <div><label>Ceiling (${cur})</label><input type="number" data-k="ceiling" min="0" step="0.01" value="${esc(r.ceiling)}" placeholder="100"></div>
          <div><label>Most likely (${cur})</label><input type="number" data-k="answer" min="0" step="0.01" value="${esc(r.answer)}" placeholder="24.99"></div>
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
    document.querySelectorAll('.slot').forEach((s) => {
      const labels = s.querySelectorAll('.two label');
      labels[0].textContent = `Ceiling (${setup.currency})`;
      labels[1].textContent = `Most likely (${setup.currency})`;
    });
  });
  $('seconds').addEventListener('input', () => { setup.seconds = Number($('seconds').value) || 0; persist(); });

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
      const c = Number(r.ceiling), a = Number(r.answer);
      let msg = '';
      if (!r.image) msg = 'needs an image';
      else if (r.ceiling === '' || !(c > 0)) msg = 'needs a ceiling price';
      else if (r.answer === '' || !(a >= 0)) msg = 'needs a most likely price';
      else if (a > c) msg = 'has a most likely price above its ceiling';
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
    const rounds = setup.rounds.map((r) => ({ image: r.image, title: r.title.trim(), ceiling: Number(r.ceiling), answer: Number(r.answer) }));
    socket.emit('host:create', { rounds, currency: setup.currency }, (res) => {
      $('openLobby').disabled = false;
      if (res.error) return ($('setupError').textContent = res.error);
      session = { code: res.code, hostKey: res.hostKey };
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
      $('go').onclick = () => send('host:startRound', { seconds: setup.seconds });
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
              <div class="round-label">Round ${r.number} of ${r.total}</div>
              <div class="item-title">${r.title ? esc(r.title) : 'What does this cost?'}</div>
              <div class="ceiling">Costs no more than <span class="price">${money(r.ceiling)}</span></div>
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
        <li class="${g.points === 2 ? 'win1' : g.points === 1 ? 'win2' : ''}">
          <span class="pos">${i + 1}</span>
          <span class="who">${esc(g.name)}</span>
          <span><b>${money(g.amount)}</b> <span class="off">off by ${money(g.diff)}</span></span>
          <span class="pts">${g.points ? `+${g.points}` : ''}</span>
        </li>`).join('') : '<p class="muted">Nobody guessed. Bold strategy.</p>';
      screen.innerHTML = `
        <div class="stage">
          <img class="stage-img" src="${r.image}" alt="">
          <div class="stack">
            <div class="round-label">Round ${r.number} of ${r.total} · the real price</div>
            ${r.title ? `<div class="item-title" style="margin:0">${esc(r.title)}</div>` : ''}
            <div><span class="price answer-reveal">${money(s.answer)}</span></div>
            <ul class="results">${rows}</ul>
          </div>
        </div>
        <div class="controls">
          <button id="board" class="btn primary big" type="button">${last ? 'Final results 🏆' : 'Show leaderboard'}</button>
        </div>`;
      $('board').onclick = () => send('host:showLeaderboard');
      if (phaseChanged && s.results.some((g) => g.points)) burst(40);
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
      $('next').onclick = () => send('host:startRound', { seconds: setup.seconds });
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
      if (phaseChanged) burst(160);
    }
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
  db.get('setup').then((saved) => {
    if (saved) setup = normalise(saved);
    if (!session && socket.connected) showSetup();
  });
})();
