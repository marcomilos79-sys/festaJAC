import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDoc, setDoc, addDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
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

// editing = UID della squadra altrui che l'admin sta modificando; editRule = percorso della regola in modifica
const S = { user: null, admin: false, players: [], rules: [], secret: [], events: [], teams: [], cfg: {}, draft: null, editing: null, editRule: null };

// Regolamento di base, importabile con un clic dalla tab Admin. [testo, punti, tuttiIPunti]
const BASE_RULES = [
  ['Selfie con almeno 5 persone (non valgono le foto di gruppo con la torta)', 20],
  ['Selfie: ogni sconosciuto nella foto', 5],
  ['Hai almeno un indumento blu scuro', 10],
  ['Attacchi uno sticker a Jacopo o a qualcosa di suo', 30],
  ['Sticker su Jacopo: prova fotografica', 5],
  ['Fai partire un coro', 15],
  ['Lasci una firma sulla tesi', 20],
  ['Lasci una firma con dedica sulla tesi', 50],
  ['Pacca sul culo a Jac', 30],
  ['Infili qualcosa nei pantaloni di Jac', 40],
  ['Scoppi un palloncino addosso a Jac col pube', 50],
  ['Batti il 5 a Jac', 10],
  ['Non partecipi ai cori', -10],
  ['Non fai nemmeno una foto', -15],
  ['Chiedi al festeggiato "cosa farai dopo?"', -20],
  ['Fai scoprire a Jacopo del FantaLaurea prima della fine del gioco', 0, true],
  ['Attacchi uno sticker in giro', -70],
  ['Fai troppo male a Jacopo', -10],
  ['Parli di politica (per ogni vittima coinvolta)', -50],
  ['Interferisci con i giochi di Jacopo aiutandolo (cruciverba, bicchieri)', -25],
];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = n => `<span class="pts ${n > 0 ? 'plus' : n < 0 ? 'minus' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
const rulePts = r => r.all ? '<span class="pts minus">−tutti i punti</span>' : fmt(r.points);
const byPts = (a, b) => (b.all ? -1e9 : b.points) - (a.all ? -1e9 : a.points);
const rulePath = r => (r.secret ? 'secret/' : 'rules/') + r.id;
const allRules = () => [...S.rules, ...S.secret];
const when = t => t ? (t.toDate?.() ?? t).toLocaleString('it-IT', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '(da definire)';
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
  S.user = u; S.admin = false; S.draft = null; S.editing = null;
  $('#team-form').reset();
  render();
  if (u) S.admin = await getDoc(doc(db, 'admins', u.uid)).then(d => d.exists(), e => (console.error(e), false));
  $('#me-admin').textContent = u ? (S.admin ? 'sei admin' : `non admin (manca il documento admins/${u.uid})`) : '';
  render();
});

// Regole segrete: il database le dà solo agli admin, e a tutti da un'ora prima della fine.
let stopSecret = null;
const revealAt = () => S.cfg.endAt ? S.cfg.endAt.toMillis() - 36e5 : Infinity;
function syncSecret() {
  const want = S.admin || Date.now() >= revealAt();
  if (want && !stopSecret) stopSecret = onSnapshot(collection(db, 'secret'),
    snap => { S.secret = snap.docs.map(d => ({ id: d.id, ...d.data(), secret: true })); render(); },
    () => { stopSecret = null; }); // es. orologio del telefono un po' avanti: riprova al prossimo aggiornamento
  if (!want && stopSecret) { stopSecret(); stopSecret = null; S.secret = []; }
}

function phase() {
  const { lockAt, endAt } = S.cfg, now = Date.now();
  if (!lockAt) return 'unset';
  if (now < lockAt.toMillis()) return 'open';
  if (!endAt || now < endAt.toMillis()) return 'locked';
  return 'over';
}

function render() {
  syncSecret();
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
  const rules = allRules().sort(byPts);
  // Gli eventi segreti mostrano il testo vero solo a chi può leggere la regola.
  const note = e => (e.secret ? '🤫 ' : '') + (S.secret.find(s => s.id === e.secret)?.label ?? e.note) + (e.qty > 1 ? ` ×${e.qty}` : '');
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
      <ul>${events.filter(e => e.playerId === p.id).map(e => `<li><span class="grow">${esc(note(e))} <small>${time(e.at)}</small></span>${fmt(e.points)}</li>`).join('') || '<li class="muted">Ancora niente.</li>'}</ul>
    </details></li>`).join('') || '<li class="muted">Nessun partecipante ancora.</li>';

  $('#rules').innerHTML = rules.map(r => `<li class="row"><span class="grow">${r.secret ? '🤫 ' : ''}${esc(r.label)}</span>${rulePts(r)}</li>`).join('') || '<li class="muted">Ancora da definire.</li>';
  $('#secret-info').textContent = Date.now() >= revealAt()
    ? '🤫 = regola segreta, ora svelata!'
    : `🤫 Ci sono bonus e malus segreti: verranno svelati ${when(S.cfg.endAt && new Date(revealAt()))}.`;

  // La mia squadra
  const u = S.user;
  $('#auth-form').hidden = !!u;
  $('#team-box').hidden = !u;
  if (u) {
    $('#me-name').textContent = u.displayName || u.email;
    $('#me-uid').textContent = u.uid;
    const mine = S.teams.find(t => t.id === (S.editing ?? u.uid));
    $('#editing').hidden = !S.editing;
    $('#editing-name').textContent = mine?.owner ?? '';
    if (!S.draft && mine) {
      S.draft = { members: mine.members.filter(id => ids.has(id)), captain: mine.captain };
      $('#team-form').tname.value = mine.name;
    }
    const d = S.draft ?? { members: [], captain: null };
    const can = ph === 'open' || S.admin, full = d.members.length >= 5;
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
  f.rule.innerHTML = '<option value="">— personalizzato —</option>' + rules.map(r => `<option value="${esc(r.id)}">${r.secret ? '🤫 ' : ''}${esc(r.label)} (${r.all ? 'tutti i punti' : (r.points > 0 ? '+' : '') + r.points})</option>`).join('');
  f.player.value = pv; f.rule.value = rv;
  const del = path => `<button type="button" data-del="${esc(path)}" aria-label="Elimina">✕</button>`;
  $('#ev-list').innerHTML = events.map(e => `<li class="row"><span class="grow">${esc(pname(e.playerId))}: ${esc(note(e))} <small>${time(e.at)} · ${esc(e.by)}</small></span>${fmt(e.points)}${del('events/' + e.id)}</li>`).join('');
  $('#team-list').innerHTML = [...S.teams].sort(byName).map(t => `<li class="row"><span class="grow">${esc(t.name)} <small>di ${esc(t.owner)}</small></span><button type="button" data-edit="${esc(t.id)}">Modifica</button>${del('teams/' + t.id)}</li>`).join('') || '<li class="muted">Nessuna squadra ancora.</li>';
  $('#player-list').innerHTML = players.map(p => `<li class="row"><span class="grow">${esc(p.name)}</span>${del('players/' + p.id)}</li>`).join('');
  $('#rule-list').innerHTML = rules.map(r => `<li class="row"><span class="grow">${r.secret ? '🤫 ' : ''}${esc(r.label)}</span>${rulePts(r)}<button type="button" data-editrule="${esc(rulePath(r))}">Modifica</button>${del(rulePath(r))}</li>`).join('');
  $('#seed').hidden = rules.length > 0;
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
  const id = S.editing ?? S.user.uid;
  const owner = S.editing ? S.teams.find(t => t.id === id)?.owner : S.user.displayName;
  await setDoc(doc(db, 'teams', id), { name, owner: (owner || 'Anonimo').slice(0, 40), members: d.members, captain: d.captain });
  alert('Squadra salvata!');
}));

