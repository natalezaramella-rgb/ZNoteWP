# ZNoteKeeper – Decisioni

Decisioni prese da Benzene il 24 novembre 2026 dopo la [revisione critica](revisione-critica.md). Valgono come riferimento per lo sviluppo.

## Le tre scelte di fondo

| Tema | Decisione | Conseguenze |
| --- | --- | --- |
| Dove si cifra | Nel browser | Password e chiave non lasciano mai il dispositivo. Il server riceve e conserva solo dati già cifrati. La ricerca avviene sul dispositivo, sui dati decifrati |
| Recupero via email | Facoltativo, spento di default, legato all'indirizzo email presente quando lo si attiva | Se l'email o la password WordPress dell'utente cambiano, il recupero si spegne da solo e l'utente viene avvisato. Con il recupero attivo il sito conserva una copia protetta della chiave: va detto all'utente |
| Offline | Sola lettura di ciò che è già sul dispositivo | Nessuna modifica senza rete, quindi nessun conflitto da risolvere tra telefono e PC |

Tutte le funzioni mancanti elencate nella revisione (punti 25–33) entrano nella prima versione.

## Regole di processo per questa tornata

- Commit diretti su `main`, senza PR.
- Pubblicazione diretta sul sito: lo usa solo Benzene.
- Pochi test di integrazione intermedi.

## Cosa promette il prodotto (testo onesto)

ZNoteKeeper protegge le note da chi ottiene il database, un backup o l'accesso in lettura al server, e da un amministratore curioso. Non protegge da un amministratore che modifica di proposito il codice del plugin per catturare la password.

## Esito dei punti della revisione

| Punti | Esito |
| --- | --- |
| 1, 2 | Recupero via email legato all'indirizzo; la presentazione dichiara la copia protetta della chiave |
| 3, 4 | Cifratura nel browser e promessa riscritta come sopra |
| 5 | Attesa crescente dopo 5 password errate, blocco e avviso dopo 10, derivazione lenta della chiave |
| 6 | Password richiesta di nuovo per: nuovo codice di recupero, recupero via email, cambio password, dispositivi, backup ed esportazione |
| 7 | Verifica SPF e DKIM sui mittenti, limite di email all'ora, indirizzo personale rigenerabile |
| 8 | Il messaggio viene cancellato dalla casella dopo l'importazione; all'utente si dice che l'email viaggia in chiaro fino al sito |
| 9 | Promemoria generico («hai un'attività in scadenza») dal server; il titolo compare solo nei promemoria creati dal dispositivo |
| 10, 11 | Gestione utenti nel pannello WordPress (Utenti › ZNoteKeeper), con conferma su disabilitazione e «Cancella spazio» |
| 12 | Codice di recupero: Copia, Stampa, Scarica e casella di presa visione obbligatoria |
| 13 | Offline in sola lettura |
| 14 | Flussi di cambio password, backup cifrato, ripristino da backup |
| 15 | Stesso editor visuale (ridotto) nei dettagli delle attività |
| 16, 17, 40 | Disegni salvati come tratti su un foglio di dimensione fissa, uguale su telefono e PC; forme base |
| 18–20, 24 | Bug da non riportare nel prodotto: casella nuova sempre vuota, ritorno ai risultati di ricerca, lista dichiarata per le nuove attività, date in formato italiano |
| 21, 22 | Pagine ordinabili (manuale, data, titolo) e cestino con conservazione per 30 giorni |
| 25–33 | Tutte nella prima versione: immagini, link e tabelle, collegamento note↔attività, esportazione Markdown leggibile, allegati email, smistamento con #parola nell'oggetto, cronologia versioni, preferiti/recenti/etichette, sotto-attività complete |
| 34, 35 | Sessione lunga per l'app installata; sblocco biometrico dove il browser lo consente, PIN breve come alternativa |
| 36–39, 41 | Schede delle sezioni su telefono, aree toccabili da almeno 44 px, barra di formattazione in alto su PC, scorciatoie da tastiera, filtri di ricerca con percorso del risultato |

## Ancora aperto

- Ricezione email: lettura IMAP periodica o webhook di un servizio di posta.
- Su quali browser funziona lo sblocco biometrico senza conservare la chiave sul dispositivo.
