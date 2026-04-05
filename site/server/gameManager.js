import { randomBytes } from 'crypto'

const STALE_THRESHOLD_MS = 90_000
const SONAR_INTERVAL_MS  = 60_000

export class GameManager {
  constructor() {
    this.games = new Map()
  }

  createGame(settings = {}) {
    const code = randomBytes(3).toString('hex').toUpperCase()
    const game = {
      code,
      settings: {
        pingInterval:      settings.pingInterval      ?? SONAR_INTERVAL_MS,
        borderStartRadius: settings.borderStartRadius ?? 500,
        gameDurationMs:    settings.gameDurationMs    ?? 10 * 60 * 1000,
      },
      players: new Map(),
      phase: 'lobby',
      startedAt: null,
      sonarTimer: null,
    }
    this.games.set(code, game)
    console.log(`Game created: ${code}`)
    return game
  }

  addPlayer(code, playerId, ws) {
    const game = this.games.get(code)
    if (!game) return false
    const existing = game.players.get(playerId) ?? {}
    game.players.set(playerId, {
      id:         playerId,
      ws,
      role:       existing.role ?? 'hider',
      lat:        existing.lat  ?? null,
      lng:        existing.lng  ?? null,
      lastSeen:   Date.now(),
      stale:      false,
      eliminated: false,
    })
    console.log(`Player ${playerId.slice(0,6)} joined ${code}`)
    this._broadcast(code, { type: 'roster', players: this._rosterSnapshot(code) })
    return true
  }

  setRole(code, playerId, role) {
    const player = this.games.get(code)?.players.get(playerId)
    if (!player || !['seeker','hider'].includes(role)) return
    player.role = role
    this._broadcast(code, { type: 'roster', players: this._rosterSnapshot(code) })
  }

  updatePosition(code, playerId, lat, lng) {
    const game = this.games.get(code)
    const player = game?.players.get(playerId)
    if (!player) return
    player.lat      = lat
    player.lng      = lng
    player.lastSeen = Date.now()
    player.stale    = false
    if (game.phase === 'active') this._fanOutToSeekers(code)
  }

  markStale(code, playerId) {
    const player = this.games.get(code)?.players.get(playerId)
    if (player) {
      player.stale = true
      this._broadcast(code, { type: 'roster', players: this._rosterSnapshot(code) })
    }
  }

  startGame(code) {
    const game = this.games.get(code)
    if (!game || game.phase !== 'lobby') return
    game.phase     = 'active'
    game.startedAt = Date.now()
    game.sonarTimer = setInterval(() => this._sonarTick(code), game.settings.pingInterval)
    // End game automatically
    setTimeout(() => this._endGame(code), game.settings.gameDurationMs)
    this._broadcast(code, { type: 'gameStart', settings: game.settings, startedAt: game.startedAt })
    console.log(`Game ${code} started`)
  }

  getPublicState(code, requestingPlayerId) {
    const game = this.games.get(code)
    if (!game) return null
    return {
      phase:    game.phase,
      settings: game.settings,
      roster:   this._rosterSnapshot(code),
      myRole:   game.players.get(requestingPlayerId)?.role ?? 'hider',
    }
  }

  _sonarTick(code) {
    const game = this.games.get(code)
    if (!game) return
    for (const [pid, player] of game.players) {
      if (!player.ws || player.ws.readyState !== 1) continue
      player.ws.send(JSON.stringify({
        type: 'sonar',
        snapshot: this._buildSnapshot(game, pid),
      }))
    }
  }

  _fanOutToSeekers(code) {
    const game = this.games.get(code)
    if (!game) return
    for (const [, player] of game.players) {
      if (player.role === 'seeker' && player.ws?.readyState === 1) {
        player.ws.send(JSON.stringify({
          type: 'sonar',
          snapshot: this._buildSnapshot(game, player.id),
        }))
      }
    }
  }

  _buildSnapshot(game, requestingId) {
    const requester = game.players.get(requestingId)
    const isSeeker  = requester?.role === 'seeker'
    return [...game.players.values()].map(p => {
      const isSelf       = p.id === requestingId
      const isStale      = p.stale || (Date.now() - p.lastSeen > STALE_THRESHOLD_MS)
      const showPosition = isSeeker || isSelf || p.role === 'seeker'
      return {
        id:         p.id,
        role:       p.role,
        stale:      isStale,
        eliminated: p.eliminated,
        lat:        showPosition ? p.lat : null,
        lng:        showPosition ? p.lng : null,
      }
    })
  }

  _endGame(code) {
    const game = this.games.get(code)
    if (!game || game.phase === 'ended') return
    clearInterval(game.sonarTimer)
    game.phase = 'ended'
    this._broadcast(code, { type: 'gameEnd' })
    console.log(`Game ${code} ended`)
  }

  _broadcast(code, msg) {
    const game = this.games.get(code)
    if (!game) return
    const str = JSON.stringify(msg)
    for (const [, player] of game.players) {
      if (player.ws?.readyState === 1) player.ws.send(str)
    }
  }

  _rosterSnapshot(code) {
    const game = this.games.get(code)
    return [...game.players.values()].map(p => ({
      id:    p.id,
      role:  p.role,
      stale: p.stale,
    }))
  }
}