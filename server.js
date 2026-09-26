const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Fichiers statiques dans le dossier public
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_CODE = process.env.ADMIN_CODE || '151515';

io.on('connection', (socket) => {
    console.log('Un utilisateur s\'est connecté :', socket.id);

    socket.on('join_room', ({ roomCode, pseudo }) => {
        socket.join(roomCode);
        socket.pseudo = pseudo || 'Anonyme';
        socket.roomCode = roomCode;

        io.to(roomCode).emit('user_joined', {
            pseudo: socket.pseudo,
            message: `${socket.pseudo} a rejoint le salon.`
        });
    });

    socket.on('send_message', (data) => {
        if (!socket.roomCode) return;

        const messageData = {
            id: Date.now() + Math.random().toString(),
            pseudo: socket.pseudo,
            text: data.text,
            timestamp: new Date().toLocaleTimeString()
        };

        io.to(socket.roomCode).emit('new_message', messageData);
    });

    socket.on('disconnect', () => {
        if (socket.roomCode) {
            io.to(socket.roomCode).emit('user_left', {
                pseudo: socket.pseudo,
                message: `${socket.pseudo} a quitté le salon.`
            });
        }
    });
});

// Port requis pour Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré avec succès sur le port ${PORT}`);
});
