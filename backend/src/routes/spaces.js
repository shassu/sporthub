import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { tenantFilter } from '../middleware/auth.js'

export const spacesRouter = Router()

// ─── GET /spaces — listar espacios del club ───────────────────────────
spacesRouter.get('/', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const spaces = await prisma.space.findMany({
      where: { ...filter, isActive: true },
      orderBy: { name: 'asc' }
    })
    res.json(spaces)
  } catch (err) { next(err) }
})

// ─── GET /spaces/revenue — P&L en tiempo real por espacio ────────────
// Esta es la vista que el dueño del club ve en su dashboard
spacesRouter.get('/revenue', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { from, to, period } = req.query

    // Calcular rango de fechas
    const now = new Date()
    let dateFrom, dateTo
    if (from && to) {
      dateFrom = new Date(from)
      dateTo   = new Date(to)
    } else if (period === 'today') {
      dateFrom = new Date(now.setHours(0,0,0,0))
      dateTo   = new Date(now.setHours(23,59,59,999))
    } else if (period === 'week') {
      const mon = new Date(now)
      mon.setDate(now.getDate() - now.getDay() + 1)
      mon.setHours(0,0,0,0)
      dateFrom = mon
      dateTo   = new Date()
    } else {
      // default: mes actual
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1)
      dateTo   = new Date()
    }

    const spaces = await prisma.space.findMany({
      where: { ...filter, isActive: true },
    })

    const spaceData = await Promise.all(spaces.map(async (space) => {

      // ── Ingresos por reservas ──────────────────────
      const bookingAgg = await prisma.booking.aggregate({
        where: {
          spaceId: space.id,
          status: { in: ['COMPLETED', 'CONFIRMED'] },
          date: { gte: dateFrom, lte: dateTo }
        },
        _count: true,
        _sum: { price: true, durationMin: true }
      })

      // ── Ingresos por clases ────────────────────────
      const enrollmentCount = await prisma.lessonEnrollment.count({
        where: {
          lesson: { spaceId: space.id },
          status: 'ACTIVE',
          startDate: { lte: dateTo }
        }
      })
      const lessonRevenue = await prisma.lessonEnrollment.aggregate({
        where: { lesson: { spaceId: space.id }, status: 'ACTIVE' },
        _sum: { monthlyFee: true }
      })

      // ── Ocupación ─────────────────────────────────
      const totalBookings = bookingAgg._count
      const totalHours    = (bookingAgg._sum.durationMin || 0) / 60
      const totalRevenue  = bookingAgg._sum.price || 0

      // Calcular slots disponibles en el período
      const days = Math.ceil((dateTo - dateFrom) / (1000 * 60 * 60 * 24))
      const [oh, om] = (space.club?.openTime || '08:00').split(':').map(Number)
      const [ch, cm] = (space.club?.closeTime || '23:00').split(':').map(Number)
      const hoursPerDay = ch - oh
      const totalAvailableHours = days * hoursPerDay
      const occupancyRate = totalAvailableHours > 0
        ? Math.round((totalHours / totalAvailableHours) * 100)
        : 0

      // ── P&L básico ────────────────────────────────
      const monthlyFraction = days / 30
      const fixedCosts = ((space.monthlyCost || 0) + (space.maintenanceCost || 0)) * monthlyFraction
      const classRevenue = (lessonRevenue._sum.monthlyFee || 0) * monthlyFraction
      const grossRevenue = totalRevenue + classRevenue
      const grossMargin  = grossRevenue - fixedCosts

      // ── Breakdown por franja horaria ──────────────
      const hourlyBreakdown = await prisma.booking.groupBy({
        by: ['startTime'],
        where: {
          spaceId: space.id,
          status: { in: ['COMPLETED', 'CONFIRMED'] },
          date: { gte: dateFrom, lte: dateTo }
        },
        _count: true,
        _sum: { price: true },
        orderBy: { startTime: 'asc' }
      })

      // ── Tendencia últimos 7 días ───────────────────
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      const dailyRevenue = await prisma.booking.groupBy({
        by: ['date'],
        where: {
          spaceId: space.id,
          status: { in: ['COMPLETED', 'CONFIRMED'] },
          date: { gte: sevenDaysAgo }
        },
        _sum: { price: true },
        orderBy: { date: 'asc' }
      })

      return {
        space,
        revenue: {
          bookings: totalRevenue,
          classes:  classRevenue,
          gross:    grossRevenue,
          costs:    fixedCosts,
          margin:   grossMargin,
          marginPct: grossRevenue > 0 ? Math.round((grossMargin / grossRevenue) * 100) : 0,
        },
        occupancy: {
          rate:            occupancyRate,
          totalHours,
          totalBookings,
          availableHours:  totalAvailableHours,
          activeEnrollments: enrollmentCount,
        },
        hourlyBreakdown,
        dailyTrend: dailyRevenue,
      }
    }))

    // ── Totales del complejo ───────────────────────
    const totals = spaceData.reduce((acc, s) => ({
      gross:    acc.gross    + s.revenue.gross,
      costs:    acc.costs    + s.revenue.costs,
      margin:   acc.margin   + s.revenue.margin,
      bookings: acc.bookings + s.occupancy.totalBookings,
      hours:    acc.hours    + s.occupancy.totalHours,
    }), { gross: 0, costs: 0, margin: 0, bookings: 0, hours: 0 })

    // ── Fee de la plataforma (para superadmin) ─────
    const club = await prisma.club.findUnique({
      where: { id: filter.clubId },
      select: { revenueShare: true, isPartner: true }
    })
    const platformFee = club?.isPartner && club?.revenueShare
      ? totals.gross * (club.revenueShare / 100)
      : null

    res.json({ spaces: spaceData, totals, platformFee, period: { from: dateFrom, to: dateTo } })
  } catch (err) { next(err) }
})

// ─── POST /spaces — crear espacio ─────────────────────────────────────
spacesRouter.post('/', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const space = await prisma.space.create({
      data: { ...req.body, ...filter }
    })
    res.status(201).json(space)
  } catch (err) { next(err) }
})

// ─── PATCH /spaces/:id ────────────────────────────────────────────────
spacesRouter.patch('/:id', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const space = await prisma.space.update({
      where: { id: req.params.id, ...filter },
      data: req.body
    })
    res.json(space)
  } catch (err) { next(err) }
})
