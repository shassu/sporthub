import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma.js'

export const agentRouter = Router()
const anthropic = new Anthropic()

// ══════════════════════════════════════════════════════════
//  TOOLS que el agente puede ejecutar
// ══════════════════════════════════════════════════════════
const AGENT_TOOLS = [
  {
    name: 'check_availability',
    description: 'Consulta los slots disponibles para una cancha o espacio en una fecha específica.',
    input_schema: {
      type: 'object',
      properties: {
        date:     { type: 'string', description: 'Fecha en formato YYYY-MM-DD. Si el usuario dice "hoy", "mañana", calcular.' },
        spaceId:  { type: 'string', description: 'ID del espacio. Si no se especifica, consultar todos.' },
        sport:    { type: 'string', description: 'Deporte de interés: padel, futbol5, tenis, etc.' },
      },
      required: ['date'],
    },
  },
  {
    name: 'create_booking',
    description: 'Crea una reserva para un jugador. Solo llamar cuando el jugador confirmó explícitamente los datos.',
    input_schema: {
      type: 'object',
      properties: {
        spaceId:     { type: 'string', description: 'ID del espacio a reservar' },
        date:        { type: 'string', description: 'Fecha YYYY-MM-DD' },
        startTime:   { type: 'string', description: 'Hora de inicio HH:MM' },
        playerName:  { type: 'string', description: 'Nombre del jugador' },
        playerPhone: { type: 'string', description: 'Teléfono del jugador (sin código de país)' },
        isRecurring: { type: 'boolean', description: 'Si es turno fijo semanal' },
      },
      required: ['spaceId', 'date', 'startTime', 'playerName', 'playerPhone'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancela una reserva existente. Pedir confirmación antes de llamar.',
    input_schema: {
      type: 'object',
      properties: {
        playerPhone: { type: 'string', description: 'Teléfono del jugador para buscar su reserva' },
        date:        { type: 'string', description: 'Fecha de la reserva a cancelar' },
        startTime:   { type: 'string', description: 'Hora de la reserva' },
      },
      required: ['playerPhone'],
    },
  },
  {
    name: 'send_payment_link',
    description: 'Genera y envía un link de pago para una reserva pendiente.',
    input_schema: {
      type: 'object',
      properties: {
        playerPhone: { type: 'string', description: 'Teléfono del jugador' },
        bookingId:   { type: 'string', description: 'ID de la reserva (si se conoce)' },
      },
      required: ['playerPhone'],
    },
  },
  {
    name: 'get_player_bookings',
    description: 'Consulta las reservas activas o historial de un jugador.',
    input_schema: {
      type: 'object',
      properties: {
        playerPhone: { type: 'string', description: 'Teléfono del jugador' },
        upcoming:    { type: 'boolean', description: 'true = solo próximas, false = historial' },
      },
      required: ['playerPhone'],
    },
  },
  {
    name: 'get_club_info',
    description: 'Obtiene información del club: horarios, precios, clases, personal, torneos, reglas.',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['horarios', 'precios', 'clases', 'personal', 'torneos', 'ubicacion', 'membresias', 'general'],
          description: 'Tipo de información a consultar',
        },
        spaceId: { type: 'string', description: 'Si pregunta por un espacio específico' },
      },
      required: ['topic'],
    },
  },
]

