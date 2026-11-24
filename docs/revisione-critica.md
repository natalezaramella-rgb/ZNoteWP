# ZNoteKeeper – Revisione critica

24 novembre 2026 · Revisione di `presentazione-utente.md` e del mockup (versione condivisibile: [Claude Doc](https://claude.ai/artifact/EnyXQu9SPebkqacW4U2hfh))

Il materiale regge come idea di prodotto, ma promette più riservatezza di quanta il progetto attuale possa garantire, e al mockup mancano alcune funzioni di base (cestino, riordino delle pagine, immagini, link). Qui sotto 41 punti, dal più grave al meno grave.

## 1. Promesse di sicurezza che oggi non reggono

La presentazione dice che «nemmeno l'amministratore può leggere le note». Con il progetto descritto finora questo è vero solo in parte, e va corretto prima dell'analisi perché condiziona tutta l'architettura.

| N. | Difetto | Perché conta | Correzione proposta |
| --- | --- | --- | --- |
| 1 | L'amministratore può aggirare il recupero via email | In WordPress l'admin può cambiare email e password di qualsiasi utente. Con il link attivo può farsi mandare il recupero e, dopo 24 ore, aprire le note | Legare il recupero all'indirizzo presente quando lo si attiva. Se email o password WordPress cambiano, il recupero si spegne e l'utente viene avvisato |
| 2 | Il documento si contraddice sulla copia della chiave | Dice che nessuno ha una copia della chiave, ma il link via email funziona solo se il server ne custodisce una | Dichiararlo: con il link attivo il sito conserva una copia protetta della chiave. Senza link, nessuna copia |
| 3 | «L'admin non può leggere» vale solo contro chi guarda il database | Chi controlla il server può modificare il codice dell'app e catturare la password al prossimo sblocco | Scrivere la promessa onesta: protegge da furto del database, backup rubati e admin curiosi, non da un admin malintenzionato che altera il plugin |
| 4 | Non è deciso dove avviene la cifratura | Se cifra il server, la password viaggia fino a lui a ogni sblocco. Se cifra il browser, il server non la vede mai | Cifratura nel browser. È l'unica scelta coerente con le promesse fatte |
| 5 | Nessun limite ai tentativi di sblocco | Chi ruba il telefono o il database può provare password all'infinito | Attesa crescente dopo 5 errori, blocco e avviso dopo 10, derivazione lenta della chiave |
| 6 | Azioni delicate senza richiesta della password | Nel mockup chi trova l'app aperta genera un nuovo codice di recupero, attiva il link email o scollega dispositivi con un tocco | Chiedere di nuovo la password per codice, link, cambio password, dispositivi e backup |
| 7 | I mittenti ammessi sono facili da falsificare | Il mittente di un'email si può contraffare: chi conosce l'indirizzo può riempirti di note false | Verificare SPF e DKIM, limite di email all'ora, pulsante per rigenerare l'indirizzo personale |
| 8 | L'email non è riservata durante il viaggio | Il documento dice che l'email è «chiusa appena arriva», ma prima passa in chiaro dal tuo provider e dalla casella del sito | Dirlo all'utente e cancellare il messaggio dalla casella subito dopo l'importazione |
| 9 | I promemoria non possono mostrare il titolo | Se il server non legge i titoli, la notifica può dire solo «hai un'attività in scadenza» | Decidere: notifica generica, oppure promemoria creati dal dispositivo, che funzionano solo se l'app è stata aperta di recente |

## 2. Incoerenze tra documento e mockup

| N. | Incoerenza | Documento | Mockup | Correzione proposta |
| --- | --- | --- | --- | --- |
| 10 | Dove si gestiscono gli utenti | Pannello WordPress, Utenti › ZNoteKeeper | Schermata dentro l'app, da Impostazioni | Tenerla nel pannello WordPress. Nell'app resta solo un collegamento per gli admin |
| 11 | Cancellazione dello spazio di un utente | L'admin può cancellarlo | Esiste solo l'interruttore abilita/disabilita, senza conferma | Aggiungere «Cancella spazio» con conferma scritta e conferma anche sulla disabilitazione |
| 12 | Salvataggio del codice di recupero | Stampa, download o gestore di password | Solo il pulsante Copia | Aggiungere Stampa e Scarica, più una casella «ho capito che senza codice posso perdere tutto» |
| 13 | Funzionamento senza rete | «Funziona anche senza rete» e, più sotto, «mostra le note già scaricate» | Nessuno stato offline visibile | Decidere se offline si può anche scrivere. Se sì, serve una regola per quando telefono e PC modificano la stessa nota |
| 14 | Cambio password e backup | Descritti come funzioni | Righe non cliccabili | Mockare i due flussi, incluso il ripristino da backup che oggi non è descritto da nessuna parte |
| 15 | Dettagli delle attività | «Salvati in Markdown» | Campo di testo semplice, mentre le pagine hanno l'editor visuale | Usare lo stesso editor, in versione ridotta, anche nelle attività |

## 3. Bug e limiti del mockup

Il punto 18 è stato riprodotto nel browser, gli altri derivano dalla lettura del codice.

| N. | Difetto | Effetto | Correzione proposta |
| --- | --- | --- | --- |
| 16 | Un disegno riaperto viene salvato come immagine sopra l'immagine | Ogni modifica lo sgrana un po'. Un disegno fatto sul telefono riaperto sul PC risulta piccolo al centro del foglio | Salvare i tratti, non l'immagine, su un foglio di dimensione fissa con zoom |
| 17 | La gomma cancella anche lo sfondo di un disegno riaperto | Restano buchi bianchi invece di togliere solo i tratti | Stessa soluzione del punto 16 |
| 18 | Una casella nuova creata dopo una già spuntata nasce spuntata | Premendo Invio la nuova riga eredita lo stato della precedente | La nuova riga deve nascere sempre vuota |
| 19 | Dalla ricerca, aprendo una pagina e tornando indietro si finisce nel Taccuino | Si perde la ricerca fatta | Tornare ai risultati |
| 20 | Una nuova attività creata da «Speciali» finisce nella prima lista senza dirlo | L'utente non sa dove è andata | Chiedere la lista, o mostrarla nel messaggio di conferma |
| 21 | Le pagine non si possono riordinare né sono ordinate per data | Una pagina modificata oggi resta in fondo | Ordine manuale con trascinamento, più ordinamento per data o titolo |
| 22 | Eliminare una pagina è definitivo dopo 4 secondi | Un tocco sbagliato e la nota è persa | Cestino con conservazione per 30 giorni |
| 23 | Su telefono vero la guida del mockup è difficile da raggiungere | L'app occupa tutto lo schermo e trattiene lo scorrimento | Pulsante «Guida» fisso che apre le note in un pannello |
| 24 | Le date nei campi compaiono in formato americano | 11/28/2026 invece di 28/11/2026 | Selettore di data proprio, in italiano |

## 4. Funzioni mancanti

| N. | Funzione | Perché serve | Peso |
| --- | --- | --- | --- |
| 25 | Immagini e foto nelle note | È la prima cosa che si incolla in un taccuino. Oggi entrano solo i disegni | Alto |
| 26 | Link e tabelle nell'editor | Markdown li prevede e gli utenti li usano. Mancano i pulsanti | Alto |
| 27 | Collegamento tra note e attività | Trasformare una casella di una pagina in attività con scadenza, e aprire la pagina dall'attività | Alto |
| 28 | Esportazione leggibile | Esiste solo il backup cifrato. Serve anche un archivio di file Markdown in chiaro, per non restare legati al plugin | Alto |
| 29 | Allegati delle email | Oggi sono scartati in silenzio. Almeno elencarne i nomi nella nota, meglio importare PDF e immagini | Medio |
| 30 | Smistamento delle email | Un'unica destinazione per tutto. Con una parola nell'oggetto, per esempio #lavoro, la nota andrebbe nella sezione giusta | Medio |
| 31 | Cronologia delle versioni di una pagina | Con il salvataggio automatico un errore sovrascrive il testo buono | Medio |
| 32 | Preferiti, recenti ed etichette | Con molte sezioni l'albero non basta a ritrovare le note usate ogni giorno | Medio |
| 33 | Sotto-attività complete | Non si riordinano, non hanno scadenza propria e non si possono promuovere ad attività | Basso |

## 5. Usabilità

| N. | Problema | Dove | Miglioramento proposto |
| --- | --- | --- | --- |
| 34 | Due accessi di fila: prima WordPress, poi la password delle note | Telefono e PC | Sessione lunga per l'app installata, così all'apertura si chiede solo lo sblocco. La sessione WordPress normale scade dopo pochi giorni |
| 35 | Lo sblocco con impronta non è garantito su tutti i dispositivi | Telefono e PC | Verificare nell'analisi su quali browser funziona e prevedere un PIN breve come alternativa |
| 36 | Cambiare sezione richiede due tocchi e un pannello | Telefono | Scorrimento laterale tra le sezioni del gruppo, o schede delle sezioni in alto |
| 37 | Bersagli piccoli: il cerchio per completare è di 30 px, le maniglie sono strette | Telefono | Portare tutte le aree toccabili ad almeno 44 px e aggiungere lo scorrimento laterale per completare o eliminare |
| 38 | Barra di formattazione in fondo alla pagina | PC | In alto, sopra il testo, con più comandi visibili. Sul telefono deve restare sopra la tastiera |
| 39 | Poche scorciatoie da tastiera | PC | Nuova pagina, nuova attività, passaggio tra i pannelli, e trascinamento di pagine e attività tra sezioni e liste |
| 40 | Il disegno non ha zoom né spostamento e il foglio è grande quanto lo schermo | Telefono e PC | Zoom con due dita, foglio che si allunga, forme base e testo |
| 41 | La ricerca non filtra e non dice dove ha trovato | Telefono e PC | Filtri per sezione, lista, data e «con disegni», più il percorso completo accanto a ogni risultato |

## 6. Cosa correggere prima dell'analisi

1. **Decidere il modello di sicurezza** (punti 1–4 e 9). Proposta: cifratura nel browser, recupero via email spento di default e legato all'indirizzo, promessa riscritta in modo onesto.
2. **Decidere l'offline** (punto 13): sola lettura oppure anche scrittura con regola per i conflitti.
3. **Correggere la presentazione** sui punti 2, 3, 8, 10 e 12, così non promette più di quanto si può mantenere.
4. **Scegliere le funzioni della prima versione** tra i punti 25–33. Proposta: 25, 26, 27, 28 e il cestino del punto 22 dentro, il resto in una seconda versione.
5. **Aggiornare il mockup** con le protezioni dei punti 5 e 6, i bug dei punti 16–24 e i miglioramenti 36–39.
