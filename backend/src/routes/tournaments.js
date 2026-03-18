// routes/tournaments.js — Torneos, fixture y ranking ELO
const express = require('express')
const router  = express.Router()
const { authenticate, requireRole, tenantFilter } = require('../middleware/auth')

router.use(authenticate)

router.get('/',           tenantFilter, async (req,res) => { res.json({ tournaments: [] }) })
router.post('/',          requireRole('admin'), async (req,res) => { res.json({ ok: true }) })
router.post('/:id/draw',  requireRole('admin'), async (req,res) => { res.json({ ok: true }) })
router.post('/:id/result',requireRole('admin'), async (req,res) => { res.json({ ok: true }) })

// ELO
router.get('/ranking',    tenantFilter, async (req,res) => { res.json({ ranking: [] }) })
router.post('/elo/update',requireRole('admin'), async (req,res) => { res.json({ ok: true }) })

module.exports = router