// ══════════════════════════════════════════════════════════
//  EJECUTOR DE TOOLS
// ══════════════════════════════════════════════════════════
async function executeTool(toolName, toolInput, clubId) {
  switch (toolName) {

    case 'check_availability': {
      const { date, spaceId, sport } = toolInput
      const dayStart = new Date(date + 'T00:00:00')
      const dayEnd   = new Date(date + 'T23:59:59')

      const spaces = await prisma.space.findMany({
        where: {
          clubId,
          isActive: true,
          type: 'COURT',
          ...(spaceId && { id: spaceId }),
          ...(sport && { sport: sport.toUpperCase() }),
        },
        include: { club: { select: { openTime: true, closeTime: true } } }
      })

      const bookings = await prisma.booking.findMany({
        where: { clubId, date: { gte: dayStart, lte: dayEnd }, status: { notIn: ['CANCELLED'] } }
      })

      const result = spaces.map(sp => {
        const slots = generateSlots(sp.club?.openTime || '08:00', sp.club?.closeTime || '23:00')
        const occupied = bookings.filter(b => b.spaceId === sp.id).map(b => b.startTime)
        const free = slots.filter(s => !occupied.includes(s))
        const isPeak = (h) => (sp.peakHours || []).includes(h)
        return {
          space: sp.name,
          sport: sp.sport,
          freeSlots: free.map(h => ({ time: h, price: isPeak(h) ? sp.pricePeakHour || sp.pricePerHour : sp.pricePerHour }))
        }
      })

      return { success: true, date, availability: result }
    }

    case 'create_booking': {
      const { spaceId, date, startTime, playerName, playerPhone, isRecurring } = toolInput
      const phone = playerPhone.replace(/\D/g, '')

      // Buscar o crear GlobalPlayer
      let global = await prisma.globalPlayer.findUnique({ where: { phone } })
      if (!global) {
        global = await prisma.globalPlayer.create({ data: { phone, name: playerName, sports: [] } })
      }

      // Buscar o crear ClubMembership
      let membership = await prisma.clubMembership.findUnique({
        where: { globalPlayerId_clubId: { globalPlayerId: global.id, clubId } }
      })
      if (!membership) {
        membership = await prisma.clubMembership.create({
          data: { globalPlayerId: global.id, clubId, marketingConsent: false }
        })
      }

      // Verificar disponibilidad
      const conflict = await prisma.booking.findFirst({
        where: { clubId, spaceId, date: new Date(date), startTime, status: { notIn: ['CANCELLED'] } }
      })
      if (conflict) return { success: false, error: 'Ese horario ya está ocupado' }

      // Obtener precio
      const space = await prisma.space.findUnique({ where: { id: spaceId } })
      const isPeak = (space?.peakHours || []).includes(startTime)
      const price  = isPeak ? (space?.pricePeakHour || space?.pricePerHour || 0) : (space?.pricePerHour || 0)
      const endTime = addHour(startTime)

      const booking = await prisma.booking.create({
        data: {
          clubId, spaceId, membershipId: membership.id,
          date: new Date(date), startTime, endTime,
          durationMin: 60, price,
          status: 'CONFIRMED', source: 'PLATFORM',
          isRecurring: isRecurring || false,
        }
      })

      return {
        success: true,
        bookingId: booking.id,
        message: `Reserva confirmada: ${space?.name} el ${formatDate(date)} a las ${startTime}. Precio: $${price.toLocaleString()}.`,
        paymentLink: `https://sporthubos.com/pay/${booking.id}`
      }
    }

    case 'cancel_booking': {
      const { playerPhone, date, startTime } = toolInput
      const phone = playerPhone.replace(/\D/g, '')

      const global = await prisma.globalPlayer.findUnique({ where: { phone } })
      if (!global) return { success: false, error: 'No encontré reservas para ese número' }

      const membership = await prisma.clubMembership.findFirst({
        where: { globalPlayerId: global.id, clubId }
      })
      if (!membership) return { success: false, error: 'No encontré reservas en este club' }

      const where = {
        membershipId: membership.id,
        clubId,
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        ...(date      && { date: new Date(date) }),
        ...(startTime && { startTime }),
      }

      const booking = await prisma.booking.findFirst({ where, include: { space: true } })
      if (!booking) return { success: false, error: 'No encontré una reserva activa con esos datos' }

      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })

      return {
        success: true,
        message: `Reserva cancelada: ${booking.space?.name} el ${formatDate(booking.date.toISOString().split('T')[0])} a las ${booking.startTime}.`
      }
    }

    case 'send_payment_link': {
      const { playerPhone, bookingId } = toolInput
      const phone = playerPhone.replace(/\D/g, '')

      let booking
      if (bookingId) {
        booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { space: true } })
      } else {
        const global = await prisma.globalPlayer.findUnique({ where: { phone } })
        const membership = global ? await prisma.clubMembership.findFirst({ where: { globalPlayerId: global.id, clubId } }) : null
        booking = membership ? await prisma.booking.findFirst({
          where: { membershipId: membership.id, clubId, isPaid: false, status: 'CONFIRMED', date: { gte: new Date() } },
          include: { space: true },
          orderBy: { date: 'asc' }
        }) : null
      }

      if (!booking) return { success: false, error: 'No encontré reservas pendientes de pago' }

      const mpLink      = `https://mpago.la/sporthubos-${booking.id.slice(-8)}`
      const genericLink = `https://sporthubos.com/pay/${booking.id}`
      const waText      = encodeURIComponent(`Hola! 👋 Te enviamos el link para pagar tu reserva en ${booking.space?.name} por $${booking.price.toLocaleString()}:\n${mpLink}`)

      return {
        success: true,
        mpLink, genericLink,
        whatsappUrl: `https://wa.me/${phone}?text=${waText}`,
        amount: booking.price,
        space: booking.space?.name,
        date: booking.date,
        startTime: booking.startTime,
      }
    }

    case 'get_player_bookings': {
      const { playerPhone, upcoming } = toolInput
      const phone = playerPhone.replace(/\D/g, '')

      const global = await prisma.globalPlayer.findUnique({ where: { phone } })
      if (!global) return { success: false, bookings: [], message: 'No encontré ese número en el sistema' }

      const membership = await prisma.clubMembership.findFirst({ where: { globalPlayerId: global.id, clubId } })
      if (!membership) return { success: false, bookings: [], message: 'Este jugador no tiene reservas en el club' }

      const bookings = await prisma.booking.findMany({
        where: {
          membershipId: membership.id,
          clubId,
          ...(upcoming !== false && { date: { gte: new Date() }, status: { notIn: ['CANCELLED'] } }),
        },
        include: { space: { select: { name: true, sport: true } } },
        orderBy: { date: 'asc' },
        take: 5
      })

      return {
        success: true,
        playerName: global.name,
        bookings: bookings.map(b => ({
          space: b.space?.name,
          date: formatDate(b.date.toISOString().split('T')[0]),
          time: b.startTime,
          price: b.price,
          isPaid: b.isPaid,
          isRecurring: b.isRecurring,
          status: b.status,
        }))
      }
    }

    case 'get_club_info': {
      const { topic, spaceId } = toolInput

      const club = await prisma.club.findUnique({ where: { id: clubId } })
      const spaces = await prisma.space.findMany({ where: { clubId, isActive: true } })
      const coaches = await prisma.coach.findMany({ where: { clubId, isActive: true } })
      const lessons = await prisma.lesson.findMany({
        where: { clubId, isActive: true },
        include: { coach: { select: { name: true } } }
      })
      const tournaments = await prisma.tournament.findMany({
        where: { clubId, status: { in: ['OPEN', 'IN_PROGRESS'] } }
      })

      const courts  = spaces.filter(s => s.type === 'COURT')
      const classes = spaces.filter(s => s.type === 'clase' || s.type === 'CLASS_ROOM')

      switch (topic) {
        case 'horarios':
          return { club: club?.name, openTime: club?.openTime, closeTime: club?.closeTime,
            spaces: spaces.map(s => ({ name: s.name, open: s.openTime, close: s.closeTime })) }

        case 'precios':
          const target = spaceId ? spaces.filter(s => s.id === spaceId) : spaces
          return { prices: target.map(s => ({ name: s.name, sport: s.sport, base: s.pricePerHour, peak: s.pricePeakHour, peakHours: s.peakHours })) }

        case 'clases':
          return {
            lessons: lessons.map(l => ({
              name: l.name, sport: l.sport, coach: l.coach?.name,
              days: l.dayOfWeek, time: `${l.startTime}–${l.endTime}`,
              price: `$${l.pricePerMonth.toLocaleString()}/mes`,
              slots: `${l.maxStudents} cupos`,
            }))
          }

        case 'personal':
          return { coaches: coaches.map(c => ({ name: c.name, sport: c.sport, phone: c.phone })) }

        case 'torneos':
          return { tournaments: tournaments.map(t => ({ name: t.name, sport: t.sport, start: t.startDate, price: t.pricePerTeam })) }

        case 'ubicacion':
          return { address: club?.address, city: club?.city, phone: club?.phone, email: club?.email }

        default:
          return {
            name: club?.name, address: club?.address,
            openTime: club?.openTime, closeTime: club?.closeTime,
            courts: courts.length, classeCount: classes.length,
            sports: [...new Set(courts.map(c => c.sport))],
          }
      }
    }

    default:
      return { error: `Tool desconocida: ${toolName}` }
  }
}

