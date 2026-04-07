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

wss.on('connection', (ws) => { // initialise a player connection, but they won't be in a game until they send a 'join' message with a code
  let playerId = null
  let gameCode = null

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    console.log('Received message', msg, 'from player', playerId, 'in game', gameCode)

    if (msg.type === 'join') { // { type: 'join', playerId, code }
      playerId = msg.playerId
      gameCode = msg.code
      const ok = gm.addPlayer(gameCode, playerId, ws) // returns false if game not found, otherwise adds/updates player and returns true
      if (!ok) return ws.send(JSON.stringify({ type: 'error', message: 'Game not found' })) 
      ws.send(JSON.stringify({ type: 'joined', state: gm.getPublicState(gameCode, playerId) }))
    }

    if (msg.type === 'gps' && playerId) { // { type: 'gps', lat, lng }
      gm.updatePosition(gameCode, playerId, msg.lat, msg.lng)
    }

    if (msg.type === 'setRole' && playerId) { // { type: 'setRole', role }
      gm.setRole(gameCode, playerId, msg.role)
    }

    if (msg.type === 'startGame' && playerId) { // only the host can start the game, but we don't need to check that here because gm.startGame will ignore it if it's not allowed
      gm.startGame(gameCode)
    }
  })

  ws.on('close', () => {
    if (playerId) gm.markStale(gameCode, playerId)
  })
})

//listen on all interfaces
const PORT = process.env.PORT || 8888
server.listen(PORT, '0.0.0.0', () =>
  console.log(`Seek server running on :${PORT}`)
)