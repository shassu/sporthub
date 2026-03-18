import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'

// ─── Verificar JWT y cargar usuario ──────────────────
export async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'Token requerido' })

    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { club: { select: { id: true, name: true, slug: true, planType: true, isPartner: true } } }
    })

    if (!user || !user.isActive) return res.status(401).json({ error: 'Usuario inválido' })

    req.user = user
    // El clubId activo: si es superadmin puede impersonar cualquier club via header
    req.clubId = user.role === 'SUPERADMIN'
      ? (req.headers['x-club-id'] || null)
      : user.clubId

    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// ─── Verificar rol mínimo ─────────────────────────────
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sin permiso para esta acción' })
    }
    next()
  }
}

// ─── Inyectar filtro de tenant en queries ────────────
// SuperAdmin: sin filtro (ve todo)
// Otros roles: siempre filtrado por su clubId
export function tenantFilter(req) {
  if (req.user.role === 'SUPERADMIN' && !req.clubId) return {}
  const clubId = req.clubId || req.user.clubId
  if (!clubId) throw new Error('Club no identificado')
  return { clubId }
}
