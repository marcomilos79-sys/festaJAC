import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, sendPasswordResetEmail, signInAnonymously } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDoc, setDoc, addDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp, runTransaction, query, where } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
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
const S = { user: null, admin: false, players: [], rules: [], secret: [], events: [], teams: [], proofs: [], proofImg: null, cfg: {}, draft: null, draftFor: null, editing: null, editRule: null };

// Regolamento di base, caricato in automatico la prima volta che un admin apre l'app. [testo, punti, tuttiIPunti]
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

// Foto profilo (ritagliate dal sondaggio WhatsApp) in img/<nome-in-minuscolo>.png; chi non ce l'ha mostra l'iniziale.
// shortcut: legate al nome, se rinomini un partecipante la foto sparisce finché non rinomini anche il file.
const PHOTOS = new Set(['marco-milos', 'gabritir', 'crispif', 'matteo-bali', 'sofia-dina', 'riccardo-daniele', 'edoardo-massarelli', 'alessandra-volpi',
  'panzi', 'vi', 'aimee', 'alessandro-verdi', 'sasi', 'sara', 'leo-verdacchi']);
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, '-');
const avatar = name => PHOTOS.has(slug(name))
  ? `<img class="av" src="img/${slug(name)}.png" alt="">`
  : `<span class="av">${esc(name.trim()[0]?.toUpperCase() ?? '?')}</span>`;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = n => `<span class="pts ${n > 0 ? 'plus' : n < 0 ? 'minus' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
const fmtPlain = n => (n > 0 ? '+' : '') + n;
// Riscrive solo se cambia: evita di ricaricare le foto (e farle lampeggiare) a ogni aggiornamento live.
const setHTML = (sel, html) => { const el = $(sel); if (el._html !== html) { el._html = html; el.innerHTML = html; } };
const rulePts = r => r.all ? '<span class="pts minus">−tutti i punti</span>' : fmt(r.points);
const byPts = (a, b) => (b.all ? -1e9 : b.points) - (a.all ? -1e9 : a.points);
const rulePath = r => (r.secret ? 'secret/' : 'rules/') + r.id;
const allRules = () => [...S.rules, ...S.secret];
const when = t => t ? (t.toDate?.() ?? t).toLocaleString('it-IT', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '(da definire)';
const time = ts => ts ? ts.toDate().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : 'ora';
const toInput = ts => { if (!ts) return ''; const d = ts.toDate(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const byName = (a, b) => a.name.localeCompare(b.name);
const toast = msg => {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3200);
};
const act = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('Errore: ' + (e.code || e.message)); } };
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
  $('#me-admin').textContent = u && !u.isAnonymous ? (S.admin ? 'sei admin' : `non admin (manca il documento admins/${u.uid})`) : '';
  render();
  syncProofs(u);
  if (S.admin) seedOnce();
});

// Prove fotografiche: l'admin le vede tutte, il giocatore solo le sue (il database applica lo stesso filtro).
const okImg = s => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s) ? s : ''; // mai HTML/script dentro src
let stopProofs = null;
function syncProofs(u) {
  stopProofs?.(); stopProofs = null; S.proofs = [];
  if (!u) return;
  const q = S.admin ? collection(db, 'proofs') : query(collection(db, 'proofs'), where('uid', '==', u.uid));
  stopProofs = onSnapshot(q, snap => {
    S.proofs = snap.docs.map(d => ({ id: d.id, ...d.data(), image: okImg(d.data().image) }));
    render();
  }, e => console.error(e));
}

// Riduce la foto (max 1280px, JPEG) per stare sotto il limite di 1 MB di un documento Firestore.
async function shrink(file) {
  const img = new Image(), url = URL.createObjectURL(file);
  try {
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = () => ko(new Error('formato foto non supportato')); img.src = url; });
    for (const [max, q] of [[1280, .7], [1024, .6], [800, .5]]) {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length < 900000) return data;
    }
    throw new Error('foto troppo grande');
  } finally { URL.revokeObjectURL(url); }
}

// Partecipanti iniziali (dal sondaggio WhatsApp), caricati in automatico come il regolamento.
const BASE_PLAYERS = ['Marco Milos', 'Alessandra Volpi', 'Gabritir', 'Crispif', 'Sofia Dina', 'Riccardo Daniele', 'Edoardo Massarelli', 'Panzi',
  'Vi', 'Matteo Bali', 'Aimée', 'Alessandro Verdi', 'Sasi', 'Sara', 'Leo Verdacchi', 'Giulioanve'];

// Caricamenti iniziali, ognuno una volta sola: i flag in config/game evitano doppioni anche con due admin.
const SEEDS = {
  seeded: tx => {
    for (const [label, points, all] of BASE_RULES) tx.set(doc(collection(db, 'rules')), all ? { label, points, all } : { label, points });
    for (let i = 1; i <= 3; i++) {
      tx.set(doc(collection(db, 'secret')), { label: `Bonus segreto ${i} (da modificare)`, points: 20 });
      tx.set(doc(collection(db, 'secret')), { label: `Malus segreto ${i} (da modificare)`, points: -20 });
    }
  },
  playersSeeded: tx => { for (const name of BASE_PLAYERS) tx.set(doc(collection(db, 'players')), { name }); },
};
let seeding = false;
async function seedOnce() {
  if (seeding) return;
  seeding = true;
  try {
    await runTransaction(db, async tx => {
      const cfg = doc(db, 'config', 'game'), done = (await tx.get(cfg)).data() || {};
      const todo = Object.keys(SEEDS).filter(k => !done[k]);
      todo.forEach(k => SEEDS[k](tx));
      if (todo.length) tx.set(cfg, Object.fromEntries(todo.map(k => [k, true])), { merge: true });
    });
  } catch (e) {
    seeding = false;
    $('#me-admin').textContent += ` · caricamento regole fallito (${e.code}): hai pubblicato firestore.rules?`;
  }
}

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
    <li style="--i:${i}"><details data-id="t${t.id}" ${isOpen('t' + t.id)}>
      <summary><span class="rank r${i + 1}">${i + 1}</span><span class="grow"><span class="tname">${esc(t.name)}</span><small>di ${esc(pname(t.id))}</small>
        <span class="stack">${t.members.map(id => avatar(pname(id))).join('')}</span></span>${fmt(t.pts)}</summary>
      <ul>${t.members.map(id => `<li>${avatar(pname(id))}<span class="grow">${esc(pname(id))}${id === t.captain ? '<b class="cap-tag" title="Capitano">C</b>' : ''}</span>${fmt(memberScore(t, id, sc))}</li>`).join('')}</ul>
    </details></li>`).join('') || '<li class="muted">Nessuna squadra ancora.</li>';

  $('#lb-players').innerHTML = [...players].sort((a, b) => (sc[b.id] || 0) - (sc[a.id] || 0)).map((p, i) => `
    <li style="--i:${i}"><details data-id="p${p.id}" ${isOpen('p' + p.id)}>
      <summary><span class="rank r${i + 1}">${i + 1}</span>${avatar(p.name)}<span class="grow">${esc(p.name)}</span>${fmt(sc[p.id] || 0)}</summary>
      <ul>${events.filter(e => e.playerId === p.id).map(e => `<li><span class="grow">${esc(note(e))} <small>${time(e.at)}</small></span>${fmt(e.points)}</li>`).join('') || '<li class="muted">Ancora niente.</li>'}</ul>
    </details></li>`).join('') || '<li class="muted">Nessun partecipante ancora.</li>';

  const ruleRow = (r, i) => `<li class="row" style="--i:${i}"><span class="grow">${r.secret ? '🤫 ' : ''}${esc(r.label)}</span>${rulePts(r)}</li>`;
  $('#rules-bonus').innerHTML = rules.filter(r => r.points > 0).map(ruleRow).join('') || '<li class="muted">Ancora da definire.</li>';
  $('#rules-malus').innerHTML = rules.filter(r => r.points <= 0).map(ruleRow).join('') || '<li class="muted">Ancora da definire.</li>';
  $('#secret-info').textContent = Date.now() >= revealAt()
    ? '🤫 = regola segreta, ora svelata!'
    : `🤫 Ci sono bonus e malus segreti: verranno svelati ${when(S.cfg.endAt && new Date(revealAt()))}.`;

  // La mia squadra
  const u = S.user;
  // Il giocatore "sono io" è il partecipante legato a questo telefono; le squadre hanno lo stesso id del partecipante.
  const me = u && S.players.find(p => p.uid === u.uid);
  const target = S.editing ?? me?.id;
  $('#me-bar').hidden = !u;
  $('#me-tech').hidden = !u || u.isAnonymous;
  $('#admin-login').hidden = !!u;
  $('#name-form').hidden = !!target;
  $('#team-box').hidden = !target;
  if (u) {
    $('#me-name').textContent = me?.name ?? u.displayName ?? u.email ?? '';
    $('#me-uid').textContent = u.uid;
  }
  if (target) {
    const mine = S.teams.find(t => t.id === target);
    $('#editing').hidden = !S.editing;
    $('#editing-name').textContent = pname(target);
    if (S.draftFor !== target) { S.draftFor = target; S.draft = null; $('#team-form').reset(); }
    if (!S.draft && mine) {
      S.draft = { members: mine.members.filter(id => ids.has(id)), captain: mine.captain };
      $('#team-form').tname.value = mine.name;
    }
    const d = S.draft ?? { members: [], captain: null };
    const can = ph === 'open' || (S.admin && !!S.editing), // anche gli admin giocano: la propria squadra si blocca alle 20 come per tutti
      full = d.members.length >= 5;
    $('#pick').innerHTML = players.map((p, i) => {
      const on = d.members.includes(p.id), dis = !can || (!on && full);
      return `<li class="row pick ${on ? 'on' : ''} ${dis ? 'dis' : ''}" style="--i:${i}">
        <label class="grow"><input type="checkbox" class="sr" data-m="${esc(p.id)}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}>
          <span class="tick" aria-hidden="true"><svg class="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>${avatar(p.name)}<span class="grow">${esc(p.name)}</span></label>
        <label class="cap" title="Capitano"><input type="radio" class="sr" name="cap" data-c="${esc(p.id)}" aria-label="Capitano: ${esc(p.name)}" ${d.captain === p.id ? 'checked' : ''} ${!can || !on ? 'disabled' : ''}><span aria-hidden="true">C</span></label>
      </li>`;
    }).join('') || '<li class="muted">Gli admin non hanno ancora inserito i partecipanti.</li>';
    $('#pick-info').innerHTML = `<span class="slots" aria-hidden="true">${[0, 1, 2, 3, 4].map(n => `<i class="${n < d.members.length ? 'on' : ''}"></i>`).join('')}</span>`
      + esc(`${d.members.length}/5` + (d.captain ? ' · capitano scelto' : ' · manca il capitano')
      + (can ? '' : ph === 'unset' ? ' · gli admin devono ancora aprire le squadre' : ' · squadre bloccate'));
    $('#team-form').tname.disabled = !can;
    $('#team-form').querySelector('button').disabled = !can;
  }

  // Prove fotografiche (giocatore): solo per le sfide bonus, finché il gioco non è finito.
  const pf = $('#proof-form'), prv = pf.rule.value;
  pf.hidden = !me || !!S.editing || ph === 'over';
  pf.rule.innerHTML = '<option value="">— scegli la sfida —</option>' + rules.filter(r => r.points > 0).map(r => `<option value="${esc(r.id)}">${r.secret ? '🤫 ' : ''}${esc(r.label)}</option>`).join('');
  pf.rule.value = prv;
  $('#proof-send').disabled = !S.proofImg;
  const STATUS = { pending: 'In attesa', ok: 'Validata', no: 'Rifiutata' };
  const pill = s => `<span class="pill ${s}">${STATUS[s] ?? ''}</span>`;
  const proofs = [...S.proofs].sort((a, b) => (b.at?.toMillis() ?? Date.now()) - (a.at?.toMillis() ?? Date.now()));
  const myProofs = proofs.filter(p => p.uid === u?.uid);
  setHTML('#my-proofs', myProofs.length ? '<h3>Le tue prove</h3>' + myProofs.map(p => `<li class="row"><img class="thumb" src="${p.image}" alt=""><span class="grow">${esc(p.label)}<br><small>${time(p.at)}</small></span>${pill(p.status)}</li>`).join('') : '');

  // Admin
  $('[data-tab=admin]').hidden = !S.admin;
  if (!S.admin) return;
  const pending = proofs.filter(p => p.status === 'pending').length;
  $('#proof-title').textContent = `Prove fotografiche${pending ? ` · ${pending} da vedere` : ''}`;
  setHTML('#proof-list', proofs.map(p => {
    const r = allRules().find(r => r.id === p.ruleId), who = pname(p.playerId);
    return `<li class="card proof"><div class="head">${avatar(who)}<span class="grow"><b>${esc(who)}</b><br><small>${esc(p.label)} · ${time(p.at)}</small></span>${pill(p.status)}</div>
      <img class="shot" src="${p.image}" alt="Prova di ${esc(who)}: ${esc(p.label)}" loading="lazy">
      ${p.status === 'pending' ? `<div class="two"><button type="button" class="primary" data-ok="${esc(p.id)}" ${r ? '' : 'disabled'}>Valida ${r ? fmtPlain(r.points) : ''}</button><button type="button" data-no="${esc(p.id)}">Rifiuta</button></div>` : ''}
      <button type="button" data-del="proofs/${esc(p.id)}">Elimina foto</button></li>`;
  }).join('') || '<li class="muted">Nessuna prova ancora.</li>');
  const f = $('#ev-form'), pv = f.player.value, rv = f.rule.value;
  f.player.innerHTML = '<option value="">— scegli —</option>' + players.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  f.rule.innerHTML = '<option value="">— personalizzato —</option>' + rules.map(r => `<option value="${esc(r.id)}">${r.secret ? '🤫 ' : ''}${esc(r.label)} (${r.all ? 'tutti i punti' : (r.points > 0 ? '+' : '') + r.points})</option>`).join('');
  f.player.value = pv; f.rule.value = rv;
  const del = path => `<button type="button" data-del="${esc(path)}" aria-label="Elimina">✕</button>`;
  $('#ev-list').innerHTML = events.map(e => `<li class="row"><span class="grow">${esc(pname(e.playerId))}: ${esc(note(e))} <small>${time(e.at)} · ${esc(e.by)}</small></span>${fmt(e.points)}${del('events/' + e.id)}</li>`).join('');
  $('#team-list').innerHTML = players.map(p => {
    const t = S.teams.find(t => t.id === p.id);
    return `<li class="row">${avatar(p.name)}<span class="grow">${t ? `<b>${esc(t.name)}</b>` : '<i class="muted">nessuna squadra</i>'} <small>di ${esc(p.name)}${p.uid ? ' · entrato' : ''}</small></span>
      <button type="button" data-edit="${esc(p.id)}">${t ? 'Modifica' : 'Crea'}</button>${t ? del('teams/' + t.id) : ''}</li>`;
  }).join('');
  $('#player-list').innerHTML = players.map(p => `<li class="row">${avatar(p.name)}<span class="grow">${esc(p.name)}</span><button type="button" data-rename="${esc(p.id)}">Rinomina</button>${del('players/' + p.id)}</li>`).join('');
  $('#rule-list').innerHTML = rules.map(r => `<li class="row"><span class="grow">${r.secret ? '🤫 ' : ''}${esc(r.label)}</span>${rulePts(r)}<button type="button" data-editrule="${esc(rulePath(r))}">Modifica</button>${del(rulePath(r))}</li>`).join('');}