// ══════════════════════════════════════════════════════════
//  SYSTEM PROMPT DINÁMICO — se genera por club
// ══════════════════════════════════════════════════════════
async function buildSystemPrompt(clubId) {
  const club    = await prisma.club.findUnique({ where: { id: clubId } })
  const spaces  = await prisma.space.findMany({ where: { clubId, isActive: true } })
  const coaches = await prisma.coach.findMany({ where: { clubId, isActive: true } })
  const lessons = await prisma.lesson.findMany({
    where: { clubId, isActive: true },
    include: { coach: { select: { name: true } } }
  })

  const courtList = spaces
    .filter(s => s.type === 'COURT')
    .map(s => `- ${s.name} (${s.sport}): $${s.pricePerHour.toLocaleString()}/h, pico $${s.pricePeakHour?.toLocaleString() || '—'}/h. Horario pico: ${s.peakHours?.join(', ') || 'ninguno'}. Capacidad: ${s.capacity} personas.`)
    .join('\n')

  const classList = lessons
    .map(l => `- ${l.name}: ${l.coach?.name || 'a confirmar'}, ${l.startTime}–${l.endTime}, días ${l.dayOfWeek.join('/')}. Precio: $${l.pricePerMonth.toLocaleString()}/mes.`)
    .join('\n')

  const coachList = coaches
    .map(c => `- ${c.name} (${c.sport})${c.phone ? ` · ${c.phone}` : ''}`)
    .join('\n')

  const otherSpaces = spaces
    .filter(s => s.type !== 'COURT')
    .map(s => `- ${s.name}: ${s.type}, capacidad ${s.capacity}, $${s.pricePerHour.toLocaleString()}/h`)
    .join('\n')

  return `Sos el asistente virtual de ${club?.name || 'el complejo deportivo'}. Respondés consultas y gestionás reservas directamente por WhatsApp.

INFORMACIÓN DEL COMPLEJO
Nombre: ${club?.name}
Dirección: ${club?.address || 'a confirmar'}
Teléfono: ${club?.phone || 'a confirmar'}
Horario: ${club?.openTime || '08:00'} a ${club?.closeTime || '23:00'} hs

CANCHAS DISPONIBLES
${courtList || 'Cargando...'}

CLASES Y ACADEMIA
${classList || 'Sin clases activas actualmente'}

PERSONAL / PROFESORES
${coachList || 'Consultar en recepción'}

OTROS ESPACIOS (SUM, quincho, gimnasio)
${otherSpaces || 'Ninguno registrado'}

INSTRUCCIONES DE COMPORTAMIENTO
- Respondé siempre en el mismo idioma que escribe el jugador (español informal rioplatense si escribe en castellano)
- Sé conciso. No escribas párrafos largos. Usá listas cuando tenés múltiples opciones
- Para reservar: primero consultá disponibilidad (check_availability), mostrá las opciones, esperá que el jugador elija, pedí nombre y teléfono si no los tenés, confirmá el turno
- Antes de cancelar siempre pedí confirmación explícita
- Si no sabés algo, decilo claramente. No inventes información
- Si te preguntan por algo que no está en tu contexto (ej: "¿hay clases de natación?"), respondé honestamente que no tenés esa información y sugerí llamar al club
- Nunca compartas información de otros jugadores
- Cuando crees una reserva, siempre ofrecé enviar el link de pago
- Hablá como un empleado amable del club, no como un bot corporativo`
}

