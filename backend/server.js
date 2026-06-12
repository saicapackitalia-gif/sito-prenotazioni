require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => console.error('Database error:', err));

// Middleware autenticazione
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Non autorizzato' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Token non valido' });
    }
};

// LOGIN
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '24h' });
        return res.json({ token, message: '✅ Login OK' });
    }

    res.status(401).json({ message: '❌ Credenziali errate' });
});

// POST: Nuova prenotazione
app.post('/api/booking', async (req, res) => {
    const { email, name, phone, date, bay, time } = req.body;

    try {
        if (!email || !name || !phone || !date || !bay || !time) {
            return res.status(400).json({ message: 'Campi obbligatori mancanti' });
        }

        const existing = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 AND bay = $2 AND time = $3 AND status != $4',
            [date, bay, time, 'cancelled']
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ message: '❌ Slot non disponibile' });
        }

        const id = uuidv4();
        await pool.query(
            'INSERT INTO bookings (id, email, name, phone, date, time, bay, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [id, email, name, phone, date, bay, time, 'confirmed']
        );

        await sendConfirmationEmail(email, name, date, time, bay);

        res.json({ id, message: '✅ Prenotazione confermata! Controlla email.' });
    } catch (error) {
        console.error('Errore booking:', error);
        res.status(500).json({ message: '❌ Errore nel server' });
    }
});

// GET: Slot disponibili
app.get('/api/booked-slots', async (req, res) => {
    const { date, bay } = req.query;

    try {
        if (!date || !bay) {
            return res.status(400).json({ message: 'date e bay sono obbligatori' });
        }

        const result = await pool.query(
            'SELECT time FROM bookings WHERE date = $1 AND bay = $2 AND status = $3 ORDER BY time',
            [date, bay, 'confirmed']
        );

        const bookedTimes = result.rows.map(row => row.time.substring(0, 5));
        res.json(bookedTimes);
    } catch (error) {
        console.error('Errore:', error);
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// GET: Prenotazioni di oggi (admin)
app.get('/api/today-bookings', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await pool.query(
            'SELECT id, email, name, phone, date, time, bay, status FROM bookings WHERE date = $1 AND status = $2 ORDER BY time',
            [today, 'confirmed']
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Errore:', error);
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// DELETE: Elimina prenotazione (admin)
app.delete('/api/booking/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const booking = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
        
        if (booking.rows.length === 0) {
            return res.status(404).json({ message: 'Prenotazione non trovata' });
        }

        const bookingData = booking.rows[0];

        await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', id]);

        await pool.query(
            'INSERT INTO admin_logs (action, booking_id, details) VALUES ($1, $2, $3)',
            ['delete', id, `Eliminata prenotazione di ${bookingData.name}`]
        );

        await sendCancellationEmail(bookingData.email, bookingData.name);

        res.json({ message: '✅ Prenotazione eliminata' });
    } catch (error) {
        console.error('Errore:', error);
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// EMAIL FUNCTIONS
async function sendConfirmationEmail(email, name, date, time, bay) {
    try {
        await resend.emails.send({
            from: 'Saica Pack Italia <onboarding@resend.dev>',
            to: email,
            subject: '✅ Prenotazione Confermata - Saica Pack Italia',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #667eea;">✅ Prenotazione Confermata</h2>
                    <p>Ciao <strong>${name}</strong>,</p>
                    <p>La tua prenotazione è stata confermata con i seguenti dettagli:</p>
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>📅 Data:</strong> ${date}</p>
                        <p><strong>⏰ Orario:</strong> ${time}</p>
                        <p><strong>🔷 Baia:</strong> ${bay}</p>
                    </div>
                    <p>Grazie per aver scelto <strong>Saica Pack Italia SPA</strong>!</p>
                    <p style="color: #999; font-size: 12px; margin-top: 30px;">Per informazioni: saicapackitalia@gmail.com</p>
                </div>
            `
        });
        console.log(`✅ Email confermata inviata a ${email}`);
    } catch (error) {
        console.error('Errore invio email Resend:', error);
    }
}

async function sendCancellationEmail(email, name) {
    try {
        await resend.emails.send({
            from: 'Saica Pack Italia <onboarding@resend.dev>',
            to: email,
            subject: '❌ Prenotazione Annullata',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #dc3545;">❌ Prenotazione Annullata</h2>
                    <p>Ciao ${name},</p>
                    <p>La tua prenotazione è stata <strong>annullata</strong> dall'amministratore.</p>
                    <p>Per informazioni contatta: <strong>saicapackitalia@gmail.com</strong></p>
                </div>
            `
        });
        console.log(`✅ Email cancellazione inviata a ${email}`);
    } catch (error) {
        console.error('Errore invio email Resend:', error);
    }
}

// HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ status: '✅ Server online', timestamp: new Date().toISOString() });
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server avviato su porta ${PORT}`);
    console.log(`📧 Email: Resend configurato`);
    console.log(`💾 Database: PostgreSQL`);
});
