import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { tenantFilter } from '../middleware/auth.js'

export const statsRouter = Router()

// ─── GET /stats/overview — resumen del club (o todos si superadmin) ───
statsRouter.get('/overview', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { from, to } = req.query

    const dateFilter = from && to
      ? { gte: new Date(from), lte: new Date(to) }
      : { gte: new Date(new Date().setDate(new Date().getDate() - 30)) }

    const [bookings, sales, players, topPlayers] = await Promise.all([
      // Totales de reservas
      prisma.booking.aggregate({
        where: { ...filter, status: 'COMPLETED', date: dateFilter },
        _count: true,
        _sum: { price: true, durationMin: true }
      }),

      // Totales de ventas de tienda
      prisma.sale.aggregate({
        where: { ...filter, createdAt: dateFilter },
        _count: true,
        _sum: { total: true }
      }),

      // Jugadores activos
      prisma.player.count({
        where: { ...filter, lastVisit: dateFilter }
      }),

      // Top jugadores por gasto
      prisma.player.findMany({
        where: filter,
        orderBy: { totalSpent: 'desc' },
        take: 10,
        select: {
          id: true, name: true, phone: true, totalSpent: true,
          totalHours: true, lastVisit: true, sports: true,
          _count: { select: { bookings: true } }
        }
      })
    ])

    // Facturación por día (últimos 7 días)
    const dailyRevenue = await prisma.booking.groupBy({
      by: ['date'],
      where: {
        ...filter,
        status: 'COMPLETED',
        date: { gte: new Date(new Date().setDate(new Date().getDate() - 7)) }
      },
      _sum: { price: true },
      orderBy: { date: 'asc' }
    })

    // Ingresos por categoría de producto
    const productRevenue = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { ...filter, createdAt: dateFilter } },
      _sum: { subtotal: true },
      _count: { quantity: true }
    })

    res.json({
      bookings: {
        count: bookings._count,
        revenue: bookings._sum.price || 0,
        hours: (bookings._sum.durationMin || 0) / 60,
      },
      sales: {
        count: sales._count,
        revenue: sales._sum.total || 0,
      },
      activePlayers: players,
      topPlayers,
      dailyRevenue,
      productRevenue,
    })
  } catch (err) { next(err) }
})

// ─── GET /stats/player/:id — perfil completo de jugador ──────────────
statsRouter.get('/player/:id', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)

    const player = await prisma.player.findFirst({
      where: { id: req.params.id, ...filter },
    })
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' })

    const [bookingHistory, purchaseHistory, spendByCategory] = await Promise.all([
      prisma.booking.findMany({
        where: { playerId: player.id, ...filter },
        include: { court: { select: { name: true, sport: true } } },
        orderBy: { date: 'desc' },
        take: 50
      }),

      prisma.saleItem.findMany({
        where: { playerId: player.id },
        include: { product: { select: { name: true, category: true } } },
        orderBy: { sale: { createdAt: 'desc' } },
        take: 100
      }),

      prisma.saleItem.groupBy({
        by: ['productId'],
        where: { playerId: player.id },
        _sum: { subtotal: true, quantity: true },
        orderBy: { _sum: { subtotal: 'desc' } }
      })
    ])

    // Cancha favorita
    const courtUsage = bookingHistory.reduce((acc, b) => {
      acc[b.court.name] = (acc[b.court.name] || 0) + 1
      return acc
    }, {})
    const favCourt = Object.entries(courtUsage).sort((a, b) => b[1] - a[1])[0]?.[0]

    // Frecuencia: reservas últimas 4 semanas
    const fourWeeksAgo = new Date()
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
    const recentBookings = bookingHistory.filter(b => new Date(b.date) >= fourWeeksAgo)

    res.json({
      player,
      stats: {
        favoriteCourt: favCourt,
        recentFrequency: recentBookings.length,  // veces en 4 semanas
        avgSpendPerVisit: player.totalHours > 0
          ? Math.round(player.totalSpent / (player.totalHours))
          : 0,
      },
      bookingHistory,
      purchaseHistory,
      spendByCategory,
    })
  } catch (err) { next(err) }
})

// ─── GET /stats/courts — ocupación por cancha ────────────────────────
statsRouter.get('/courts', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { from, to } = req.query
    const dateFilter = from && to
      ? { gte: new Date(from), lte: new Date(to) }
      : { gte: new Date(new Date().setDate(new Date().getDate() - 30)) }

    const courts = await prisma.court.findMany({ where: filter })

    const stats = await Promise.all(courts.map(async court => {
      const agg = await prisma.booking.aggregate({
        where: { courtId: court.id, status: 'COMPLETED', date: dateFilter },
        _count: true,
        _sum: { price: true, durationMin: true }
      })

      // Ocupación por franja horaria
      const byHour = await prisma.booking.groupBy({
        by: ['startTime'],
        where: { courtId: court.id, status: { notIn: ['CANCELLED'] }, date: dateFilter },
        _count: true,
        orderBy: { startTime: 'asc' }
      })

      return {
        court,
        bookings: agg._count,
        revenue: agg._sum.price || 0,
        hours: (agg._sum.durationMin || 0) / 60,
        byHour,
      }
    }))

    res.json(stats)
  } catch (err) { next(err) }
})

// ─── GET /stats/platform — vista superadmin de TODOS los clubs ───────
statsRouter.get('/platform', async (req, res, next) => {
  try {
    if (req.user.role !== 'SUPERADMIN') return res.status(403).json({ error: 'Solo superadmin' })

    const { from, to } = req.query
    const dateFilter = from && to
      ? { gte: new Date(from), lte: new Date(to) }
      : { gte: new Date(new Date().setDate(new Date().getDate() - 30)) }

    const clubs = await prisma.club.findMany({
      where: { isActive: true },
      select: { id: true, name: true, city: true, planType: true, isPartner: true, revenueShare: true }
    })

    const clubStats = await Promise.all(clubs.map(async club => {
      const [bookings, sales, players] = await Promise.all([
        prisma.booking.aggregate({
          where: { clubId: club.id, status: 'COMPLETED', date: dateFilter },
          _count: true,
          _sum: { price: true }
        }),
        prisma.sale.aggregate({
          where: { clubId: club.id, createdAt: dateFilter },
          _sum: { total: true }
        }),
        prisma.player.count({ where: { clubId: club.id } })
      ])

      const totalRevenue = (bookings._sum.price || 0) + (sales._sum.total || 0)
      const platformFee = club.isPartner && club.revenueShare
        ? totalRevenue * (club.revenueShare / 100)
        : 0

      return {
        club,
        bookingsCount: bookings._count,
        bookingRevenue: bookings._sum.price || 0,
        storeRevenue: sales._sum.total || 0,
        totalRevenue,
        platformFee,      // lo que te corresponde a vos
        totalPlayers: players,
      }
    }))

    const totals = clubStats.reduce((acc, c) => ({
      revenue: acc.revenue + c.totalRevenue,
      platformFee: acc.platformFee + c.platformFee,
      bookings: acc.bookings + c.bookingsCount,
      players: acc.players + c.totalPlayers,
    }), { revenue: 0, platformFee: 0, bookings: 0, players: 0 })

    res.json({ clubs: clubStats, totals })
  } catch (err) { next(err) }
})
