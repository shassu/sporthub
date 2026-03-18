import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { tenantFilter } from '../middleware/auth.js'

export const playersRouter = Router()

// ─── GET /players — listar memberships del club ───────────────────────
playersRouter.get('/', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { search, inactive } = req.query

    const memberships = await prisma.clubMembership.findMany({
      where: {
        ...filter,
        isActive: inactive ? undefined : true,
        ...(search && {
          globalPlayer: {
            OR: [
              { name:  { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { email: { contains: search, mode: 'insensitive' } },
            ]
          }
        })
      },
      include: {
        globalPlayer: {
          select: { id: true, name: true, phone: true, email: true, sports: true, level: true, zone: true }
        }
      },
      orderBy: { lastVisit: 'desc' }
    })

    res.json(memberships)
  } catch (err) { next(err) }
})

// ─── POST /players — registrar jugador (pre-inscripción) ──────────────
// Lógica: busca GlobalPlayer por teléfono
//   → Si existe: crea ClubMembership linkeado
//   → Si no:     crea GlobalPlayer + ClubMembership
playersRouter.post('/', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { name, phone, email, sports, marketingConsent, localAlias, notes } = req.body

    if (!phone) return res.status(400).json({ error: 'El teléfono es obligatorio' })

    // Normalizar teléfono (solo dígitos)
    const normalizedPhone = phone.replace(/\D/g, '')

    // Verificar si ya está en este club
    const existingMembership = await prisma.clubMembership.findFirst({
      where: { clubId: filter.clubId, globalPlayer: { phone: normalizedPhone } },
      include: { globalPlayer: true }
    })
    if (existingMembership) {
      return res.status(409).json({ error: 'Este jugador ya está registrado en el club', membership: existingMembership })
    }

    // Buscar o crear GlobalPlayer
    let globalPlayer = await prisma.globalPlayer.findUnique({ where: { phone: normalizedPhone } })

    if (!globalPlayer) {
      globalPlayer = await prisma.globalPlayer.create({
        data: {
          phone: normalizedPhone,
          name,
          email: email || null,
          sports: sports || [],
        }
      })
    }

    // Crear membership local
    const membership = await prisma.clubMembership.create({
      data: {
        globalPlayerId: globalPlayer.id,
        clubId: filter.clubId,
        localAlias: localAlias || null,
        notes: notes || null,
        marketingConsent: marketingConsent || false,
        consentDate: marketingConsent ? new Date() : null,
      },
      include: {
        globalPlayer: {
          select: { id: true, name: true, phone: true, email: true, sports: true }
        }
      }
    })

    res.status(201).json(membership)
  } catch (err) { next(err) }
})

// ─── GET /players/:id — perfil completo con historial ────────────────
playersRouter.get('/:id', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)

    const membership = await prisma.clubMembership.findFirst({
      where: { id: req.params.id, ...filter },
      include: {
        globalPlayer: true,
        bookings: {
          include: { space: { select: { name: true, sport: true } } },
          orderBy: { date: 'desc' },
          take: 30
        },
        saleItems: {
          include: { product: { select: { name: true, category: true } } },
          orderBy: { sale: { createdAt: 'desc' } },
          take: 50
        },
        lessonEnrollments: {
          include: { lesson: { include: { coach: { select: { name: true } } } } },
          where: { status: 'ACTIVE' }
        }
      }
    })

    if (!membership) return res.status(404).json({ error: 'Jugador no encontrado' })

    // Gasto por categoría de producto
    const spendByCategory = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { membershipId: membership.id },
      _sum: { subtotal: true, quantity: true },
    })

    // Cancha/espacio favorito
    const spaceUsage = membership.bookings.reduce((acc, b) => {
      const key = b.space.name
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const favoriteSpace = Object.entries(spaceUsage).sort((a, b) => b[1] - a[1])[0]?.[0]

    res.json({ membership, spendByCategory, favoriteSpace })
  } catch (err) { next(err) }
})

// ─── PATCH /players/:id — actualizar perfil local ────────────────────
playersRouter.patch('/:id', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { localAlias, notes, marketingConsent, isActive, isBanned, banReason } = req.body

    const membership = await prisma.clubMembership.update({
      where: { id: req.params.id, ...filter },
      data: {
        ...(localAlias       !== undefined && { localAlias }),
        ...(notes            !== undefined && { notes }),
        ...(marketingConsent !== undefined && { marketingConsent, consentDate: marketingConsent ? new Date() : null }),
        ...(isActive         !== undefined && { isActive }),
        ...(isBanned         !== undefined && { isBanned, banReason: banReason || null }),
      },
      include: { globalPlayer: true }
    })

    res.json(membership)
  } catch (err) { next(err) }
})

// ─── GET /players/lookup/:phone — buscar por teléfono (para pre-inscripción) ─
// Útil para que el admin vea si el jugador ya existe en la plataforma
playersRouter.get('/lookup/:phone', async (req, res, next) => {
  try {
    const normalizedPhone = req.params.phone.replace(/\D/g, '')
    const global = await prisma.globalPlayer.findUnique({
      where: { phone: normalizedPhone },
      select: { id: true, name: true, phone: true, email: true, sports: true }
    })
    // Solo devuelve datos básicos — no expone en qué otros clubs está
    res.json(global ? { found: true, name: global.name, sports: global.sports } : { found: false })
  } catch (err) { next(err) }
})
