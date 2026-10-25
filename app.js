import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDoc, setDoc, addDoc, deleteDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { playerScores, memberScore, teamScore } from './score.js';

const app = initializeApp({
  apiKey: 'AIzaSyBlnErYpNtQ6Po6ji4BKNV7IfpXBeJwAaw',
  authDomain: 'laurea-74418.firebaseapp.com',
  projectId: 'laurea-74418',
  storageBucket: 'laurea-74418.firebasestorage.app',
  messagingSenderId: '372160368799',
  appId: '1:372160368799:web:75ab65d3035606114252aa',
});
const auth = getAuth(app);
const db = getFirestore(app);

const S = { user: null, admin: false, players: [], rules: [], events: [], teams: [], cfg: {}, draft: null };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = n => `<span class="pts ${n > 0 ? 'plus' : n < 0 ? 'minus' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
const when = ts => ts ? ts.toDate().toLocaleString('it-IT', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '(da definire)';
const time = ts => ts ? ts.toDate().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : 'ora';
const toInput = ts => { if (!ts) return ''; const d = ts.toDate(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const byName = (a, b) => a.name.localeCompare(b.name);
const act = fn => async (...a) => { try { await fn(...a); } catch (e) { alert('Errore: ' + (e.code || e.message)); } };
const dbError = e => { $('#status').textContent = 'Errore database: ' + e.code; };

// Dati live: ogni modifica degli admin arriva subito a tutti.
for (const name of ['players', 'rules', 'events', 'teams'])
  onSnapshot(collection(db, name), snap => { S[name] = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, dbError);
onSnapshot(doc(db, 'config', 'game'), d => {
  S.cfg = d.data() || {};
  $('#cfg-form').lockAt.value = toInput(S.cfg.lockAt);
  $('#cfg-form').endAt.value = toInput(S.cfg.endAt);
  render();
}, dbError);

onAuthStateChanged(auth, async u => {
  S.user = u; S.admin = false; S.draft = null;
  $('#team-form').reset();
  render();
  if (u) S.admin = await getDoc(doc(db, 'admins', u.uid)).then(d => d.exists(), () => false);
  render();
});

function phase() {
  const { lockAt, endAt } = S.cfg, now = Date.now();
  if (!lockAt) return 'unset';
  if (now < lockAt.toMillis()) return 'open';
  if (!endAt || now < endAt.toMillis()) return 'locked';
  return 'over';
}

function render() {
  const ph = phase();
  $('#status').textContent = {
    unset: 'Orari non ancora impostati dagli admin',
    open: `Squadre modificabili fino a ${when(S.cfg.lockAt)}`,
    locked: `Squadre bloccate · il gioco finisce ${when(S.cfg.endAt)}`,
    over: '🏆 Gioco finito! Classifica finale',
  }[ph];
  $('#rule-lock').textContent = `Puoi modificare la squadra fino a ${when(S.cfg.lockAt)}.`;
  $('#rule-end').textContent = `Il gioco finisce ${when(S.cfg.endAt)}: poi si annunciano i vincitori.`;

  // Tiene aperti i dettagli che l'utente aveva aperto prima del refresh.
  const open = new Set([...document.querySelectorAll('details[open]')].map(d => d.dataset.id));
  const isOpen = id => open.has(id) ? 'open' : '';

  const ids = new Set(S.players.map(p => p.id));
  const sc = playerScores(S.events.filter(e => ids.has(e.playerId)));
  const pname = id => S.players.find(p => p.id === id)?.name ?? '(rimosso)';
  const players = [...S.players].sort(byName);
  const rules = [...S.rules].sort((a, b) => b.points - a.points);
  const events = [...S.events].sort((a, b) => (b.at?.toMillis() ?? Date.now()) - (a.at?.toMillis() ?? Date.now()));

  const teams = S.teams.map(t => ({ ...t, pts: teamScore(t, sc) })).sort((a, b) => b.pts - a.pts);
  $('#lb-teams').innerHTML = teams.map((t, i) => `
    <li><details data-id="t${t.id}" ${isOpen('t' + t.id)}>
      <summary><span class="rank">${i + 1}</span><span class="grow"><b>${esc(t.name)}</b> <small>di ${esc(t.owner)}</small></span>${fmt(t.pts)}</summary>
      <ul>${t.members.map(id => `<li><span class="grow">${esc(pname(id))}${id === t.captain ? ' <b>©</b>' : ''}</span>${fmt(memberScore(t, id, sc))}</li>`).join('')}</ul>
    </details></li>`).join('') || '<li class="muted">Nessuna squadra ancora.</li>';

  $('#lb-players').innerHTML = [...players].sort((a, b) => (sc[b.id] || 0) - (sc[a.id] || 0)).map((p, i) => `
    <li><details data-id="p${p.id}" ${isOpen('p' + p.id)}>
      <summary><span class="rank">${i + 1}</span><span class="grow">${esc(p.name)}</span>${fmt(sc[p.id] || 0)}</summary>
      <ul>${events.filter(e => e.playerId === p.id).map(e => `<li><span class="grow">${esc(e.note)} <small>${time(e.at)}</small></span>${fmt(e.points)}</li>`).join('') || '<li class="muted">Ancora niente.</li>'}</ul>
    </details></li>`).join('') || '<li class="muted">Nessun partecipante ancora.</li>';

  $('#rules').innerHTML = rules.map(r => `<li class="row"><span class="grow">${esc(r.label)}</span>${fmt(r.points)}</li>`).join('') || '<li class="muted">Ancora da definire.</li>';

  // La mia squadra
  const u = S.user;
  $('#auth-form').hidden = !!u;
  $('#team-box').hidden = !u;
  if (u) {
    $('#me-name').textContent = u.displayName || u.email;
    $('#me-uid').textContent = u.uid;
    const mine = S.teams.find(t => t.id === u.uid);
    if (!S.draft && mine) {
      S.draft = { members: mine.members.filter(id => ids.has(id)), captain: mine.captain };
      $('#team-form').tname.value = mine.name;
    }
    const d = S.draft ?? { members: [], captain: null };
    const can = ph === 'open', full = d.members.length >= 5;
    $('#pick').innerHTML = players.map(p => {
      const on = d.members.includes(p.id);
      return `<li class="row">
        <label class="grow"><input type="checkbox" data-m="${esc(p.id)}" ${on ? 'checked' : ''} ${!can || (!on && full) ? 'disabled' : ''}> ${esc(p.name)}</label>
        <label>© <input type="radio" name="cap" data-c="${esc(p.id)}" aria-label="Capitano: ${esc(p.name)}" ${d.captain === p.id ? 'checked' : ''} ${!can || !on ? 'disabled' : ''}></label>
      </li>`;
    }).join('') || '<li class="muted">Gli admin non hanno ancora inserito i partecipanti.</li>';
    $('#pick-info').textContent = `${d.members.length}/5 scelti` + (d.captain ? '' : ' · manca il capitano')
      + (can ? '' : ph === 'unset' ? ' · gli admin devono ancora aprire le squadre' : ' · squadre bloccate');
    $('#team-form').tname.disabled = !can;
    $('#team-form').querySelector('button').disabled = !can;
  }

  // Admin
  $('[data-tab=admin]').hidden = !S.admin;
  if (!S.admin) return;
  const f = $('#ev-form'), pv = f.player.value, rv = f.rule.value;
  f.player.innerHTML = '<option value="">— scegli —</option>' + players.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  f.rule.innerHTML = '<option value="">— personalizzato —</option>' + rules.map(r => `<option value="${esc(r.id)}">${esc(r.label)} (${r.points > 0 ? '+' : ''}${r.points})</option>`).join('');
  f.player.value = pv; f.rule.value = rv;
  const del = path => `<button type="button" data-del="${esc(path)}" aria-label="Elimina">✕</button>`;
  $('#ev-list').innerHTML = events.map(e => `<li class="row"><span class="grow">${esc(pname(e.playerId))}: ${esc(e.note)} <small>${time(e.at)} · ${esc(e.by)}</small></span>${fmt(e.points)}${del('events/' + e.id)}</li>`).join('');
  $('#player-list').innerHTML = players.map(p => `<li class="row"><span class="grow">${esc(p.name)}</span>${del('players/' + p.id)}</li>`).join('');
  $('#rule-list').innerHTML = rules.map(r => `<li class="row"><span class="grow">${esc(r.label)}</span>${fmt(r.points)}${del('rules/' + r.id)}</li>`).join('');
}
setInterval(render, 30000); // aggiorna stato blocco/fine anche senza nuovi dati

// Navigazione
$('nav').addEventListener('click', e => {
  const t = e.target.dataset.tab;
  if (!t) return;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b === e.target));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'tab-' + t);
});

// Accesso
$('#auth-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, email = f.email.value.trim(), pw = f.password.value, mode = e.submitter?.value;
  if (mode === 'reset') {
    if (!email) return alert('Scrivi prima la tua email');
    await sendPasswordResetEmail(auth, email);
    return alert('Ti abbiamo mandato una email per reimpostare la password');
  }
  if (mode === 'signup') {
    const nick = f.nick.value.trim();
    if (!nick) return alert('Scrivi il tuo nome');
    const { user } = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(user, { displayName: nick });
    render();
  } else {
    await signInWithEmailAndPassword(auth, email, pw);
  }
}));
$('#logout').addEventListener('click', () => signOut(auth));

// Squadra
$('#pick').addEventListener('change', e => {
  const d = S.draft ??= { members: [], captain: null };
  const { m, c } = e.target.dataset;
  if (m) d.members = e.target.checked ? [...d.members, m] : d.members.filter(x => x !== m);
  if (c) d.captain = c;
  if (!d.members.includes(d.captain)) d.captain = null;
  render();
});
$('#team-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const d = S.draft, name = e.target.tname.value.trim();
  if (!name) return alert('Dai un nome alla squadra');
  if (!d || d.members.length !== 5) return alert('Devi scegliere esattamente 5 giocatori');
  if (!d.captain) return alert('Scegli il capitano');
  await setDoc(doc(db, 'teams', S.user.uid), {
    name, owner: (S.user.displayName || 'Anonimo').slice(0, 40), members: d.members, captain: d.captain,
  });
  alert('Squadra salvata!');
}));

// Admin
$('#ev-form').rule.addEventListener('change', e => {
  const r = S.rules.find(r => r.id === e.target.value);
  if (r) { e.target.form.points.value = r.points; e.target.form.note.value = r.label; }
});
$('#ev-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target;
  await addDoc(collection(db, 'events'), {
    playerId: f.player.value, points: Number(f.points.value), note: f.note.value.trim(),
    at: serverTimestamp(), by: S.user.displayName || S.user.email,
  });
  f.reset();
}));
$('#player-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  await addDoc(collection(db, 'players'), { name: e.target.pname.value.trim() });
  e.target.reset();
}));
$('#rule-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  await addDoc(collection(db, 'rules'), { label: e.target.label.value.trim(), points: Number(e.target.points.value) });
  e.target.reset();
}));
$('#cfg-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, lockAt = new Date(f.lockAt.value), endAt = new Date(f.endAt.value);
  if (endAt <= lockAt) return alert('La fine del gioco deve venire dopo il blocco squadre');
  await setDoc(doc(db, 'config', 'game'), { lockAt: Timestamp.fromDate(lockAt), endAt: Timestamp.fromDate(endAt) });
  alert('Orari salvati');
}));
$('#tab-admin').addEventListener('click', act(async e => {
  const path = e.target.dataset.del;
  if (path && confirm('Eliminare?')) await deleteDoc(doc(db, path));
}));
