=== ZNoteKeeper ===
Requires at least: 6.2
Requires PHP: 7.4
Stable tag: 1.6.0
License: GPLv2 or later

Taccuino (gruppi › sezioni › pagine) e attività in stile Google Tasks, cifrati nel browser, usabili come app (PWA) su telefono e PC.

== Installazione ==

1. Plugin › Aggiungi nuovo › Carica plugin: carica znotekeeper.zip e attiva.
2. Utenti › ZNoteKeeper: abilita gli utenti che possono usarlo. Ricevono un'email con il link.
3. L'utente apre /znotekeeper/ (o la voce "ZNoteKeeper" nella barra in alto), sceglie la password delle note
   e salva il codice di recupero. La password non lascia mai il dispositivo.
4. Su telefono: menu del browser › "Aggiungi a schermata Home" / "Installa app". Su PC: icona "Installa" nella barra dell'indirizzo.

Serve HTTPS (la cifratura del browser, il service worker e le notifiche funzionano solo su HTTPS).

== Cifratura ==

* Tutti i contenuti (titoli, testi, disegni, immagini, email importate) sono cifrati nel browser con AES-256-GCM prima di arrivare al sito.
  In chiaro restano solo: tipo di elemento, struttura (cartella padre, ordine), date di scadenza/promemoria, stato completato, dimensioni.
* Chiave principale casuale, protetta da: password delle note (PBKDF2 600.000 iterazioni), codice di recupero di 24 caratteri
  e, se attivo, il recupero via email.
* Il recupero via email è legato all'indirizzo e alla password di WordPress: se cambiano, smette di funzionare e va riattivato.
  Dopo la conferma del link c'è un'attesa di sicurezza di 24 ore, con avviso via email e possibilità di annullare.
* Sblocco con impronta/volto: WebAuthn con estensione PRF. Funziona su Android (Chrome) e su iPhone/iPad con iOS 18 o successivi
  (Safari o app installata), su PC con Windows Hello o Touch ID dove il browser lo supporta.

== Verifica in due passaggi ==

Facoltativa, la attiva ogni utente da Impostazioni › Sicurezza. Usa un'app di autenticazione (TOTP a 6 cifre: Google Authenticator, Microsoft Authenticator, Aegis, 1Password…).

* Il sito consegna la cassaforte e apre la sessione solo dopo password delle note (o PIN, impronta, «Ricordami») più il codice.
* Ogni dispositivo può restare fidato per 1, 7 o 30 giorni, oppure si può chiedere il codice a ogni sblocco.
* 10 codici di riserva monouso. Chi perde telefono e codici rientra con il codice di recupero di 24 caratteri, che spegne la verifica.
* Il segreto TOTP è cifrato con la chiave del sito; i codici di riserva sono conservati come impronte. I tentativi sono limitati come per la password.
* Limiti: senza rete le note già scaricate si aprono in sola lettura con la sola password; non protegge da chi amministra il sito.

== Email → nota ==

Ogni utente ha un indirizzo personale del tipo  casella+codice@tuodominio.it.
Si inoltra lì un'email: oggetto → titolo, corpo → testo, immagini e PDF fino a 5 MB → allegati cifrati.
Il sito cifra subito il messaggio con la chiave pubblica dell'utente e lo cancella: solo l'app può leggerlo.
Sono accettati solo i mittenti che l'utente ha aggiunto in Impostazioni.

Configurazione in Utenti › ZNoteKeeper › Email → nota. Due modi:

