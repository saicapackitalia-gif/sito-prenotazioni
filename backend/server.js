require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

// Email transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});

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

// ============ LOGIN ============
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '24h' });
        return res.json({ token, message: 'Login OK' });
    }

    res.status(401).json({ message: 'Credenziali errate' });
});

// ============ PRENOTAZIONI ============

// POST: Nuova prenotazione
app.post('/api/booking', async (req, res) => {
    const { email, name, phone, date, bay, time } = req.body;

    try {
        // Controlla se lo slot è già occupato
        const existing = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 AND bay = $2 AND time = $3',
            [date, bay, time]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'Slot non disponibile' });
        }

        // Crea prenotazione
        const id = uuidv4();
        await pool.query(
            'INSERT INTO bookings (id, email, name, phone, date, time, bay) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [id, email, name, phone, date, bay, time]
        );

        // Invia email di conferma
        await sendConfirmationEmail(email, name, date, time, bay);

        res.json({ id, message: 'Prenotazione confermata' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// GET: Slot disponibili
app.get('/api/booked-slots', async (req, res) => {
    const { date, bay } = req.query;

    try {
        const result = await pool.query(
            'SELECT time FROM bookings WHERE date = $1 AND bay = $2 ORDER BY time',
            [date, bay]
        );

        const bookedTimes = result.rows.map(row => row.time.substring(0, 5));
        res.json(bookedTimes);
    } catch (error) {
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// GET: Prenotazioni di oggi (admin)
app.get('/api/today-bookings', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 ORDER BY time',
            [today]
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// GET: Tutte le prenotazioni per un periodo (admin)
app.get('/api/bookings', authMiddleware, async (req, res) => {
    const { from, to, bay } = req.query;

    try {
        let query = 'SELECT * FROM bookings WHERE date BETWEEN $1 AND $2';
        const params = [from, to];

        if (bay) {
            query += ' AND bay = $3';
            params.push(bay);
        }

        query += ' ORDER BY date, time';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// PUT: Modifica prenotazione (admin)
app.put('/api/booking/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { date, bay, time } = req.body;

    try {
        // Controlla disponibilità nuovo slot
        const existing = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 AND bay = $2 AND time = $3 AND id != $4',
            [date, bay, time, id]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'Slot non disponibile' });
        }

        // Aggiorna prenotazione
        await pool.query(
            'UPDATE bookings SET date = $1, bay = $2, time = $3, updated_at = NOW() WHERE id = $4',
            [date, bay, time, id]
        );

        // Log azione admin
        await pool.query(
            'INSERT INTO admin_logs (action, booking_id, details) VALUES ($1, $2, $3)',
            ['update', id, `Modificato a ${date} ${time} - ${bay}`]
        );

        res.json({ message: 'Prenotazione aggiornata' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// DELETE: Elimina prenotazione (admin)
app.delete('/api/booking/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        // Ottieni email per notifica
        const booking = await pool.query('SELECT email FROM bookings WHERE id = $1', [id]);
        
        if (booking.rows.length === 0) {
            return res.status(404).json({ message: 'Prenotazione non trovata' });
        }

        // Elimina
        await pool.query('DELETE FROM bookings WHERE id = $1', [id]);

        // Log azione
        await pool.query(
            'INSERT INTO admin_logs (action, booking_id) VALUES ($1, $2)',
            ['delete', id]
        );

        // Invia notifica eliminazione
        await sendCancellationEmail(booking.rows[0].email);

        res.json({ message: 'Prenotazione eliminata' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// ============ EMAIL FUNCTIONS ============

async function sendConfirmationEmail(email, name, date, time, bay) {
    try {
        await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: email,
            subject: '✅ Prenotazione Confermata - Saica Pack Italia',
            html: `
                <h2>Prenotazione Confermata</h2>
                <p>Ciao <strong>${name}</strong>,</p>
                <p>La tua prenotazione è stata confermata:</p>
                <ul>
                    <li><strong>Data:</strong> ${date}</li>
                    <li><strong>Orario:</strong> ${time}</li>
                    <li><strong>Baia:</strong> ${bay}</li>
                </ul>
                <p>Grazie per aver scelto Saica Pack Italia!</p>
            `
        });
    } catch (error) {
        console.error('Errore invio email:', error);
    }
}

async function sendCancellationEmail(email) {
    try {
        await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: email,
            subject: '❌ Prenotazione Annullata',
            html: `
                <h2>Prenotazione Annullata</h2>
                <p>La tua prenotazione è stata annullata.</p>
                <p>Per informazioni contatta: ${process.env.SMTP_USER}</p>
            `
        });
    } catch (error) {
        console.error('Errore invio email:', error);
    }
}

// ============ REPORT & EXPORT ============

// GET: Report giornaliero
app.get('/api/daily-report', authMiddleware, async (req, res) => {
    const { date } = req.query;

    try {
        const result = await pool.query(
            'SELECT COUNT(*) as total, bay, COUNT(*) FILTER (WHERE bay = \'Scatole\') as scatole, COUNT(*) FILTER (WHERE bay = \'Fogli\') as fogli FROM bookings WHERE date = $1 GROUP BY bay',
            [date]
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// POST: Invia report via email
app.post('/api/send-report', authMiddleware, async (req, res) => {
    const { date } = req.body;

    try {
        const result = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 ORDER BY bay, time',
            [date]
        );

        const bookings = result.rows;
        const scatoleCount = bookings.filter(b => b.bay === 'Scatole').length;
        const fogliCount = bookings.filter(b => b.bay === 'Fogli').length;

        const html = `
            <h2>Report Giornaliero - ${date}</h2>
            <p><strong>Data:</strong> ${date}</p>
            <p><strong>Totale Prenotazioni:</strong> ${bookings.length}</p>
            <p><strong>Baia Scatole:</strong> ${scatoleCount}</p>
            <p><strong>Baia Fogli:</strong> ${fogliCount}</p>
            <table border="1" style="margin-top: 20px; border-collapse: collapse;">
                <tr style="background: #f0f0f0;">
                    <th style="padding: 10px;">Azienda</th>
                    <th style="padding: 10px;">Email</th>
                    <th style="padding: 10px;">Telefono</th>
                    <th style="padding: 10px;">Baia</th>
                    <th style="padding: 10px;">Orario</th>
                </tr>
                ${bookings.map(b => `
                    <tr>
                        <td style="padding: 8px;">${b.name}</td>
                        <td style="padding: 8px;">${b.email}</td>
                        <td style="padding: 8px;">${b.phone}</td>
                        <td style="padding: 8px;">${b.bay}</td>
                        <td style="padding: 8px;">${b.time}</td>
                    </tr>
                `).join('')}
            </table>
        `;

        await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: process.env.SMTP_USER,
            subject: `Report Prenotazioni - ${date}`,
            html
        });

        res.json({ message: 'Report inviato' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Errore nel server' });
    }
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server avviato su http://localhost:${PORT}`);
});
