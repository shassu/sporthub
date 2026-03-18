const express  = require('express')
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const router   = express.Router()

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })

    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({ where: { email }, include: { club: true } })
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' })

    const token = jwt.sign(
      { userId: user.id, clubId: user.clubId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )
    res.json({ token, user: { id: user.id, nombre: user.name, email: user.email, role: user.role, club: user.club?.name } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const { token } = req.body
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const newToken = jwt.sign(
      { userId: decoded.userId, clubId: decoded.clubId, role: decoded.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.json({ token: newToken })
  } catch {
    res.status(401).json({ error: 'Token inválido' })
  }
})

module.exports = router
