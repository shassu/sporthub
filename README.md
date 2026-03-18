# ⚡ Sport Hub OS — Sistema de gestión deportiva

Plataforma SaaS completa para clubes y complejos deportivos.
**16 módulos funcionales** — lista para demostración y desarrollo.

---

## 🗂 Estructura del proyecto

```
sporthubos/
├── frontend/          ← Módulos HTML (abrir en browser)
│   ├── dashboard.html          ← ENTRADA PRINCIPAL (login + navegación)
│   ├── onboarding.html         ← Wizard de configuración inicial
│   ├── modulo1-reservas.html   ← Reservas y calendario
│   ├── modulo2-jugadores-crm.html
│   ├── modulo3-caja-diaria.html
│   ├── modulo4-tienda.html
│   ├── modulo5-clases.html
│   ├── modulo6-membresias.html
│   ├── modulo7-torneos.html
│   ├── modulo8-ranking.html    ← Ranking ELO + matchmaking
│   ├── modulo9-eventos.html    ← Eventos especiales (SUM, quincho)
│   ├── modulo10-fidelidad.html ← Puntos y rewards
│   ├── modulo-agente-config.html
│   ├── modulo-configuracion.html
│   ├── superadmin.html
│   └── app-jugador.html        ← Portal mobile del jugador
│
├── backend/
│   ├── src/
│   │   ├── app.js              ← Express + middleware
│   │   ├── routes/             ← APIs REST
│   │   └── middleware/auth.js  ← JWT + multi-tenant
│   ├── prisma/
│   │   ├── schema.prisma       ← 32 modelos
│   │   └── seed.js             ← Datos demo
│   ├── package.json
│   └── .env.example
│
└── docs/
    └── DEPLOY.md
```

---

## 🚀 Opción A — Demo instantáneo (sin backend)

**Requiere:** Solo un navegador moderno.

1. Descomprimí el ZIP
2. Abrí `frontend/dashboard.html` en Chrome o Firefox
3. Credenciales demo:
   - Admin: `admin@sporthubos.app` / `admin123`
   - Profesor: `rodrigo@club.com` / `profe123`
   - Jugador: `sofia@gmail.com` / `jugador123`
4. ¡Listo! Todos los módulos funcionan con datos de ejemplo.

> Los módulos operan de forma independiente. El dashboard los carga
> como iframes — todos deben estar en la misma carpeta.

---

## 🛠 Opción B — Producción real con backend

### Requisitos

- Node.js 18+
- PostgreSQL 14+
- Cuenta Anthropic (para el agente IA)
- Cuenta Meta Business (para WhatsApp)

### Paso 1 — Clonar y configurar

```bash
cd backend
npm install
cp .env.example .env
# Editá .env con tus credenciales
```

### Paso 2 — Base de datos

```bash
# Crear la base
createdb sporthubos

# Aplicar el schema (32 tablas)
npx prisma db push

# Cargar datos demo
node prisma/seed.js
```

### Paso 3 — Levantar el backend

```bash
npm run dev
# Backend corriendo en http://localhost:3001
```

### Paso 4 — Servir el frontend

```bash
# Opción simple con Python
cd frontend
python3 -m http.server 5173

# O con Node
npx serve frontend -l 5173
```

### Paso 5 — Conectar el agente IA con WhatsApp

1. Creá una app en Meta for Developers
2. Agregá el producto WhatsApp Business
3. Copiá el Phone Number ID y el Access Token al `.env`
4. Configurá el webhook en Meta:
   - URL: `https://tu-dominio.com/api/webhook/whatsapp/{phoneNumberId}`
   - Verify Token: el mismo que pusiste en `.env`
5. En el módulo Agente IA → pestaña "Conectar WhatsApp" → seguí los 6 pasos

---

## ☁ Opción C — Deploy en la nube (recomendado para vender)

### Railway (más fácil — recomendado)

```bash
npm install -g @railway/cli
railway login
railway init
railway add postgresql
railway up
```

Variables de entorno a configurar en Railway dashboard:
```
DATABASE_URL        ← se genera automático con PostgreSQL
ANTHROPIC_API_KEY   ← tu clave de Anthropic
WA_PHONE_NUMBER_ID  ← de Meta for Developers
WA_ACCESS_TOKEN     ← de Meta for Developers
WA_VERIFY_TOKEN     ← inventalo vos (ej: sporthub2025)
JWT_SECRET          ← string largo aleatorio
NODE_ENV            ← production
```

### Render

```bash
# render.yaml ya incluido en el proyecto
# Conectá el repo en render.com → New Web Service
```

### VPS (DigitalOcean, Linode, etc.)

```bash
# En el servidor
git clone tu-repo
cd backend && npm install --production
npm install -g pm2
pm2 start src/app.js --name sporthubos
pm2 save && pm2 startup

# Nginx como reverse proxy
# sudo nano /etc/nginx/sites-available/sporthubos
```

Ejemplo config Nginx:
```nginx
server {
    listen 80;
    server_name tudominio.com;

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        root /var/www/sporthubos/frontend;
        index dashboard.html;
        try_files $uri $uri/ /dashboard.html;
    }
}
```

---

## 🔌 API — Endpoints principales

```
POST   /api/auth/login           ← Login (retorna JWT)
GET    /api/bookings             ← Reservas del club
POST   /api/bookings             ← Nueva reserva
GET    /api/players              ← Jugadores/socios
GET    /api/spaces               ← Canchas y P&L
GET    /api/stats/overview       ← KPIs del dashboard
POST   /api/agent/chat           ← Agente IA (tool calling)
POST   /api/webhook/whatsapp/:id ← Webhook de WhatsApp
GET    /api/tournaments          ← Torneos
POST   /api/tournaments/:id/draw ← Sorteo automático
GET    /api/tournaments/ranking  ← Ranking ELO
GET    /api/loyalty/points       ← Puntos de socios
POST   /api/loyalty/redeem       ← Canjear reward
GET    /api/events               ← Eventos especiales
```

Todos los endpoints requieren `Authorization: Bearer <token>` excepto login y webhook.

---

## 📦 Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5 + CSS3 + JS vanilla (sin frameworks) |
| Backend | Node.js + Express |
| ORM | Prisma |
| Base de datos | PostgreSQL |
| IA | Claude (Anthropic API) |
| Mensajería | WhatsApp Business API (Meta) |
| Auth | JWT + RBAC (admin / profesor / jugador) |
| Deploy | Railway / Render / VPS |

---

## 🔑 Credenciales demo

| Rol | Email | Contraseña |
|-----|-------|-----------|
| SuperAdmin | admin@sporthubos.app | admin123 |
| Admin club | admin@padelnorte.com | club123 |
| Profesor | rodrigo@club.com | profe123 |
| Jugador | sofia@gmail.com | jugador123 |

---

## 📞 Soporte

- Email: hola@sporthubos.app
- Docs: https://docs.sporthubos.app
- Demo: https://demo.sporthubos.app

**Sport Hub OS © 2025 — Todos los derechos reservados**
