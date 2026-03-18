// routes/loyalty.js — Puntos de fidelidad y rewards
const express = require('express')
const router  = express.Router()
const { authenticate, tenantFilter } = require('../middleware/auth')

router.use(authenticate)

router.get('/points',   tenantFilter, async (req,res) => { res.json({ points: [] }) })
router.get('/rewards',  tenantFilter, async (req,res) => { res.json({ rewards: [] }) })
router.post('/redeem',  async (req,res) => { res.json({ ok: true }) })
router.post('/add',     async (req,res) => { res.json({ ok: true }) })

module.exports = router