1) IMAP (il più semplice)
   * Crea una casella dedicata, es. note@tuodominio.it, che accetti il "plus addressing" (note+qualcosa@ arriva in note@).
     Gmail, Google Workspace, Microsoft 365, Fastmail lo supportano; su cPanel/Plesk di solito sì
     (in alternativa crea un "catch-all"/inoltro per note-*).
   * Inserisci server IMAP (es. imap.tuodominio.it), porta 993, SSL, utente e password della casella, cartella INBOX.
   * Il sito controlla la casella ogni 5 minuti e cancella i messaggi dopo averli importati.
   * WP-Cron parte solo quando qualcuno visita il sito: per avere controlli regolari aggiungi un cron di sistema
     (pannello dell'hosting), es. ogni 5 minuti:
       wget -q -O - https://tuodominio.it/wp-cron.php?doing_wp_cron >/dev/null 2>&1
     e, facoltativo, in wp-config.php:  define('DISABLE_WP_CRON', true);
   * Gmail: serve una "password per le app" (account con verifica in due passaggi).

2) Webhook (immediato)
   * Un servizio di posta in arrivo inoltra il messaggio grezzo (MIME) con una POST all'URL mostrato nella pagina,
     che contiene la chiave segreta (?key=...).
   * Esempi: Cloudflare Email Routing + Email Worker (fetch POST di message.raw), Mailgun Routes ("store and notify" o
     forward con campo body-mime), SendGrid Inbound Parse (opzione "raw").
   * Campi accettati: corpo grezzo della richiesta oppure campi raw / email / body-mime / mime; destinatario in to / recipient.

Controllo SPF/DKIM: se attivo (consigliato), si accettano solo email con esito "pass" nell'intestazione
Authentication-Results aggiunta dal server di posta.

== Accessi clienti ==

Nella sezione «Accessi» dell'app si registrano gli accessi da dare ai clienti (cliente, email, software, indirizzo, nome utente, password iniziale), cifrati come le note.
«Invia accessi» manda al cliente un'email (modello modificabile, con segnaposto {cliente} {software} {indirizzo} {utente} {link} {scadenza} {ore} {mittente}) con indirizzo, nome utente e un link monouso valido per le ore scelte.
Il link apre /znotekeeper/access/: la password si vede una sola volta, premendo «Mostra». Con «Invia nuovo link» si manda un nuovo link e il precedente smette di funzionare.
Sicurezza: il browser cifra i dati da mostrare con una chiave casuale (AES-256-GCM) che sta solo nella parte del link dopo «#», che i browser non mandano al sito. Il sito non salva la chiave: conserva l'impronta del token, il testo cifrato e la scadenza, e cancella il cifrato appena il cliente lo legge o il link scade. Aprire il link senza premere «Mostra» (come fanno i filtri antispam) non lo consuma.
L'email parte da WordPress (wp_mail) con il nome e l'indirizzo mittente scelti nel modello (l'indirizzo deve essere del dominio del sito); le risposte vanno all'email del tuo utente del sito. Massimo 30 invii all'ora per utente.

== Aspetto ==

L'app prende da sola colori e caratteri dal tema del sito: stili globali dei temi a blocchi (theme.json e modifiche fatte nell'Editor del sito), tavolozza del tema, Astra, GeneratePress, Kadence, OceanWP e lo sfondo del Personalizza. Da sfondo, testo e colore principale ricava la versione chiara e quella scura con contrasto leggibile. Anche la pagina dei dati di accesso per i clienti usa questi colori.

In Utenti › ZNoteKeeper › Aspetto l'amministratore vede cosa è stato trovato, può correggere ogni valore, scegliere l'icona del sito come logo, tornare ai colori originali di ZNoteKeeper e usare «Rileva dalla home page» per i temi costruiti con page builder. I caratteri si usano solo se i loro file stanno sul sito stesso: l'app non carica risorse esterne. Se il tema usa Google Fonts, il pulsante «Ospita i caratteri sul sito» li scarica una volta in wp-content/uploads/znotekeeper-fonts/ e l'app li usa da lì, senza contattare Google.

== Notifiche ==

Le notifiche push dei promemoria sono senza contenuto ("Hai un'attività in scadenza"): il sito non conosce i titoli.
Su iPhone servono iOS 16.4+ e l'app installata nella schermata Home.

== Disinstallazione ==

Eliminando il plugin dalla pagina Plugin si cancellano tabelle e impostazioni (tutti i dati degli utenti).