// Admin
// Scegliendo una regola si compilano punti e descrizione; "tutti i punti" = meno il punteggio attuale del giocatore.
$('#ev-form').addEventListener('change', e => {
  const f = e.currentTarget, r = allRules().find(r => r.id === f.rule.value);
  if (!r || !['rule', 'player'].includes(e.target.name) || (e.target.name === 'player' && !r.all)) return;
  f.note.value = r.label;
  f.points.value = r.all ? -Math.max(0, playerScores(S.events)[f.player.value] || 0) : r.points;
  if (r.all) f.qty.value = 1;
});
$('#ev-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, r = allRules().find(r => r.id === f.rule.value), qty = Number(f.qty.value), pts = Number(f.points.value);
  const ev = { playerId: f.player.value, points: pts * qty, qty, note: f.note.value.trim(), at: serverTimestamp(), by: S.user.displayName || S.user.email };
  // Il testo pubblico non deve svelare la regola segreta: quello vero si legge dalla regola dopo lo svelamento.
  if (r?.secret) Object.assign(ev, { secret: r.id, note: pts >= 0 ? 'Bonus segreto' : 'Malus segreto' });
  await addDoc(collection(db, 'events'), ev);
  f.reset();
}));
$('#player-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  await addDoc(collection(db, 'players'), { name: e.target.pname.value.trim() });
  e.target.reset();
}));
const editRule = path => {
  const f = $('#rule-form'), r = path && allRules().find(r => rulePath(r) === path);
  S.editRule = path; f.reset();
  if (r) { f.label.value = r.label; f.points.value = r.points; f.secret.checked = !!r.secret; f.scrollIntoView(); }
  f.secret.disabled = !!path;
  $('#rule-save').textContent = path ? 'Salva modifica' : 'Aggiungi regola';
  $('#rule-cancel').hidden = !path;
};
$('#rule-cancel').addEventListener('click', () => editRule(null));
$('#rule-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, data = { label: f.label.value.trim(), points: Number(f.points.value) };
  if (S.editRule) await setDoc(doc(db, S.editRule), data, { merge: true });
  else await addDoc(collection(db, f.secret.checked ? 'secret' : 'rules'), data);
  editRule(null);
}));
$('#seed').addEventListener('click', act(async () => {
  const b = writeBatch(db);
  for (const [label, points, all] of BASE_RULES) b.set(doc(collection(db, 'rules')), all ? { label, points, all } : { label, points });
  for (let i = 1; i <= 3; i++) {
    b.set(doc(collection(db, 'secret')), { label: `Bonus segreto ${i} (da modificare)`, points: 20 });
    b.set(doc(collection(db, 'secret')), { label: `Malus segreto ${i} (da modificare)`, points: -20 });
  }
  await b.commit();
}));
$('#cfg-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, lockAt = new Date(f.lockAt.value), endAt = new Date(f.endAt.value);
  if (endAt <= lockAt) return alert('La fine del gioco deve venire dopo il blocco squadre');
  await setDoc(doc(db, 'config', 'game'), { lockAt: Timestamp.fromDate(lockAt), endAt: Timestamp.fromDate(endAt) });
  alert('Orari salvati');
}));
const editTeam = id => { S.editing = id; S.draft = null; $('#team-form').reset(); render(); };
$('#stop-edit').addEventListener('click', () => editTeam(null));
$('#tab-admin').addEventListener('click', act(async e => {
  const { edit, editrule, del: path } = e.target.dataset;
  if (edit) { editTeam(edit); $('[data-tab=squadra]').click(); }
  if (editrule) editRule(editrule);
  if (path && confirm('Eliminare?')) await deleteDoc(doc(db, path));
}));