// ══════════════════════════════════════════════════════════
//  ENDPOINT PRINCIPAL — POST /agent/chat
// ══════════════════════════════════════════════════════════
agentRouter.post('/chat', async (req, res, next) => {
  try {
    const { messages, clubId: bodyClubId } = req.body
    const clubId = req.clubId || bodyClubId

    if (!clubId) return res.status(400).json({ error: 'clubId requerido' })
    if (!messages?.length) return res.status(400).json({ error: 'messages requerido' })

    const systemPrompt = await buildSystemPrompt(clubId)
    let currentMessages = [...messages]

    // Agentic loop — el agente puede llamar múltiples tools
    let maxIterations = 5
    while (maxIterations-- > 0) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools: AGENT_TOOLS,
        messages: currentMessages,
      })

      // Si terminó normalmente, devolver respuesta
      if (response.stop_reason === 'end_turn') {
        const text = response.content.find(b => b.type === 'text')?.text || ''
        return res.json({ reply: text, usage: response.usage })
      }

      // Si llamó una tool, ejecutarla y continuar
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')

        // Agregar la respuesta del asistente al historial
        currentMessages.push({ role: 'assistant', content: response.content })

        // Ejecutar todas las tools en paralelo
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (toolUse) => {
            const result = await executeTool(toolUse.name, toolUse.input, clubId)
            return {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            }
          })
        )

        // Agregar resultados al historial
        currentMessages.push({ role: 'user', content: toolResults })
        continue
      }

      break
    }

    res.status(500).json({ error: 'El agente no pudo completar la respuesta' })
  } catch (err) { next(err) }
})

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function generateSlots(open, close, step = 60) {
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

function addHour(time) {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + 60
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-')
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${parseInt(d)} de ${months[parseInt(m)-1]}`
}
