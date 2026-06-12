# 📦 Saica Pack Italia - Sistema Prenotazioni Carichi

Sistema web completo per la gestione delle prenotazioni di carichi su camion con pannello amministrativo.

## 🎯 Caratteristiche

✅ **Prenotazioni Cliente**
- Form semplice e intuitivo
- Selezione data e orario (slot 30 minuti)
- 2 baie disponibili: Scatole e Fogli
- Orari: Lunedì-Venerdì, 06:00-19:30
- Notifiche via email
- Responsive mobile, tablet e PC

✅ **Pannello Admin**
- Login sicuro con username/password
- Visualizzazione prenotazioni giornaliere
- Modifica e elimina prenotazioni
- Calendario completo
- Statistiche e report
- Export dati
- Report giornaliero via email

✅ **Backend**
- API REST con Node.js + Express
- Database PostgreSQL
- Autenticazione JWT
- Sistema email automatico (Nodemailer)
- Notifiche di conferma/cancellazione

---

## 🚀 Installazione

### 1️⃣ Prerequisites
- Node.js (v14+)
- PostgreSQL (v12+)
- npm o yarn

### 2️⃣ Setup Database

```bash
# Connettiti a PostgreSQL
psql -U postgres

# Esegui lo script di setup
\i backend/database.sql
```

### 3️⃣ Setup Backend

```bash
# Entra nella cartella backend
cd backend

# Installa dipendenze
npm install

# Crea file .env
cp .env.example .env

# Modifica .env con i tuoi dati
# - Database
# - Email (Gmail con app password)
# - Credenziali admin
```

**File `.env` deve contenere:**
```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=saica_prenotazioni
DB_USER=postgres
DB_PASSWORD=your-password

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=giacomo.rigamonti@saica.com
SMTP_PASSWORD=your-app-password

ADMIN_USERNAME=giacomo
ADMIN_PASSWORD=admin123
JWT_SECRET=your-secret-key-change-in-production
```

### 4️⃣ Avvia il Server

```bash
npm start
# oppure per development con hot-reload
npm run dev
```

Server avviato su: **http://localhost:3000**

---

## 📱 Utilizzo

### Per i Clienti
1. Apri `booking.html` nel browser
2. Compila il form con i dati
3. Seleziona data e baia
4. Scegli orario (slot occupati non disponibili)
5. Conferma prenotazione
6. Ricevi email di conferma

### Per l'Amministratore
1. Apri `admin.html` nel browser
2. Login con credenziali:
   - Username: `giacomo`
   - Password: `admin123`
3. Dashboard mostra:
   - **Oggi**: Prenotazioni della giornata
   - **Calendario**: Tutte le prenotazioni filtrabili
   - **Statistiche**: Dati aggregati
   - **Esporta**: CSV e report email

---

## 🔧 API Endpoints

### Prenotazioni (Public)

```
POST   /api/booking              → Nuova prenotazione
GET    /api/booked-slots         → Slot occupati per data/baia
```

### Admin (Richiede autenticazione JWT)

```
POST   /api/admin/login          → Login admin
GET    /api/today-bookings       → Prenotazioni oggi
GET    /api/bookings             → Prenotazioni per periodo
PUT    /api/booking/:id          → Modifica prenotazione
DELETE /api/booking/:id          → Elimina prenotazione
GET    /api/daily-report         → Report giornaliero
POST   /api/send-report          → Invia report via email
```

---

## 📧 Configurazione Email (Gmail)

1. Attiva **2-Factor Authentication** su Gmail
2. Genera **App Password** in [Google Account Settings](https://myaccount.google.com/apppasswords)
3. Usa l'app password nel file `.env`

---

## 📁 Struttura Progetto

```
sito-prenotazioni/
├── booking.html              # Pagina prenotazioni utenti
├── admin.html                # Pannello amministratore
├── index.html                # Login (legacy)
├── backend/
│   ├── server.js             # API server
│   ├── database.sql          # Setup PostgreSQL
│   ├── package.json          # Dipendenze
│   └── .env.example          # Template configurazione
└── README.md                 # Questo file
```

---

## 🔐 Sicurezza

- Autenticazione JWT per admin
- Password hashing pronto (da implementare)
- CORS configurato
- SQL injection protection (prepared statements)
- Rate limiting consigliato per produzione

---

## 🐛 Troubleshooting

### Errore: "ECONNREFUSED" (Database)
```
→ Controlla che PostgreSQL sia avviato
→ Verifica credenziali in .env
```

### Errore: "Invalid SMTP credentials"
```
→ Verifica email e app password in .env
→ Attiva 2FA su Gmail
```

### Slot occupati non si aggiornano
```
→ Ricarica la pagina (F5)
→ Controlla console browser per errori
```

---

## 📞 Contatti

- **Email Admin**: giacomo.rigamonti@saica.com
- **Azienda**: Saica Pack Italia SPA

---

## 📝 Changelog

### v1.0.0 (2026-06-12)
- ✅ Interfaccia prenotazioni responsive
- ✅ Pannello admin completo
- ✅ API backend con Node.js
- ✅ Database PostgreSQL
- ✅ Sistema email automatico
- ✅ Autenticazione admin

---

## 🚀 Prossimi Miglioramenti

- [ ] Payment integration
- [ ] Multi-language support
- [ ] Mobile app native
- [ ] SMS notifications
- [ ] Dashboard analytics avanzate
- [ ] Calendar sync (Google Calendar)

---

**Creato con ❤️ per Saica Pack Italia**
