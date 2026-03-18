require('dotenv').config()
const express  = require('express')
const cors     = require('cors')
const helmet   = require('helmet')
const morgan   = require('morgan')
const rateLimit = require('express-rate-limit')

const app = express()

// ── Seguridad ──────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 })
app.use('/api/', limiter)

// ── Health check ───────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, version: '1.0.0' }))

// ── Rutas ──────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'))
app.use('/api/bookings',    require('./routes/bookings'))
app.use('/api/players',     require('./routes/players'))
app.use('/api/spaces',      require('./routes/spaces'))
app.use('/api/stats',       require('./routes/stats'))
app.use('/api/agent',       require('./routes/agent'))
app.use('/api/tournaments', require('./routes/tournaments'))
app.use('/api/loyalty',     require('./routes/loyalty'))
app.use('/api/events',      require('./routes/events'))
app.use('/api/webhook',     require('./routes/webhook'))

// ── Error handler ──────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({ error: err.message || 'Error interno' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`⚡ Sport Hub OS corriendo en puerto ${PORT}`))

module.exports = app
