// For interactive documentation and code auto-completion in editor
/** @typedef {import('pear-interface')} */ 

/* global Pear */
import Hyperswarm from 'hyperswarm'   // Module for P2P networking and connecting peers
import crypto from 'hypercore-crypto' // Cryptographic functions for generating keys
import b4a from 'b4a'                 // Module for buffer-to-string and vice-versa conversions 
const { teardown, updates } = Pear    // Functions for cleanup and updates

const swarm = new Hyperswarm()

// Unannounce the public key before exiting the process
teardown(() => swarm.destroy())

// Enable automatic reloading for the app
updates(() => Pear.reload())

// Store active bets and user information
let myBalance = 1000 // Starting balance
let activeBets = {} // Store bet info by ID
let myUsername = "User" + Math.floor(Math.random() * 1000)

// When there's a new connection, set up message handling
swarm.on('connection', (peer) => {
  // Name incoming peers after first 6 chars of its public key as hex
  const peerId = b4a.toString(peer.remotePublicKey, 'hex').substr(0, 6)
  
  peer.on('data', data => {
    try {
      const message = JSON.parse(b4a.toString(data))
      handleMessage(peerId, message)
    } catch (e) {
      console.error('Error parsing message:', e)
    }
  })
  
  peer.on('error', e => console.log(`Connection error: ${e}`))
  
  // Send your username to new peer
  sendToPeer(peer, {
    type: 'USERNAME',
    username: myUsername
  })
})

// Track usernames of connected peers
const peerUsernames = {}

// When there's updates to the swarm, update the peers count
swarm.on('update', () => {
  document.querySelector('#peers-count').textContent = swarm.connections.size
})

// Set up event listeners
document.querySelector('#create-bet-room').addEventListener('click', createBetRoom)
document.querySelector('#join-form').addEventListener('submit', joinBetRoom)
document.querySelector('#place-bet-form').addEventListener('submit', placeBet)
document.querySelector('#username-form').addEventListener('submit', setUsername)
document.querySelector('#create-bet-form').addEventListener('submit', createBet)

// Create a new betting room
async function createBetRoom() {
  // Generate a new random topic (32 byte string)
  const topicBuffer = crypto.randomBytes(32)
  joinSwarm(topicBuffer)
}

// Join an existing betting room
async function joinBetRoom(e) {
  e.preventDefault()
  const topicStr = document.querySelector('#join-bet-room-topic').value
  const topicBuffer = b4a.from(topicStr, 'hex')
  joinSwarm(topicBuffer)
}

// Join the swarm with the given topic
async function joinSwarm(topicBuffer) {
  document.querySelector('#setup').classList.add('hidden')
  document.querySelector('#loading').classList.remove('hidden')

  // Join the swarm with the topic. Setting both client/server to true means that this app can act as both.
  const discovery = swarm.join(topicBuffer, { client: true, server: true })
  await discovery.flushed()

  const topic = b4a.toString(topicBuffer, 'hex')
  document.querySelector('#bet-room-topic').innerText = topic
  document.querySelector('#loading').classList.add('hidden')
  document.querySelector('#betting').classList.remove('hidden')
  
  // Update balance display
  updateBalanceDisplay()
}

// Set username
function setUsername(e) {
  e.preventDefault()
  const usernameInput = document.querySelector('#username-input')
  myUsername = usernameInput.value || myUsername
  usernameInput.value = ''
  
  // Notify all peers of username change
  broadcastMessage({
    type: 'USERNAME',
    username: myUsername
  })
  
  // Update display
  document.querySelector('#my-username').textContent = myUsername
}

// Create a new bet
function createBet(e) {
  e.preventDefault()
  
  const description = document.querySelector('#bet-description').value
  const options = document.querySelector('#bet-options').value.split(',').map(opt => opt.trim())
  
  if (!description || options.length < 2) {
    addEventMessage('System', 'Please provide a description and at least 2 options')
    return
  }
  
  // Create a unique ID for this bet
  const betId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  
  // Create the bet object
  const bet = {
    id: betId,
    creator: myUsername,
    description,
    options,
    participants: {},
    status: 'open'
  }
  
  // Store locally
  activeBets[betId] = bet
  
  // Broadcast to all peers
  broadcastMessage({
    type: 'NEW_BET',
    bet
  })
  
  // Clear form
  document.querySelector('#bet-description').value = ''
  document.querySelector('#bet-options').value = ''
  
  // Add to the UI
  updateBetsDisplay()
  addEventMessage('System', `Created new bet: ${description}`)
}

