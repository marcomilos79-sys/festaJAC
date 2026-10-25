# FantaLaurea

Fantacalcio per la festa: ognuno schiera 5 partecipanti (uno capitano, punti e malus x2), gli admin assegnano bonus/malus, la classifica si aggiorna in tempo reale.

Sito statico (GitHub Pages) + Firebase (Auth email/password + Firestore). Nessuna build.

## Configurazione (una volta sola)

1. **Firebase Console → Authentication → Sign-in method**: abilita *Email/Password*.
2. **Authentication → Settings → Authorized domains**: aggiungi `<tuo-utente>.github.io`.
3. **Firestore Database**: crealo (modalità produzione), poi in *Rules* incolla il contenuto di [firestore.rules](firestore.rules) e pubblica.
4. **GitHub**: crea un repo, carica questi file, *Settings → Pages → Deploy from branch → main / root*.
5. **Admin**: registratevi entrambi dall'app, copiate il vostro UID (in *La mia squadra*), poi in Firestore crea la collezione `admins` con un documento per ognuno, **ID documento = UID** (nessun campo necessario). Ricaricate la pagina: compare la tab *Admin*.
6. Dalla tab Admin: imposta gli **orari** (blocco squadre 20:00, fine gioco 01:00 — finché non li salvi nessuno può salvare la squadra), aggiungi i **partecipanti**, poi premi **Importa le regole del regolamento**: carica tutti i bonus/malus base più 6 regole segrete (3 bonus, 3 malus) da personalizzare con *Modifica*.

## Regole segrete 🤫

Stanno in una collezione separata (`secret`) che il database fa leggere solo agli admin, e a tutti da **un'ora prima della fine** del gioco. Se nel frattempo assegnate una regola segreta, gli altri vedono i punti ma con la scritta "Bonus/Malus segreto"; il testo vero compare allo svelamento.

Ogni volta che aggiorni [firestore.rules](firestore.rules), ricordati di ripubblicarle nella console.

## Chi può fare cosa (applicato dalle regole Firestore, non solo dall'interfaccia)

- Tutti (anche senza login): vedono classifiche, squadre, profili giocatori, regole.
- Giocatore loggato: crea/modifica **solo la propria** squadra, solo prima dell'orario di blocco (ora del server), solo 5 giocatori distinti con capitano tra questi.
- Admin: tutto, in qualsiasi momento (eventi, partecipanti, regole, orari, squadre).

Per correggere un punteggio: elimina l'evento sbagliato dalla lista *Ultimi eventi* e riassegnalo.

## Test

`node score.test.mjs` verifica il calcolo dei punti (capitano x2).
