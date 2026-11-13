// How Cheap Are You? — a Black Friday price-guessing party game.
// One Node process holds every game in memory. No database needed.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ROUNDS_PER_GAME = 7; // 6 normal rounds + 1 bonus round
const ROUND_SECONDS = 30;
const MAX_GUESS = 1e12; // keeps the bonus round sane
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000; // forget rooms after 6 idle hours

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 25 * 1024 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/healthz', (_req, res) => res.send('ok'));

// Optional, privacy-friendly analytics with GoatCounter (no cookies).
// Set GOATCOUNTER_CODE to your site code (the "mygame" in mygame.goatcounter.com) to turn it on.
const GOATCOUNTER_CODE = /^[a-z0-9-]{1,50}$/i.test(process.env.GOATCOUNTER_CODE || '') ? process.env.GOATCOUNTER_CODE : '';
app.get('/analytics.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache');
  if (!GOATCOUNTER_CODE) return res.send('window.track = function () {};');
  res.send(`(function () {
  var queue = [];
  // track('game-started', '5 players') records a custom event in GoatCounter.
  window.track = function (name, title) {
    var ev = { path: name, title: title || name, event: true };
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count(ev);
    else queue.push(ev);
  };
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://${GOATCOUNTER_CODE}.goatcounter.com/count');
  s.onload = function () {
    var flush = function () {
      if (!window.goatcounter || !window.goatcounter.count) return setTimeout(flush, 200);
      queue.splice(0).forEach(function (ev) { window.goatcounter.count(ev); });
    };
    flush();
  };
  document.head.appendChild(s);
})();`);
});

/** @type {Map<string, any>} */
const rooms = new Map();

const token = () => crypto.randomBytes(16).toString('hex');

function newRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function toMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const isBonus = (index) => index === ROUNDS_PER_GAME - 1;

function validateRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length !== ROUNDS_PER_GAME) {
    return `The game needs exactly ${ROUNDS_PER_GAME} rounds.`;
  }
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (!r.image) return `Round ${i + 1} has no image.`;
    if (isBonus(i)) continue; // the bonus round has no ceiling
    const ceiling = toMoney(r.ceiling);
    if (ceiling === null || ceiling <= 0) return `Round ${i + 1} needs a ceiling price.`;
  }
  return null;
}

/**
 * Rank the guesses for a round. Price-is-Right style: the HIGHEST guess that is not over the
 * ceiling wins 2 points, the second highest wins 1. Anything over the ceiling is disqualified.
 * With no ceiling (bonus round) the highest guess simply wins. Ties go to whoever guessed first.
 */
function scoreRound(guesses, ceiling) {
  const all = Object.entries(guesses).map(([playerId, g]) => ({
    playerId,
    amount: g.amount,
    at: g.at,
    disqualified: ceiling !== null && g.amount > ceiling,
    points: 0,
  }));
  const valid = all.filter((g) => !g.disqualified).sort((a, b) => b.amount - a.amount || a.at - b.at);
  const out = all.filter((g) => g.disqualified).sort((a, b) => a.amount - b.amount || a.at - b.at);
  const POINTS = [2, 1];
  valid.forEach((g, i) => (g.points = POINTS[i] || 0));
  return [...valid, ...out];
}