// Place a bet on a specific option
function placeBet(e) {
  e.preventDefault()
  
  const betId = document.querySelector('#bet-id').value
  const option = document.querySelector('#bet-option').value
  const amount = parseInt(document.querySelector('#bet-amount').value)
  
  if (!betId || !option || isNaN(amount) || amount <= 0) {
    addEventMessage('System', 'Please fill all fields with valid values')
    return
  }
  
  // Check if bet exists
  if (!activeBets[betId]) {
    addEventMessage('System', 'Bet not found')
    return
  }
  
  // Check if bet is still open
  if (activeBets[betId].status !== 'open') {
    addEventMessage('System', 'This bet is no longer open')
    return
  }
  
  // Check if option is valid
  if (!activeBets[betId].options.includes(option)) {
    addEventMessage('System', 'Invalid option for this bet')
    return
  }
  
  // Check if user has enough balance
  if (amount > myBalance) {
    addEventMessage('System', 'Not enough balance')
    return
  }
  
  // Update balance
  myBalance -= amount
  updateBalanceDisplay()
  
  // Record the bet
  if (!activeBets[betId].participants[myUsername]) {
    activeBets[betId].participants[myUsername] = { option, amount }
  } else {
    // Add to existing bet if user already participated
    activeBets[betId].participants[myUsername].amount += amount
  }
  
  // Broadcast to all peers
  broadcastMessage({
    type: 'PLACE_BET',
    betId,
    username: myUsername,
    option,
    amount
  })
  
  // Clear form
  document.querySelector('#bet-id').value = ''
  document.querySelector('#bet-option').value = ''
  document.querySelector('#bet-amount').value = ''
  
  // Update UI
  updateBetsDisplay()
  addEventMessage('System', `You bet ${amount} on "${option}" for bet: ${activeBets[betId].description}`)
}

// Handle incoming messages
function handleMessage(peerId, message) {
  const peerName = peerUsernames[peerId] || peerId
  
  switch (message.type) {
    case 'USERNAME':
      peerUsernames[peerId] = message.username
      addEventMessage('System', `${peerId} is now known as ${message.username}`)
      break
      
    case 'NEW_BET':
      // Only add if we don't already have this bet
      if (!activeBets[message.bet.id]) {
        activeBets[message.bet.id] = message.bet
        updateBetsDisplay()
        addEventMessage('System', `${peerName} created a new bet: ${message.bet.description}`)
      }
      break
      
    case 'PLACE_BET':
      if (activeBets[message.betId]) {
        // Record the bet
        if (!activeBets[message.betId].participants[message.username]) {
          activeBets[message.betId].participants[message.username] = { 
            option: message.option, 
            amount: message.amount 
          }
        } else {
          // Add to existing bet if user already participated
          activeBets[message.betId].participants[message.username].amount += message.amount
        }
        
        updateBetsDisplay()
        addEventMessage('System', `${message.username} bet ${message.amount} on "${message.option}" for bet: ${activeBets[message.betId].description}`)
      }
      break
      
    case 'RESOLVE_BET':
      if (activeBets[message.betId]) {
        activeBets[message.betId].status = 'resolved'
        activeBets[message.betId].winner = message.winner
        
        // If I participated and picked the winning option, add winnings to balance
        const myBet = activeBets[message.betId].participants[myUsername]
        if (myBet && myBet.option === message.winner) {
          // Calculate total bet amount and winners' bet amount
          let totalAmount = 0
          let winningAmount = 0
          
          Object.values(activeBets[message.betId].participants).forEach(p => {
            totalAmount += p.amount
            if (p.option === message.winner) {
              winningAmount += p.amount
            }
          })
          
          // Calculate my winnings (proportional to my contribution among winners)
          const myWinnings = Math.floor(totalAmount * (myBet.amount / winningAmount))
          myBalance += myWinnings
          updateBalanceDisplay()
          addEventMessage('System', `You won ${myWinnings} from bet: ${activeBets[message.betId].description}`)
        }
        
        updateBetsDisplay()
        addEventMessage('System', `${peerName} resolved bet "${activeBets[message.betId].description}" with winner: ${message.winner}`)
      }
      break
      
    case 'CHAT':
      addEventMessage(message.username, message.text)
      break
  }
}

