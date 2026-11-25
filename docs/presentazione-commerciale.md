# ZNoteKeeper – Presentazione commerciale

25 novembre 2026 · Versione condivisibile: [Claude Doc](https://claude.ai/artifact/AytSjxAeM5mLcCoR7Zg2rm)

## In sintesi

ZNoteKeeper è il taccuino riservato che vive sul tuo sito WordPress: note, attività, disegni ed email in un'unica app per telefono e PC, cifrate sul dispositivo prima di arrivare al server. Nessuno, nemmeno chi gestisce il sito, può leggere quello che scrivi.

È pensato per chi vuole la comodità di Google Tasks e OneNote senza consegnare i propri appunti a un cloud di terzi. Si installa come un normale plugin, l'amministratore abilita gli utenti e ognuno ha il proprio spazio con la propria password.

**ZNoteKeeper 1.0.1 è già disponibile** e in uso su un sito reale.

## Il problema

Le informazioni più delicate finiscono spesso nei posti meno adatti: un'app di note gratuita, un foglio condiviso, una chat con sé stessi.

- **Dati su server altrui.** I servizi cloud diffusi possono leggere, analizzare o consegnare i contenuti, e le condizioni d'uso cambiano senza preavviso.
- **Strumenti sparsi.** Attività in un'app, note in un'altra, email importanti sepolte nella casella: nessun posto unico dove ritrovare tutto.
- **Riservatezza solo dichiarata.** Molte soluzioni «private» cifrano i dati sul server con chiavi che il fornitore conserva: chi ha accesso al server ha accesso ai dati.
- **Dipendenza dal fornitore.** Formati chiusi e abbonamenti rendono difficile portare via i propri appunti.

## La soluzione

ZNoteKeeper riunisce in un solo posto, sul tuo sito, tutto ciò che oggi richiede tre o quattro app diverse, e lo tiene sotto chiave.

- **Un'unica app** per note, attività, disegni ed email importate, con ricerca su tutto.
- **Sul tuo WordPress**: nessun servizio esterno, nessun abbonamento a terzi, i dati restano nel database che già controlli.
- **Cifratura end-to-end**: i contenuti vengono chiusi nel browser con una password che conosce solo l'utente. Il server custodisce dati illeggibili.
- **Come un'app vera**: si installa su telefono e PC (PWA), si apre a schermo intero e si sblocca con impronta o volto.
- **Formato aperto**: il testo è in Markdown ed è esportabile in qualsiasi momento.

## A chi si rivolge

ZNoteKeeper è per chi ha già un sito WordPress e tratta informazioni che non devono uscire dal proprio controllo.

| Pubblico | Esigenza tipica | Cosa ottiene |
| --- | --- | --- |
| Professionisti (avvocati, commercialisti, medici, consulenti) | Appunti su clienti e pratiche soggetti a segreto professionale | Note cifrate che nemmeno il fornitore del sito può leggere |
| Piccole imprese e studi associati | Uno strumento comune ma con spazi separati per ogni collaboratore | Utenti abilitati dall'admin, dati isolati per persona |
| Agenzie web e sistemisti WordPress | Un servizio a valore aggiunto da offrire ai clienti che già gestiscono | Un plugin che si installa in minuti sul sito del cliente |
| Famiglie e privati attenti alla privacy | Documenti, password di casa, ricette, scadenze in un posto sicuro | Un taccuino personale sul proprio dominio, senza abbonamenti |
| Associazioni e redazioni | Bozze, verbali e contatti riservati | Email inoltrate che diventano note, ricerca unica |

## Funzionalità principali

Ogni funzione di ZNoteKeeper lavora su dati cifrati: comodità da app moderna, riservatezza da cassaforte.

| Area | Cosa offre |
| --- | --- |
| **Taccuino** | Note organizzate come un raccoglitore ad anelli: gruppi di sezioni, sezioni colorate, pagine e sottopagine. Preferiti, recenti, etichette, cestino di 30 giorni e cronologia delle versioni. |
| **Editor visuale** | Si scrive come in un programma di videoscrittura: titoli, elenchi, caselle, tabelle, link, immagini. Il testo è salvato in Markdown, aperto e leggibile ovunque. Salvataggio automatico. |
| **Attività** | Liste di cose da fare con scadenza e ora, ripetizioni, sotto-attività, stella, riordino a trascinamento e promemoria. Una casella in una nota può diventare un'attività collegata. |
| **Disegno** | Schizzi a mano libera con dito, pennino, mouse o tavoletta: penna, evidenziatore, forme, gomma, sei colori. Un disegno iniziato sul telefono si continua sul PC. |
| **Email → nota** | Si inoltra un'email a un indirizzo personale e diventa una nota o un'attività. Smistamento con #parola nell'oggetto, solo mittenti autorizzati e verificati (SPF/DKIM). Ricezione via IMAP o webhook. |
| **App per telefono e PC** | PWA installabile su Android, iPhone, Windows e Mac. Su schermo grande, vista a colonne e scorciatoie da tastiera. Senza rete si legge e si cerca tutto ciò che è sul dispositivo. |
| **Ricerca unica** | Una sola casella cerca in titoli, testi ed etichette di note e attività, con filtri rapidi. |
| **Portabilità** | Backup completo in un file cifrato ed esportazione delle note in Markdown. |
| **Gestione utenti** | L'amministratore WordPress abilita o disabilita le persone e vede solo lo spazio occupato, mai i contenuti. |

## Sicurezza e riservatezza

La sicurezza è il cuore del prodotto: i dati vengono cifrati nel browser dell'utente, e il server non riceve mai né la password né i contenuti in chiaro.

**Come funziona**

1. L'utente sceglie una **password delle note**, separata da quella di WordPress, che non lascia mai il dispositivo.
2. Dalla password il browser ricava una chiave con **PBKDF2 a 600.000 iterazioni**, il livello raccomandato oggi per le password.
3. Note, attività, disegni ed email vengono cifrati con **AES-256-GCM**, lo standard usato da banche e governi, prima di essere inviati.
4. Nel database di WordPress, nei backup e sul server finiscono solo dati illeggibili.

**Protezioni in più**

- **Spazi isolati**: ogni utente ha la propria chiave. L'amministratore può abilitare, disabilitare o cancellare uno spazio, ma non aprirlo.
- **Recupero senza backdoor**: un codice di recupero di 24 caratteri, mostrato una volta sola e rigenerato a ogni uso. Il recupero via email è facoltativo e spento di default; se attivato è legato all'indirizzo, monouso, valido 30 minuti e seguito da 24 ore di attesa annullabile.
- **Sblocco biometrico** con impronta o volto su Android e iOS, e blocco automatico dopo un tempo di inattività scelto dall'utente.
- **Contro i tentativi a forza bruta**: attese crescenti dopo 5 password sbagliate, blocco e avviso via email dopo 10.
- **Conferma per le azioni delicate**: cambio password, nuovo codice, dispositivi e backup richiedono di nuovo la password.
- **Notifiche discrete**: i promemoria inviati dal server non contengono i titoli, perché il server non li conosce.
- **Email chiuse all'arrivo**: un'email inoltrata viene cifrata appena arriva e cancellata dalla casella.

**Detto con onestà.** ZNoteKeeper protegge da furti del database, backup sottratti, accessi al server e amministratori curiosi. Come ogni applicazione web, presuppone che il codice del sito non venga manomesso di proposito: per questo va installato su un sito di cui ci si fida. Se si perdono sia la password sia il codice di recupero, i dati non si possono più aprire: è la garanzia che nessun altro abbia una copia della chiave.

## Perché sceglierlo

Rispetto alle app di note cloud più diffuse, ZNoteKeeper offre le stesse comodità quotidiane con un controllo sui dati che quelle non danno.

|  | App di note cloud tipiche | ZNoteKeeper |
| --- | --- | --- |
| Dove stanno i dati | Sui server del fornitore | Sul tuo sito WordPress |
| Chi può leggerli | Il fornitore, in molti casi | Solo l'utente, con la sua password |
| Note + attività + disegni + email | Spesso in app separate | In un'unica app, con ricerca unica |
| Formato | Spesso proprietario | Markdown aperto, esportabile |
| Costi | Abbonamento per utente | Nessun canone verso terzi |
| Utenti di un'organizzazione | Account sul servizio esterno | Gli utenti WordPress che già esistono |

**Vantaggi in breve**

- **Conformità più semplice**: i dati restano nell'infrastruttura scelta dall'organizzazione e sono cifrati, un argomento forte per GDPR e segreto professionale.
- **Zero integrazioni da costruire**: usa gli utenti, l'hosting e i backup del sito esistente.
- **Un'abitudine, non un progetto**: interfaccia familiare a chi usa già liste di attività e taccuini digitali, nessuna formazione.
- **Libertà di uscita**: le note si esportano in file leggibili da qualsiasi programma.

## In arrivo

Le prossime novità, già in sviluppo, rendono ZNoteKeeper ancora più adatto a chi organizza molti ambiti di lavoro.

- **Taccuini multipli**: più raccoglitori separati per lo stesso utente, per esempio Lavoro, Clienti e Famiglia, ognuno con i propri gruppi e sezioni.
- **Pannelli richiudibili**: sul PC l'albero delle sezioni e l'elenco delle pagine si chiudono per lasciare tutto lo schermo alla scrittura.
- **«Ricordami su questo dispositivo»**: sui dispositivi personali e fidati lo sblocco diventa ancora più rapido, senza rinunciare alla cifratura.

## Come iniziare

Si parte in pochi minuti su qualsiasi sito WordPress 6.0 o successivo con PHP 7.4 o superiore.

1. Installa il plugin ZNoteKeeper dal pannello di WordPress e attivalo.
2. Da **Utenti › ZNoteKeeper** abilita le persone che lo useranno.
3. Ogni utente apre ZNoteKeeper, sceglie la propria password delle note e salva il codice di recupero.
4. Installa l'app su telefono e PC e, se vuole, attiva lo sblocco con impronta o volto.
5. Facoltativo: configura la casella email (IMAP o webhook) per trasformare le email inoltrate in note.

Per una dimostrazione, un preventivo o l'installazione sul vostro sito: _[contatti da inserire]_.