setInterval(render, 30000); // aggiorna stato blocco/fine anche senza nuovi dati

// Navigazione
// L'animazione d'ingresso parte solo quando apri una sezione, non a ogni aggiornamento live.
const animate = sec => { sec.classList.add('enter'); clearTimeout(sec.t); sec.t = setTimeout(() => sec.classList.remove('enter'), 900); };
setTimeout(() => $('#tab-classifica').classList.remove('enter'), 1500);
$('nav').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  document.querySelectorAll('nav button').forEach(b => { b.classList.toggle('on', b === btn); b.toggleAttribute('aria-current', b === btn); });
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'tab-' + btn.dataset.tab);
  animate($('#tab-' + btn.dataset.tab));
  scrollTo({ top: 0 });
});

// Accesso
$('#auth-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, email = f.email.value.trim(), pw = f.password.value, mode = e.submitter?.value;
  if (mode === 'reset') {
    if (!email) return toast('Scrivi prima la tua email');
    await sendPasswordResetEmail(auth, email);
    return toast('Ti abbiamo mandato una email per reimpostare la password');
  }
  if (mode === 'signup') {
    const nick = f.nick.value.trim();
    if (!nick) return toast('Scrivi il tuo nome');
    const { user } = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(user, { displayName: nick });
    render();
  } else {
    await signInWithEmailAndPassword(auth, email, pw);
  }
}));
// Accesso giocatori col solo nome: login anonimo + il partecipante viene legato a questo telefono.
// shortcut: chi conosce un nome può entrare al suo posto (scelta voluta, niente password); per bloccarlo servirebbe un PIN per giocatore.
$('#name-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const p = S.players.find(p => slug(p.name) === slug(e.target.who.value));
  if (!p) return toast("Nome non trovato: scrivilo esattamente come te l'hanno dato gli admin");
  if (!auth.currentUser) await signInAnonymously(auth);
  await updateDoc(doc(db, 'players', p.id), { uid: auth.currentUser.uid });
  e.target.reset();
}));
$('#logout').addEventListener('click', act(async () => {
  const me = S.players.find(p => p.uid === S.user?.uid);
  if (me) await updateDoc(doc(db, 'players', me.id), { uid: null });
  await signOut(auth);
}));

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
  if (!name) return toast('Dai un nome alla squadra');
  if (!d || d.members.length !== 5) return toast('Devi scegliere esattamente 5 giocatori');
  if (!d.captain) return toast('Scegli il capitano');
  const id = S.draftFor, owner = S.players.find(p => p.id === id)?.name || 'Anonimo';
  await setDoc(doc(db, 'teams', id), { name, owner: owner.slice(0, 40), members: d.members, captain: d.captain });
  toast('Squadra salvata!');
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
// Il testo pubblico non deve svelare la regola segreta: quello vero si legge dalla regola dopo lo svelamento.
const addEvent = (playerId, r, pts, qty, note) => addDoc(collection(db, 'events'), {
  playerId, points: pts * qty, qty, note, at: serverTimestamp(), by: S.user.displayName || S.user.email,
  ...(r?.secret && { secret: r.id, note: pts >= 0 ? 'Bonus segreto' : 'Malus segreto' }),
});
$('#ev-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, r = allRules().find(r => r.id === f.rule.value);
  await addEvent(f.player.value, r, Number(f.points.value), Number(f.qty.value), f.note.value.trim());
  f.reset();
}));

