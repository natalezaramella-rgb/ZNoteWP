# ZNoteKeeper – Presentazione commerciale

25 novembre 2026 (aggiornata alla versione 1.6.1) · Versione condivisibile: [Claude Doc](https://claude.ai/artifact/AytSjxAeM5mLcCoR7Zg2rm)

## In sintesi

ZNoteKeeper è il taccuino riservato che vive sul tuo sito WordPress: note, attività, disegni ed email in un'unica app per telefono e PC, cifrate sul dispositivo prima di arrivare al server. Nessuno, nemmeno chi gestisce il sito, può leggere quello che scrivi.

È pensato per chi vuole la comodità di Google Tasks e OneNote senza consegnare i propri appunti a un cloud di terzi. Si installa come un normale plugin, l'amministratore abilita gli utenti e ognuno ha il proprio spazio con la propria password.

**ZNoteKeeper 1.6 è già disponibile** e in uso su un sito reale.

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
| Piccole imprese e studi associati | Uno strumento comune ma con spazi separati per ogni collaboratore | Utenti abilitati dall'admin, dati isolati per persona, password condivisibili tra colleghi con permessi per voce |
| Agenzie web e sistemisti WordPress | Un servizio a valore aggiunto da offrire ai clienti che già gestiscono | Un plugin che si installa in minuti sul sito del cliente, con l'invio sicuro delle credenziali ai propri clienti |
| Famiglie e privati attenti alla privacy | Documenti, password di casa, ricette, scadenze in un posto sicuro | Un taccuino personale sul proprio dominio, senza abbonamenti |
| Associazioni e redazioni | Bozze, verbali e contatti riservati | Email inoltrate che diventano note, ricerca unica |

## Funzionalità principali

Ogni funzione di ZNoteKeeper lavora su dati cifrati: comodità da app moderna, riservatezza da cassaforte.

| Area | Cosa offre |
| --- | --- |
| **Taccuini multipli** | Più raccoglitori separati per lo stesso utente, per esempio Lavoro, Clienti e Famiglia, ognuno con i propri gruppi e sezioni. Sezioni e gruppi si spostano da un taccuino all'altro. |
| **Taccuino** | Note organizzate come un raccoglitore ad anelli: gruppi di sezioni, sezioni colorate, pagine e sottopagine. Preferiti, recenti, etichette, cestino di 30 giorni e cronologia delle versioni. |
| **Editor visuale** | Si scrive come in un programma di videoscrittura: titoli, elenchi, caselle, tabelle, link, immagini. Il testo è salvato in Markdown, aperto e leggibile ovunque. Salvataggio automatico. |
| **Attività** | Liste di cose da fare con scadenza e ora, ripetizioni, sotto-attività, stella, riordino a trascinamento e promemoria. Una casella in una nota può diventare un'attività collegata. Le liste restano sempre raggiungibili, anche quando sono molte. |
| **I miei secrets** | Gestore di password con cartelle, tag, preferiti e generatore, condivisibile voce per voce con i colleghi (vedi sotto). |
| **Foglio segreti** | Una pagina Markdown riservata con salvataggio manuale, versioni precedenti e confronto delle differenze. |
| **Secrets clienti** | Archivio cifrato delle credenziali da consegnare ai clienti e invio con link monouso a scadenza (vedi sotto). |
| **Disegno** | Schizzi a mano libera con dito, pennino, mouse o tavoletta: penna, evidenziatore, forme, gomma, sei colori. Un disegno iniziato sul telefono si continua sul PC. |
| **Email → nota** | Si inoltra un'email a un indirizzo personale e diventa una nota o un'attività. Smistamento con #parola nell'oggetto, solo mittenti autorizzati e verificati (SPF/DKIM). Ricezione via IMAP o webhook. |
| **App per telefono e PC** | PWA installabile su Android, iPhone, Windows e Mac. Su schermo grande, vista a colonne con pannelli richiudibili per scrivere a tutto schermo, e scorciatoie da tastiera. Senza rete si legge e si cerca tutto ciò che è sul dispositivo. |
| **Grafica del sito** | L'app prende da sola colori e caratteri dal tema WordPress (temi a blocchi, Astra, GeneratePress, Kadence, OceanWP e altri), con versione chiara e scura leggibili. L'amministratore può rifinire tutto dalla scheda Aspetto; i caratteri sono ospitati sul sito, senza risorse esterne. |
| **Ricerca unica** | Una sola casella cerca in titoli, testi ed etichette di note e attività, con filtri rapidi. |
| **Portabilità** | Backup completo in un file cifrato ed esportazione delle note in Markdown. |
| **Gestione utenti** | L'amministratore WordPress abilita o disabilita le persone e vede solo lo spazio occupato, mai i contenuti. |

## Novità: Secrets clienti

Con la versione 1.2 ZNoteKeeper diventa anche il modo sicuro per consegnare ai clienti le credenziali dei software che si installano per loro: niente più password in chiaro nelle email.

1. Nella sezione **Secrets clienti** si registrano cliente, email, software, indirizzo, nome utente, password iniziale e note, cifrati come tutto il resto.
2. **Invia accessi** manda al cliente un'email con un modello modificabile, il proprio nome e indirizzo mittente e le risposte dirette alla propria casella.
3. L'email contiene indirizzo e nome utente, e un **link monouso** valido per le ore scelte (da 1 a 720).
4. Il cliente apre il link e preme **Mostra**: vede la password iniziale una sola volta, poi il link smette di funzionare.

**Perché è sicuro**

- La password viene cifrata nel browser con una chiave casuale (AES-256-GCM) che sta solo nella parte del link dopo «#», che i browser non inviano mai al sito.
- Il sito conserva solo l'impronta del link, il testo cifrato e la scadenza, e cancella il cifrato appena il cliente lo legge o il link scade.
- I filtri antispam che aprono i link non lo consumano: serve premere «Mostra».
- Si vede sempre lo stato del link (inviato, letto, scaduto) e con **Invia nuovo link** il precedente viene annullato.
- Massimo 30 invii all'ora per utente, contro gli abusi.

## Novità: I miei secrets

Dalla versione 1.5 ZNoteKeeper include un gestore di password completo, cifrato come le note e condivisibile con i colleghi dello stesso sito.

- **Voci complete**: utente, password, indirizzo, note, tag e campi extra, anche nascosti.
- **Ordine**: cartelle annidate, preferiti, cestino e storico degli ultimi 20 valori di ogni voce.
- **Comodità**: generatore di password e copia negli appunti con pulizia automatica dopo 30 secondi.
- **Condivisione per voce** con gli altri utenti abilitati, in sola lettura o con permesso di modifica, e viste «Condivisi con me» e «Condivisi da me».

**Perché è sicuro**

- Ogni voce ha la propria chiave AES-256, consegnata a ciascun membro cifrata con la sua chiave personale (crittografia a curve ellittiche P-256). Il sito non può leggerla.
- Ogni modifica è firmata da chi la scrive, e l'elenco dei permessi è firmato dal proprietario: il server non può alterare contenuti o permessi senza che ce ne si accorga.
- Quando si toglie l'accesso a qualcuno, la chiave della voce viene cambiata.
- Un **codice di sicurezza** da confrontare di persona conferma che si sta condividendo con l'utente giusto.

Accanto c'è il **Foglio segreti**, una pagina libera in Markdown con salvataggio manuale, versioni precedenti consultabili e confronto delle differenze con quella in corso.

## Sicurezza e riservatezza

La sicurezza è il cuore del prodotto: i dati vengono cifrati nel browser dell'utente, e il server non riceve mai né la password né i contenuti in chiaro.

**Come funziona**

1. L'utente sceglie una **password delle note**, separata da quella di WordPress, che non lascia mai il dispositivo.
2. Dalla password il browser ricava una chiave con **PBKDF2 a 600.000 iterazioni**, il livello raccomandato oggi per le password.
3. Note, attività, disegni ed email vengono cifrati con **AES-256-GCM**, lo standard usato da banche e governi, prima di essere inviati.
4. Nel database di WordPress, nei backup e sul server finiscono solo dati illeggibili.

**Protezioni in più**

- **Verifica in due passaggi (facoltativa)**: ogni utente può attivare un codice a 6 cifre da un'app di autenticazione. Il sito consegna i dati cifrati solo dopo password (o PIN, impronta, «Ricordami») più codice. Dispositivi fidati per 1, 7 o 30 giorni e 10 codici di riserva monouso.
- **Spazi isolati**: ogni utente ha la propria chiave. L'amministratore può abilitare, disabilitare o cancellare uno spazio, ma non aprirlo.
- **Recupero senza backdoor**: un codice di recupero di 24 caratteri, mostrato una volta sola e rigenerato a ogni uso. Il recupero via email è facoltativo e spento di default; se attivato è legato all'indirizzo, monouso, valido 30 minuti e seguito da 24 ore di attesa annullabile.
- **Sblocco biometrico** con impronta o volto su Android e iOS, e blocco automatico dopo un tempo di inattività scelto dall'utente.
- **«Ricordami su questo dispositivo»**: sui dispositivi fidati la chiave resta chiusa da un segreto del browser non esportabile e da una metà consegnata dal sito solo a quel dispositivo. «Blocca», lo scollegamento o un recupero d'accesso la cancellano.
- **Condivisione firmata**: le password condivise hanno una chiave per voce, contenuti e permessi firmati e rotazione della chiave quando si revoca un accesso.
- **Contro i tentativi a forza bruta**: attese crescenti dopo 5 password sbagliate, blocco e avviso via email dopo 10. Ogni tentativo di password, codice o PIN viene contato prima della verifica, così nemmeno richieste in parallelo superano il limite.
- **Conferma per le azioni delicate**: cambio password, nuovo codice, dispositivi e backup richiedono di nuovo la password.
- **Notifiche discrete**: i promemoria inviati dal server non contengono i titoli, perché il server non li conosce.
- **Email chiuse all'arrivo**: un'email inoltrata viene cifrata appena arriva e cancellata dalla casella. Si accettano solo allegati immagine e PDF, e la verifica del mittente usa solo l'esito scritto dal proprio server di posta.
- **App verificata e senza risorse esterne**: l'app installata usa i file salvati sul dispositivo solo se la loro impronta digitale corrisponde a quella attesa, e non carica nulla da siti terzi.
- **Revisione di sicurezza**: il codice è stato sottoposto a una revisione dedicata, e le correzioni sono incluse dalla versione 1.2.2.

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

## Novità recenti

In un giorno ZNoteKeeper è passato dalla 1.0 alla 1.6, con funzioni già pubblicate e in uso.

| Versione | Novità |
| --- | --- |
| 1.6.1 | Caratteri e logo caricati correttamente su qualsiasi configurazione del sito |
| 1.6.0 | Verifica in due passaggi facoltativa per utente |
| 1.5.0 | I miei secrets: gestore di password condivisibile. «Accessi» diventa «Secrets clienti» |
| 1.4.0–1.4.2 | Grafica presa dal tema del sito, scheda Aspetto, caratteri ospitati sul sito |
| 1.3.0 | Foglio segreti con versioni e confronto delle differenze |
| 1.2.0–1.2.2 | Accessi per i clienti con link monouso, correzioni dalla revisione di sicurezza |
| 1.1.0–1.1.2 | Taccuini multipli, pannelli richiudibili, «Ricordami su questo dispositivo», liste Attività sempre raggiungibili |

## Come iniziare

Si parte in pochi minuti su qualsiasi sito WordPress 6.2 o successivo con PHP 7.4 o superiore.

1. Installa il plugin ZNoteKeeper dal pannello di WordPress e attivalo.
2. Da **Utenti › ZNoteKeeper** abilita le persone che lo useranno.
3. Ogni utente apre ZNoteKeeper, sceglie la propria password delle note e salva il codice di recupero.
4. Installa l'app su telefono e PC e, se vuole, attiva lo sblocco con impronta o volto.
5. Facoltativo: configura la casella email (IMAP o webhook) per trasformare le email inoltrate in note.

Per una dimostrazione, un preventivo o l'installazione sul vostro sito: _[contatti da inserire]_.