// Send chat message
document.querySelector('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const messageInput = document.querySelector('#chat-message')
  const text = messageInput.value
  
  if (!text) return
  
  messageInput.value = ''
  
  // Send to all peers
  broadcastMessage({
    type: 'CHAT',
    username: myUsername,
    text
  })
  
  // Add to local display
  addEventMessage(myUsername, text)
})

// Add resolve button functionality
document.querySelector('#resolve-bet-form').addEventListener('submit', (e) => {
  e.preventDefault()
  
  const betId = document.querySelector('#resolve-bet-id').value
  const winner = document.querySelector('#resolve-winner').value
  
  if (!betId || !winner) {
    addEventMessage('System', 'Please fill all fields')
    return
  }
  
  // Check if bet exists
  if (!activeBets[betId]) {
    addEventMessage('System', 'Bet not found')
    return
  }
  
  // Check if user is the creator
  if (activeBets[betId].creator !== myUsername) {
    addEventMessage('System', 'Only the creator can resolve this bet')
    return
  }
  
  // Check if bet is still open
  if (activeBets[betId].status !== 'open') {
    addEventMessage('System', 'This bet is already resolved')
    return
  }
  
  // Check if winner is a valid option
  if (!activeBets[betId].options.includes(winner)) {
    addEventMessage('System', 'Invalid winning option')
    return
  }
  
  // Resolve the bet
  activeBets[betId].status = 'resolved'
  activeBets[betId].winner = winner
  
  // Calculate winnings
  let totalAmount = 0
  let winningAmount = 0
  
  Object.values(activeBets[betId].participants).forEach(p => {
    totalAmount += p.amount
    if (p.option === winner) {
      winningAmount += p.amount
    }
  })
  
  // If I participated and picked the winning option, add winnings to balance
  const myBet = activeBets[betId].participants[myUsername]
  if (myBet && myBet.option === winner) {
    const myWinnings = Math.floor(totalAmount * (myBet.amount / winningAmount))
    myBalance += myWinnings
    updateBalanceDisplay()
    addEventMessage('System', `You won ${myWinnings} from bet: ${activeBets[betId].description}`)
  }
  
  // Broadcast to all peers
  broadcastMessage({
    type: 'RESOLVE_BET',
    betId,
    winner
  })
  
  // Clear form
  document.querySelector('#resolve-bet-id').value = ''
  document.querySelector('#resolve-winner').value = ''
  
  // Update UI
  updateBetsDisplay()
  addEventMessage('System', `You resolved bet "${activeBets[betId].description}" with winner: ${winner}`)
})

// Helper functions
function sendToPeer(peer, message) {
  peer.write(JSON.stringify(message))
}

function broadcastMessage(message) {
  const peers = [...swarm.connections]
  for (const peer of peers) {
    sendToPeer(peer, message)
  }
}

function addEventMessage(from, message) {
  const $div = document.createElement('div')
  $div.textContent = `<${from}> ${message}`
  document.querySelector('#events').appendChild($div)
  
  // Auto-scroll to bottom
  const events = document.querySelector('#events')
  events.scrollTop = events.scrollHeight
}

function updateBalanceDisplay() {
  document.querySelector('#balance').textContent = myBalance
  document.querySelector('#my-username').textContent = myUsername
}

function updateBetsDisplay() {
  const betsContainer = document.querySelector('#active-bets')
  betsContainer.innerHTML = ''
  
  Object.values(activeBets).forEach(bet => {
    const betEl = document.createElement('div')
    betEl.classList.add('bet-item')
    
    const statusClass = bet.status === 'open' ? 'open-bet' : 'resolved-bet'
    
    betEl.innerHTML = `
      <div class="bet-header ${statusClass}">
        <strong>ID: ${bet.id}</strong> - ${bet.description}
        <span class="bet-creator">by ${bet.creator}</span>
        <span class="bet-status">${bet.status.toUpperCase()}</span>
      </div>
      <div class="bet-options">
        Options: ${bet.options.join(', ')}
        ${bet.winner ? `<strong>(Winner: ${bet.winner})</strong>` : ''}
      </div>
      <div class="bet-participants">
        <small>Participants: ${Object.keys(bet.participants).length}</small>
      </div>
    `
    
    betsContainer.appendChild(betEl)
  })
}