// Prove fotografiche: scatto/galleria → anteprima → invio
$('#proof-form').addEventListener('change', act(async e => {
  if (e.target.type !== 'file' || !e.target.files[0]) return;
  S.proofImg = await shrink(e.target.files[0]);
  e.target.value = '';
  $('#proof-preview').src = S.proofImg;
  $('#proof-preview').hidden = false;
  render();
}));
$('#proof-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, me = S.players.find(p => p.uid === S.user?.uid), r = allRules().find(r => r.id === f.rule.value);
  if (!me || !r || !S.proofImg) return toast('Scegli la sfida e fai la foto');
  const btn = $('#proof-send');
  btn.disabled = true; btn.textContent = 'Invio…';
  try {
    await addDoc(collection(db, 'proofs'), { playerId: me.id, uid: S.user.uid, ruleId: r.id, label: r.label, image: S.proofImg, at: serverTimestamp(), status: 'pending' });
    S.proofImg = null; f.reset(); $('#proof-preview').hidden = true;
    toast('Prova inviata! Gli admin la controlleranno');
  } finally { btn.textContent = 'Invia prova'; render(); }
}));
async function validateProof(id) {
  const p = S.proofs.find(p => p.id === id), r = allRules().find(r => r.id === p?.ruleId);
  if (!p || !r) return;
  await addEvent(p.playerId, r, r.all ? -Math.max(0, playerScores(S.events)[p.playerId] || 0) : r.points, 1, r.label);
  await updateDoc(doc(db, 'proofs', id), { status: 'ok' });
  toast('Prova validata, punti assegnati');
}
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
}));$('#cfg-form').addEventListener('submit', act(async e => {
  e.preventDefault();
  const f = e.target, lockAt = new Date(f.lockAt.value), endAt = new Date(f.endAt.value);
  if (endAt <= lockAt) return toast('La fine del gioco deve venire dopo il blocco squadre');
  await setDoc(doc(db, 'config', 'game'), { lockAt: Timestamp.fromDate(lockAt), endAt: Timestamp.fromDate(endAt) }, { merge: true });
  toast('Orari salvati');
}));
const editTeam = id => { S.editing = id; render(); };
$('#stop-edit').addEventListener('click', () => editTeam(null));
$('#tab-admin').addEventListener('click', act(async e => {
  const { edit, editrule, rename, del: path, ok, no } = e.target.dataset;
  if (ok || no) e.target.disabled = true; // niente doppio tocco = niente punti doppi
  if (ok) await validateProof(ok);
  if (no) await updateDoc(doc(db, 'proofs', no), { status: 'no' });
  if (edit) { editTeam(edit); $('[data-tab=squadra]').click(); }
  if (editrule) editRule(editrule);
  if (rename) {
    const name = prompt('Nuovo nome (è quello con cui entra nel gioco):', S.players.find(p => p.id === rename)?.name)?.trim().slice(0, 40);
    if (name) { await updateDoc(doc(db, 'players', rename), { name }); toast('Rinominato'); }
  }
  if (!path || !confirm('Eliminare?')) return;
  await deleteDoc(doc(db, path));
  if (path.startsWith('players/')) await deleteDoc(doc(db, 'teams', path.slice(8))); // via anche la sua squadra
}));