function leaderboard(room) {
  return Object.entries(room.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, online: !!p.socketId }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function publicRound(room) {
  const r = room.rounds[room.roundIndex];
  if (!r) return null;
  return {
    number: room.roundIndex + 1,
    total: room.rounds.length,
    bonus: isBonus(room.roundIndex),
    title: r.title || '',
    image: r.image,
    hasCeiling: r.ceiling !== null,
    // The ceiling stays secret until guessing is over.
    ceiling: room.phase === 'guessing' ? null : r.ceiling,
  };
}

/** The state the host screen renders. Includes the guesses only once they are revealed. */
function hostState(room) {
  const round = publicRound(room);
  const state = {
    code: room.code,
    phase: room.phase,
    currency: room.currency,
    round,
    players: leaderboard(room),
    guessedIds: Object.keys(room.guesses),
    remainingMs: room.deadline ? Math.max(room.deadline - Date.now(), 0) : null,
  };
  if (room.phase === 'reveal' || room.phase === 'leaderboard' || room.phase === 'final') {
    state.results = room.lastResults.map((g) => ({ ...g, name: room.players[g.playerId]?.name || '???' }));
  }
  return state;
}

/** The state one player's phone renders. */
function playerState(room, playerId) {
  const me = room.players[playerId];
  const state = {
    code: room.code,
    phase: room.phase,
    currency: room.currency,
    name: me.name,
    score: me.score,
    round: room.phase === 'lobby' ? null : publicRound(room),
    myGuess: room.guesses[playerId]?.amount ?? null,
    remainingMs: room.deadline ? Math.max(room.deadline - Date.now(), 0) : null,
  };
  if (room.phase !== 'lobby' && room.phase !== 'guessing') {
    const mine = room.lastResults.find((g) => g.playerId === playerId);
    state.pointsThisRound = mine ? mine.points : 0;
    state.disqualified = !!mine?.disqualified;
    state.winner = room.lastResults[0] && !room.lastResults[0].disqualified
      ? { name: room.players[room.lastResults[0].playerId]?.name || '???', amount: room.lastResults[0].amount }
      : null;
    const board = leaderboard(room);
    state.rank = board.findIndex((p) => p.id === playerId) + 1;
    state.playerCount = board.length;
  }
  return state;
}

function broadcast(room) {
  room.touched = Date.now();
  if (room.hostSocketId) io.to(room.hostSocketId).emit('host:state', hostState(room));
  for (const [id, p] of Object.entries(room.players)) {
    if (p.socketId) io.to(p.socketId).emit('player:state', playerState(room, id));
  }
}

function lockRound(room) {
  if (room.phase !== 'guessing') return;
  clearTimeout(room.timer);
  room.timer = null;
  room.deadline = null;
  room.lastResults = scoreRound(room.guesses, room.rounds[room.roundIndex].ceiling);
  for (const g of room.lastResults) room.players[g.playerId].score += g.points;
  room.phase = 'reveal';
  broadcast(room);
}

function hostRoom(socket, code, hostKey) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room || room.hostKey !== hostKey) return null;
  return room;
}

