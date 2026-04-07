// ── Identity ──────────────────────────────────────────────────────────────────
const PLAYER_ID = (() => {
  let id = localStorage.getItem('playerId')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('playerId', id) }
  return id
})()

// ── State ─────────────────────────────────────────────────────────────────────
let ws            = null
let map           = null
let markers       = {}
let wakeLock      = null
let timerInterval = null
let myRole        = 'hider'
let gameStartedAt = null
let gameDurationMs = null

// ── Boot ──────────────────────────────────────────────────────────────────────
if (false && 'serviceWorker' in navigator) { // disabled for dev purposes
  navigator.serviceWorker.register('/sw.js')
}

// If arriving with ?game=CODE in the URL, skip straight to lobby room
const urlCode = new URLSearchParams(location.search).get('game')
if (urlCode) {
  enterLobbyRoom(urlCode)
  connect(urlCode)
}

// ── UI events ─────────────────────────────────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', async () => {
  const res = await fetch('/api/game/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })
  const { code } = await res.json()
  history.pushState(null, '', `?game=${code}`)
  enterLobbyRoom(code)
  connect(code)
})

document.getElementById('join-btn').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim().toUpperCase()
  if (!code) return
  // Close any existing socket before opening a new one
  if (ws) { ws.onclose = null; ws.close(); ws = null }
  history.pushState(null, '', `?game=${code}`)
  enterLobbyRoom(code)
  connect(code)
})

document.getElementById('start-btn').addEventListener('click', () => {
  ws?.send(JSON.stringify({ type: 'startGame' }))
})

document.querySelectorAll('.role-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    ws?.send(JSON.stringify({ type: 'setRole', role: btn.dataset.role }))
  })
})

// ── WebSocket ─────────────────────────────────────────────────────────────────
// `code` is captured in the closure so reconnects always use the right game
function connect(code) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}`)

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', playerId: PLAYER_ID, code }))
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'joined')    onJoined(msg.state)
    if (msg.type === 'roster')    updateRoster(msg.players)
    if (msg.type === 'sonar')     onSonar(msg.snapshot)
    if (msg.type === 'gameStart') onGameStart(msg)
    if (msg.type === 'gameEnd')   onGameEnd()
    if (msg.type === 'error')     alert(`Error: ${msg.message}`)
  }

  ws.onclose = () => setTimeout(() => connect(code), 2000)
}

// ── Message handlers ──────────────────────────────────────────────────────────
function onJoined(state) {
  myRole = state.myRole
  updateRoster(state.roster)
  if (state.phase === 'active') startPlay(state.settings, null)
}

function onGameStart({ settings, startedAt }) {
  startPlay(settings, startedAt)
}

function onSonar(snapshot) {
  if (!map) return
  const alive = new Set()

  for (const p of snapshot) {
    alive.add(p.id)
    if (p.lat == null) {
      if (markers[p.id]) markers[p.id].setStyle({ opacity: 0.25, fillOpacity: 0.25 })
      continue
    }
    const isSelf = p.id === PLAYER_ID
    const label  = isSelf ? 'You' : (p.role === 'seeker' ? 'Seeker' : 'Hider')
    const color  = isSelf ? 'blue' : (p.role === 'seeker' ? 'red' : 'green')

    if (!markers[p.id]) {
      markers[p.id] = L.circleMarker([p.lat, p.lng], {
        radius: 10, color, fillColor: color, fillOpacity: 0.8, weight: 2
      }).bindTooltip(label, { permanent: true, direction: 'top' }).addTo(map)
    } else {
      markers[p.id].setLatLng([p.lat, p.lng])
    }
    markers[p.id].setStyle({ opacity: 1, fillOpacity: 0.8 }) 
    if (isSelf) map.setView([p.lat, p.lng], map.getZoom())
  }

  for (const id of Object.keys(markers)) {
    if (!alive.has(id)) { markers[id].remove(); delete markers[id] }
  }

  const self = snapshot.find(p => p.id === PLAYER_ID)
  document.getElementById('stale-warning').hidden = !self?.stale
}

function onGameEnd() {
  clearInterval(timerInterval)
  show('results')
}

// ── Game UI ───────────────────────────────────────────────────────────────────
function startPlay(settings, startedAt) {
  console.log('Starting game with settings', settings, 'started at', startedAt)
  show('game')
  document.getElementById('my-role').textContent = myRole.toUpperCase()
  initMap()
  startGPS()
  requestWakeLock()
  if (startedAt) startTimer(settings.gameDurationMs, startedAt)
}

function initMap() {
  if (map) return
  map = L.map('map').setView([51.5, -0.09], 16) 
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    attribution: '© OpenStreetMap contributors'
  }).addTo(map)
}

function startTimer(durationMs, startedAt) {
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, durationMs - (Date.now() - startedAt))
    const m = Math.floor(remaining / 60000)
    const s = Math.floor((remaining % 60000) / 1000)
    document.getElementById('timer').textContent =
      `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    if (remaining === 0) clearInterval(timerInterval)
  }, 500)
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function startGPS() {
  if (!navigator.geolocation) return alert('GPS not available on this device')
  navigator.geolocation.watchPosition(
    sendPosition,
    err => console.warn('GPS error', err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  )
  //not actually working?
  navigator.geolocation.getCurrentPosition(sendPosition, () => {}, { enableHighAccuracy: true }) // immdiate initial position
}

function sendPosition(pos) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'gps',
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    }))
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ws?.readyState === WebSocket.OPEN) {
    navigator.geolocation?.getCurrentPosition(sendPosition)
  }
})

// ── Wake lock ─────────────────────────────────────────────────────────────────
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen')
    wakeLock?.addEventListener('release', () => {
      if (document.visibilityState === 'visible') requestWakeLock()
    })
  } catch { /* unavailable, carry on */ }
}

// ── Lobby helpers ─────────────────────────────────────────────────────────────
function enterLobbyRoom(code) {
  document.getElementById('lobby-home').hidden = true
  document.getElementById('lobby-room').hidden = false
  document.getElementById('game-code-display').textContent = code
}

function updateRoster(players) {
  const el = document.getElementById('roster')
  if (!el) return
  const pc = document.getElementById('player-count')
  if (pc) pc.textContent = `${players.length} player${players.length !== 1 ? 's' : ''}`
  el.innerHTML = players.map(p =>
    `<div class="roster-row ${p.role}">
      <span class="pid">${p.id.slice(0, 6)}</span>
      <span class="role">${p.role}</span>
      ${p.stale ? '<span class="stale-dot"></span>' : ''}
    </div>`
  ).join('')
}

function show(screen) {
  for (const id of ['lobby', 'game', 'results']) { // show only the specified screen
    document.getElementById(id).hidden = id !== screen
  }
}