import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { tenantFilter } from '../middleware/auth.js'

export const bookingsRouter = Router()

bookingsRouter.get('/availability', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { date, spaceId, weekStart } = req.query

    const dates = weekStart
      ? Array.from({ length: 7 }, (_, i) => {
          const d = new Date(weekStart)
          d.setDate(d.getDate() + i)
          return d.toISOString().split('T')[0]
        })
      : [date]

    if (!dates[0]) return res.status(400).json({ error: 'date o weekStart requerido' })

    const spaces = await prisma.space.findMany({
      where: { clubId: filter.clubId, isActive: true, type: 'COURT', ...(spaceId && { id: spaceId }) },
      include: { club: { select: { openTime: true, closeTime: true } } }
    })

    const result = {}

    for (const dateStr of dates) {
      const dayStart = new Date(dateStr + 'T00:00:00')
      const dayEnd   = new Date(dateStr + 'T23:59:59')

      const bookings = await prisma.booking.findMany({
        where: { clubId: filter.clubId, date: { gte: dayStart, lte: dayEnd }, status: { notIn: ['CANCELLED'] }, ...(spaceId && { spaceId }) },
        include: { membership: { include: { globalPlayer: { select: { name: true, phone: true } } } } }
      })

      const blocks = await prisma.scheduleBlock.findMany({
        where: { space: { clubId: filter.clubId }, date: { gte: dayStart, lte: dayEnd }, ...(spaceId && { spaceId }) }
      })

      result[dateStr] = spaces.map(space => {
        const slots = generateTimeSlots(space.club?.openTime || '08:00', space.club?.closeTime || '23:00', 60)
        const spaceBookings = bookings.filter(b => b.spaceId === space.id)
        const spaceBlocks   = blocks.filter(b => b.spaceId === space.id)

        return {
          space: { id: space.id, name: space.name, sport: space.sport, isIndoor: space.isIndoor, pricePerHour: space.pricePerHour, pricePeakHour: space.pricePeakHour, peakHours: space.peakHours },
          slots: slots.map(time => {
            const booking = spaceBookings.find(b => b.startTime === time)
            const block   = spaceBlocks.find(b => b.startTime <= time && b.endTime > time)
            const isPeak  = space.peakHours?.includes(time)
            const price   = isPeak ? (space.pricePeakHour || space.pricePerHour) : space.pricePerHour

            if (block)   return { time, status: 'BLOCKED', reason: block.reason, price }
            if (booking) return { time, status: booking.status, price, booking: { id: booking.id, playerName: booking.membership?.globalPlayer?.name || 'Reservado', isPaid: booking.isPaid, isRecurring: booking.isRecurring, notes: booking.notes } }
            return { time, status: 'FREE', price }
          })
        }
      })
    }

    res.json(result)
  } catch (err) { next(err) }
})

bookingsRouter.get('/', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { from, to, spaceId, status, membershipId } = req.query
    const bookings = await prisma.booking.findMany({
      where: { clubId: filter.clubId, ...(spaceId && { spaceId }), ...(status && { status }), ...(membershipId && { membershipId }), ...(from && to && { date: { gte: new Date(from), lte: new Date(to) } }) },
      include: { space: { select: { id: true, name: true, sport: true } }, membership: { include: { globalPlayer: { select: { name: true, phone: true } } } }, createdBy: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    })
    res.json(bookings)
  } catch (err) { next(err) }
})

