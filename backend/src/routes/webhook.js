const express = require('express')
const router  = express.Router()

// Verificación del webhook (GET)
router.get('/whatsapp/:phoneNumberId', (req, res) => {
  const mode  = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('✅ Webhook de WhatsApp verificado')
    res.status(200).send(challenge)
  } else {
    res.sendStatus(403)
  }
})

// Mensajes entrantes (POST)
router.post('/whatsapp/:phoneNumberId', async (req, res) => {
  res.sendStatus(200) // Responder 200 inmediatamente a Meta
  try {
    const entry = req.body?.entry?.[0]
    const changes = entry?.changes?.[0]
    const value = changes?.value
    const messages = value?.messages
    if (!messages?.length) return

    for (const msg of messages) {
      if (msg.type === 'text') {
        const from = msg.from
        const text = msg.text.body
        console.log(`📱 WhatsApp de ${from}: ${text}`)
        // Aquí se dispara el agente IA
        // await handleAgentMessage(from, text, req.params.phoneNumberId)
      }
    }
  } catch (e) {
    console.error('Error webhook:', e)
  }
})

module.exports = router
