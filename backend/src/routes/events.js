// routes/events.js — Eventos especiales (SUM, quincho, cumpleaños)
const express = require('express')
const router  = express.Router()
const { authenticate, requireRole, tenantFilter } = require('../middleware/auth')

router.use(authenticate)

router.get('/',         tenantFilter, async (req,res) => { res.json({ events: [] }) })
router.post('/',        requireRole('admin'), async (req,res) => { res.json({ ok: true }) })
router.put('/:id',      requireRole('admin'), async (req,res) => { res.json({ ok: true }) })
router.delete('/:id',   requireRole('admin'), async (req,res) => { res.json({ ok: true }) })

module.exports = router
