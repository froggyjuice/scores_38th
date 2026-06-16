const express = require('express');
const http = require('http');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'states.json');

// Initialize states database from file if exists
let statesDb = {};
if (fs.existsSync(STATE_FILE)) {
    try {
        const fileContent = fs.readFileSync(STATE_FILE, 'utf8');
        statesDb = JSON.parse(fileContent);
        console.log('Loaded existing states from states.json');
    } catch (e) {
        console.error('Failed to parse states.json, starting fresh:', e);
        statesDb = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(statesDb, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to write states.json:', e);
    }
}

// Setup Express app
const app = express();
app.use(express.static(__dirname)); // Serve index.html and other static files from this dir

// REST endpoint to fetch current states (as a fallback or initial fetch)
app.get('/api/states', (req, res) => {
    res.json(statesDb);
});

// Create HTTP Server
const server = http.createServer(app);

// Setup WebSocket Server on top of HTTP server
const wss = new ws.Server({ server });

wss.on('connection', (socket) => {
    console.log('Client connected. Total clients:', wss.clients.size);

    // Send initial state dump on connect
    socket.send(JSON.stringify({
        type: 'INIT',
        states: statesDb
    }));

    // Handle messages
    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'UPDATE_STATE') {
                const { name, inst, piece, state } = data;
                const key = `${name}_${inst}_${piece}`;
                
                // Save to memory and JSON database
                statesDb[key] = state;
                saveDatabase();

                // Broadcast update to all other connected clients
                broadcast(socket, {
                    type: 'UPDATE_STATE',
                    name,
                    inst,
                    piece,
                    state
                });
            } 
            else if (data.type === 'BATCH_UPDATE') {
                const { name, inst, pieceStates } = data;
                
                // Update multiple pieces in memory
                pieceStates.forEach(({ piece, state }) => {
                    const key = `${name}_${inst}_${piece}`;
                    statesDb[key] = state;
                });
                saveDatabase();

                // Broadcast batch update to all other connected clients
                broadcast(socket, {
                    type: 'BATCH_UPDATE',
                    name,
                    inst,
                    pieceStates
                });
            }
        } catch (e) {
            console.error('Error handling WebSocket message:', e);
        }
    });

    socket.on('close', () => {
        console.log('Client disconnected. Total clients:', wss.clients.size);
    });
});

// Broadcast helper (sends to all clients EXCEPT the sender)
function broadcast(senderSocket, messageObj) {
    const payload = JSON.stringify(messageObj);
    wss.clients.forEach((client) => {
        if (client !== senderSocket && client.readyState === ws.OPEN) {
            client.send(payload);
        }
    });
}

// Start Server
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
