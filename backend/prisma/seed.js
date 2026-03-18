import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Sembrando base de datos...')

  // ─── Plataforma ───────────────────────────────────
  const platform = await prisma.platform.upsert({
    where: { id: 'platform-001' },
    update: {},
    create: { id: 'platform-001', name: 'Sport Hub OS' }
  })

  // ─── Súper Admin ──────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@sporthubos.com' },
    update: {},
    create: {
      email: 'admin@sporthubos.com',
      password: await bcrypt.hash('admin123', 10),
      name: 'Super Admin',
      role: 'SUPERADMIN',
    }
  })

  // ─── Club A: socio ────────────────────────────────
  const clubA = await prisma.club.upsert({
    where: { slug: 'padel-norte' },
    update: {},
    create: {
      platformId: platform.id,
      name: 'Pádel Norte Club',
      slug: 'padel-norte',
      address: 'Av. del Libertador 4500',
      city: 'Buenos Aires',
      phone: '11-4500-1234',
      email: 'info@padelnorte.com',
      planType: 'PARTNER',
      isPartner: true,
      revenueShare: 15,  // 15% para superadmin
      openTime: '08:00',
      closeTime: '23:00',
    }
  })

  // ─── Club B: SaaS ─────────────────────────────────
  const clubB = await prisma.club.upsert({
    where: { slug: 'sport-center-palermo' },
    update: {},
    create: {
      platformId: platform.id,
      name: 'Sport Center Palermo',
      slug: 'sport-center-palermo',
      address: 'Thames 1800',
      city: 'Buenos Aires',
      planType: 'SAAS',
      isPartner: false,
      monthlyFee: 25000,
      openTime: '07:00',
      closeTime: '23:00',
    }
  })

  // ─── Canchas Club A ───────────────────────────────
  const courts = await Promise.all([
    prisma.court.upsert({
      where: { id: 'court-a1' },
      update: {},
      create: {
        id: 'court-a1', clubId: clubA.id,
        name: 'Cancha 1', sport: 'PADEL', isIndoor: true,
        pricePerHour: 4500, pricePeakHour: 6000,
        peakHours: ['19:00','20:00','21:00'],
        publicVisible: true,
      }
    }),
    prisma.court.upsert({
      where: { id: 'court-a2' },
      update: {},
      create: {
        id: 'court-a2', clubId: clubA.id,
        name: 'Cancha 2', sport: 'PADEL', isIndoor: false,
        pricePerHour: 4000, pricePeakHour: 5500,
        peakHours: ['19:00','20:00','21:00'],
        publicVisible: true,
      }
    }),
    prisma.court.upsert({
      where: { id: 'court-a3' },
      update: {},
      create: {
        id: 'court-a3', clubId: clubA.id,
        name: 'Cancha 3', sport: 'FUTBOL5',
        pricePerHour: 5000, capacity: 10,
        publicVisible: true,
      }
    }),
  ])

  // ─── Admin del Club A ─────────────────────────────
  const adminA = await prisma.user.upsert({
    where: { email: 'admin@padelnorte.com' },
    update: {},
    create: {
      email: 'admin@padelnorte.com',
      password: await bcrypt.hash('club123', 10),
      name: 'Martín García',
      role: 'CLUB_OWNER',
      clubId: clubA.id,
    }
  })

  // ─── Jugadores ────────────────────────────────────
  const players = await Promise.all([
    { name: 'Carlos Méndez',    phone: '11-4523-8812', sports: ['PADEL'], consent: true,  spent: 186000, hours: 42 },
    { name: 'Julia Paredes',    phone: '11-6734-2290', sports: ['PADEL'], consent: true,  spent: 74500,  hours: 18 },
    { name: 'Roberto Sosa',     phone: '11-3341-7761', sports: ['FUTBOL5','PADEL'], consent: true, spent: 31200, hours: 8 },
    { name: 'Ana Gómez',        phone: '11-8823-5540', sports: ['PADEL'], consent: true,  spent: 128000, hours: 31 },
    { name: 'Diego Herrera',    phone: '11-2234-6691', sports: ['PADEL'], consent: false, spent: 45000,  hours: 12 },
    { name: 'Sofía Ramírez',    phone: '11-7765-4432', sports: ['PADEL','TENIS'], consent: true, spent: 67000, hours: 16 },
  ].map(p => prisma.player.upsert({
    where: { id: `player-${p.phone.replace(/\D/g,'')}` },
    update: {},
    create: {
      id: `player-${p.phone.replace(/\D/g,'')}`,
      clubId: clubA.id,
      name: p.name,
      phone: p.phone,
      sports: p.sports,
      marketingConsent: p.consent,
      consentDate: p.consent ? new Date() : null,
      totalSpent: p.spent,
      totalHours: p.hours,
      lastVisit: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      level: 'AMATEUR',
    }
  })))

  // ─── Productos Club A ─────────────────────────────
  await Promise.all([
    { name: 'Agua mineral',    category: 'BEBIDA',    price: 800 },
    { name: 'Gatorade',        category: 'BEBIDA',    price: 1200 },
    { name: 'Cerveza lata',    category: 'BEBIDA',    price: 1500 },
    { name: 'Jugo naranja',    category: 'BEBIDA',    price: 900 },
    { name: 'Paleta HEAD Flash', category: 'PALETA',  price: 85000 },
    { name: 'Paleta Babolat',  category: 'PALETA',    price: 95000 },
    { name: 'Pelota HEAD x3',  category: 'PELOTA',    price: 4500 },
    { name: 'Grip Wilson',     category: 'ACCESORIO', price: 1800 },
    { name: 'Overgrip x3',     category: 'ACCESORIO', price: 2200 },
    { name: 'Remera club',     category: 'ROPA',      price: 12000 },
    { name: 'Medias x2',       category: 'ROPA',      price: 3500 },
    { name: 'Alquiler paleta', category: 'ALQUILER',  price: 2000 },
  ].map(p => prisma.product.create({
    data: { ...p, clubId: clubA.id, stock: Math.floor(Math.random() * 50) + 5 }
  }).catch(() => null)))

  console.log('✅ Seed completado')
  console.log('\n🔑 Credenciales:')
  console.log('   SuperAdmin: admin@sporthubos.com / admin123')
  console.log('   Club Admin: admin@padelnorte.com / club123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