io.on('connection', (socket) => {
  // ---------- Host ----------
  socket.on('host:create', ({ rounds, currency } = {}, reply) => {
    const error = validateRounds(rounds);
    if (error) return reply?.({ error });
    const room = {
      code: newRoomCode(),
      hostKey: token(),
      hostSocketId: socket.id,
      currency: String(currency || '$').slice(0, 3),
      rounds: rounds.map((r, i) => ({
        image: String(r.image),
        title: String(r.title || '').slice(0, 120),
        ceiling: isBonus(i) ? null : toMoney(r.ceiling),
      })),
      players: {},
      phase: 'lobby',
      roundIndex: -1,
      guesses: {},
      lastResults: [],
      deadline: null,
      timer: null,
      touched: Date.now(),
    };
    rooms.set(room.code, room);
    socket.data.hostOf = room.code;
    reply?.({ code: room.code, hostKey: room.hostKey });
    broadcast(room);
  });

  socket.on('host:resume', ({ code, hostKey } = {}, reply) => {
    const room = hostRoom(socket, code, hostKey);
    if (!room) return reply?.({ error: 'That game has ended or the server restarted.' });
    room.hostSocketId = socket.id;
    socket.data.hostOf = room.code;
    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on('host:startRound', ({ code, hostKey } = {}) => {
    const room = hostRoom(socket, code, hostKey);
    if (!room) return;
    if (room.phase === 'guessing' || room.phase === 'final') return;
    if (room.roundIndex + 1 >= room.rounds.length) return;
    room.roundIndex += 1;
    room.phase = 'guessing';
    room.guesses = {};
    room.lastResults = [];
    room.deadline = Date.now() + ROUND_SECONDS * 1000;
    room.timer = setTimeout(() => lockRound(room), ROUND_SECONDS * 1000 + 300);
    broadcast(room);
  });

  socket.on('host:lock', ({ code, hostKey } = {}) => {
    const room = hostRoom(socket, code, hostKey);
    if (room) lockRound(room);
  });

  socket.on('host:showLeaderboard', ({ code, hostKey } = {}) => {
    const room = hostRoom(socket, code, hostKey);
    if (!room || room.phase !== 'reveal') return;
    room.phase = room.roundIndex + 1 >= room.rounds.length ? 'final' : 'leaderboard';
    broadcast(room);
  });

  socket.on('host:kick', ({ code, hostKey, playerId } = {}) => {
    const room = hostRoom(socket, code, hostKey);
    if (!room || !room.players[playerId]) return;
    const p = room.players[playerId];
    if (p.socketId) io.to(p.socketId).emit('player:kicked');
    delete room.players[playerId];
    delete room.guesses[playerId];
    broadcast(room);
  });

  socket.on('host:end', ({ code, hostKey } = {}) => {
    const room = hostRoom(socket, code, hostKey);
    if (!room) return;
    clearTimeout(room.timer);
    for (const p of Object.values(room.players)) if (p.socketId) io.to(p.socketId).emit('player:kicked');
    rooms.delete(room.code);
  });

  // ---------- Players ----------
  socket.on('player:join', ({ code, name, playerId } = {}, reply) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return reply?.({ error: "Can't find that room code." });

    // Rejoining after a refresh or a dropped connection.
    if (playerId && room.players[playerId]) {
      room.players[playerId].socketId = socket.id;
      socket.data.player = { code: room.code, playerId };
      reply?.({ playerId, code: room.code });
      return broadcast(room);
    }

    const clean = cleanName(name);
    if (!clean) return reply?.({ error: 'Pick a funny name first.' });
    const taken = Object.values(room.players).some((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (taken) return reply?.({ error: 'Someone already grabbed that name. Get weirder.' });
    if (Object.keys(room.players).length >= 60) return reply?.({ error: 'This room is full.' });

    const id = token();
    room.players[id] = { name: clean, score: 0, socketId: socket.id };
    socket.data.player = { code: room.code, playerId: id };
    reply?.({ playerId: id, code: room.code });
    broadcast(room);
  });

  socket.on('player:guess', ({ amount } = {}, reply) => {
    const who = socket.data.player;
    const room = who && rooms.get(who.code);
    if (!room || !room.players[who.playerId]) return reply?.({ error: 'You are not in a game.' });
    if (room.phase !== 'guessing') return reply?.({ error: 'Guessing is closed.' });
    const value = toMoney(amount);
    if (value === null) return reply?.({ error: 'Type a price.' });
    if (value > MAX_GUESS) return reply?.({ error: 'Nice try. Keep it under a trillion.' });
    // Guesses over the ceiling are allowed on purpose: they are disqualified when the round is scored.
    // Changing your guess is allowed, but it moves you to the back of the tie-break queue.
    room.guesses[who.playerId] = { amount: value, at: Date.now() };
    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const who = socket.data.player;
    const room = who && rooms.get(who.code);
    if (room && room.players[who.playerId]?.socketId === socket.id) {
      room.players[who.playerId].socketId = null;
      broadcast(room);
    }
    const hosted = socket.data.hostOf && rooms.get(socket.data.hostOf);
    if (hosted && hosted.hostSocketId === socket.id) hosted.hostSocketId = null;
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > ROOM_IDLE_MS) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`How Cheap Are You? is running on http://localhost:${PORT}`));
}

module.exports = { server, scoreRound, validateRounds, ROUNDS_PER_GAME, ROUND_SECONDS };
