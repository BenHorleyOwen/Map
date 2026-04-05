import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { GameManager } from './gameManager.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })
const gm = new GameManager()

app.use(express.json())
app.use(express.static(join(__dirname, '../client')))

app.post('/api/game/create', (req, res) => {
  const game = gm.createGame(req.body?.settings ?? {})
  res.json({ code: game.code })
})

wss.on('connection', (ws) => {
  let playerId = null
  let gameCode = null

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.type === 'join') {
      playerId = msg.playerId
      gameCode = msg.code
      const ok = gm.addPlayer(gameCode, playerId, ws)
      if (!ok) return ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }))
      ws.send(JSON.stringify({ type: 'joined', state: gm.getPublicState(gameCode, playerId) }))
    }

    if (msg.type === 'gps' && playerId) {
      gm.updatePosition(gameCode, playerId, msg.lat, msg.lng)
    }

    if (msg.type === 'setRole' && playerId) {
      gm.setRole(gameCode, playerId, msg.role)
    }

    if (msg.type === 'startGame' && playerId) {
      gm.startGame(gameCode)
    }
  })

  ws.on('close', () => {
    if (playerId) gm.markStale(gameCode, playerId)
  })
})

const PORT = process.env.PORT || 8888
server.listen(PORT, () => console.log(`Seek server running on :${PORT}`))