bookingsRouter.post('/', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { spaceId, membershipId, date, startTime, durationMin, price, isPaid, paymentMethod, notes, isRecurring, recurringWeeks } = req.body

    if (!spaceId || !date || !startTime) return res.status(400).json({ error: 'spaceId, date y startTime son requeridos' })

    const endTime = addMinutes(startTime, durationMin || 60)
    const conflict = await prisma.booking.findFirst({ where: { clubId: filter.clubId, spaceId, date: new Date(date), startTime, status: { notIn: ['CANCELLED'] } } })
    if (conflict) return res.status(409).json({ error: 'Ese horario ya está ocupado' })

    const booking = await prisma.booking.create({
      data: { clubId: filter.clubId, spaceId, membershipId: membershipId || null, createdById: req.user.id, date: new Date(date), startTime, endTime, durationMin: durationMin || 60, price: price || 0, isPaid: isPaid || false, paymentMethod: paymentMethod || null, notes: notes || null, source: 'ADMIN', isRecurring: isRecurring || false },
      include: { space: { select: { id: true, name: true, sport: true } }, membership: { include: { globalPlayer: { select: { name: true, phone: true } } } } }
    })

    const weeks = parseInt(recurringWeeks) || 1
    if (isRecurring && weeks > 1) {
      await prisma.booking.update({ where: { id: booking.id }, data: { recurringId: booking.id } })
      let created = 1
      for (let w = 1; w < weeks; w++) {
        const nextDate = new Date(date)
        nextDate.setDate(nextDate.getDate() + 7 * w)
        const exists = await prisma.booking.findFirst({ where: { clubId: filter.clubId, spaceId, date: nextDate, startTime, status: { notIn: ['CANCELLED'] } } })
        if (!exists) {
          await prisma.booking.create({ data: { clubId: filter.clubId, spaceId, membershipId: membershipId || null, createdById: req.user.id, date: nextDate, startTime, endTime, durationMin: durationMin || 60, price: price || 0, isPaid: isPaid || false, source: 'ADMIN', isRecurring: true, recurringId: booking.id } })
          created++
        }
      }
      return res.status(201).json({ booking, recurringCreated: created })
    }

    res.status(201).json({ booking })
  } catch (err) { next(err) }
})

bookingsRouter.patch('/:id', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { status, isPaid, paymentMethod, notes, updateAll } = req.body
    const existing = await prisma.booking.findFirst({ where: { id: req.params.id, clubId: filter.clubId } })
    if (!existing) return res.status(404).json({ error: 'No encontrada' })

    const data = { ...(status !== undefined && { status }), ...(isPaid !== undefined && { isPaid, paidAt: isPaid ? new Date() : null }), ...(paymentMethod !== undefined && { paymentMethod }), ...(notes !== undefined && { notes }) }

    if (existing.isRecurring && existing.recurringId && updateAll) {
      await prisma.booking.updateMany({ where: { recurringId: existing.recurringId, clubId: filter.clubId, date: { gte: new Date() } }, data })
      return res.json({ updated: 'all_recurring' })
    }

    const booking = await prisma.booking.update({ where: { id: req.params.id }, data, include: { space: { select: { id: true, name: true } }, membership: { include: { globalPlayer: { select: { name: true } } } } } })
    if (status === 'COMPLETED' && booking.membershipId) await updateMembershipStats(booking.membershipId)
    res.json(booking)
  } catch (err) { next(err) }
})

bookingsRouter.delete('/:id', async (req, res, next) => {
  try {
    const filter = tenantFilter(req)
    const { cancelAll } = req.query
    const existing = await prisma.booking.findFirst({ where: { id: req.params.id, clubId: filter.clubId } })
    if (!existing) return res.status(404).json({ error: 'No encontrada' })

    if (existing.isRecurring && existing.recurringId && cancelAll === 'true') {
      await prisma.booking.updateMany({ where: { recurringId: existing.recurringId, clubId: filter.clubId, date: { gte: new Date() } }, data: { status: 'CANCELLED' } })
      return res.json({ cancelled: 'all_future_recurring' })
    }

    await prisma.booking.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

bookingsRouter.post('/blocks', async (req, res, next) => {
  try {
    const { spaceId, date, startTime, endTime, reason } = req.body
    const block = await prisma.scheduleBlock.create({ data: { spaceId, date: new Date(date), startTime, endTime, reason: reason || null } })
    res.status(201).json(block)
  } catch (err) { next(err) }
})

function generateTimeSlots(open, close, step = 60) {
  const slots = []
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)
  let cur = oh * 60 + om
  const end = ch * 60 + cm
  while (cur + step <= end) {
    slots.push(`${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`)
    cur += step
  }
  return slots
}

function addMinutes(time, min) {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + min
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`
}

async function updateMembershipStats(membershipId) {
  const agg = await prisma.booking.aggregate({ where: { membershipId, status: 'COMPLETED' }, _sum: { price: true, durationMin: true } })
  const salesAgg = await prisma.saleItem.aggregate({ where: { membershipId }, _sum: { subtotal: true } })
  await prisma.clubMembership.update({ where: { id: membershipId }, data: { totalSpentHere: (agg._sum.price || 0) + (salesAgg._sum.subtotal || 0), totalHoursHere: (agg._sum.durationMin || 0) / 60, lastVisit: new Date(), visitCount: { increment: 1 } } })
}
