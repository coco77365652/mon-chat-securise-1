const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Fichiers statiques dans le dossier public
app.use(express.static(path.join(__dirname, 'public')));

// Variables d'environnement
const ADMIN_CODE = process.env.ADMIN_CODE || '151515';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

// Stockage en mémoire
const userCodes = new Map(); // code -> { code, pseudo }
const conversations = new Map(); // code -> { label, messages: [] }
const activeSessions = new Map(); // socket.id -> { role, code }

// Fonction pour envoyer une notification Discord
async function sendDiscordNotification(pseudo, text) {
    if (!DISCORD_WEBHOOK_URL) return;

    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'Notification Chat',
                embeds: [{
                    title: '💬 Nouveau message reçu',
                    description: `**${pseudo}** : ${text}`,
                    color: 0x4f46e5,
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (err) {
        console.error('Erreur lors de l\'envoi de la notification Discord:', err);
    }
}

// Nettoyage automatique des messages toutes les 10 secondes (messages > 1 minute)
setInterval(() => {
    const now = Date.now();
    const expireTime = 60 * 1000; // 1 minute (60 000 ms)

    conversations.forEach((conv, targetCode) => {
        const remainingMessages = [];

        conv.messages.forEach((msg) => {
            if (now - msg.ts > expireTime) {
                // Notifier les clients que ce message est expiré
                io.to(`room_${targetCode}`).emit('message_deleted', { targetCode, ts: msg.ts });
                io.to('admin_room').emit('message_deleted', { targetCode, ts: msg.ts });
            } else {
                remainingMessages.push(msg);
            }
        });

        conv.messages = remainingMessages;
    });
}, 10000);

io.on('connection', (socket) => {

    // Authentification
    socket.on('authenticate', (inputCode) => {
        const code = String(inputCode).trim();

        if (code === ADMIN_CODE) {
            activeSessions.set(socket.id, { role: 'admin' });
            socket.join('admin_room');

            const codesList = Array.from(userCodes.values());
            const convList = [];
            conversations.forEach((conv, key) => {
                convList.push({
                    code: key,
                    label: conv.label,
                    messages: conv.messages
                });
            });

            socket.emit('auth_success', {
                role: 'admin',
                codes: codesList,
                conversations: convList
            });
        } else if (userCodes.has(code)) {
            const user = userCodes.get(code);
            activeSessions.set(socket.id, { role: 'user', code: code });
            socket.join(`room_${code}`);

            if (!conversations.has(code)) {
                conversations.set(code, { label: user.pseudo, messages: [] });
            }

            const conv = conversations.get(code);
            socket.emit('auth_success', {
                role: 'user',
                code: code,
                messages: conv.messages
            });
        } else {
            socket.emit('auth_error', 'Code d\'accès invalide.');
        }
    });

    // Envoi de message
    socket.on('send_message', ({ text, targetCode }) => {
        const session = activeSessions.get(socket.id);
        if (!session) return;

        const messageText = String(text).trim();
        if (!messageText) return;

        const timestamp = Date.now();

        if (session.role === 'admin') {
            if (!targetCode || !conversations.has(targetCode)) return;

            const msg = { from: 'admin', text: messageText, ts: timestamp };
            conversations.get(targetCode).messages.push(msg);

            io.to(`room_${targetCode}`).emit('new_message', { targetCode, message: msg });
            io.to('admin_room').emit('new_message', { targetCode, message: msg });

        } else if (session.role === 'user') {
            const userCode = session.code;
            if (!conversations.has(userCode)) return;

            const user = userCodes.get(userCode);
            const msg = { from: 'user', text: messageText, ts: timestamp };
            conversations.get(userCode).messages.push(msg);

            io.to(`room_${userCode}`).emit('new_message', { targetCode: userCode, message: msg });
            io.to('admin_room').emit('new_message', { targetCode: userCode, message: msg });

            // Envoi de la notification sur Discord
            sendDiscordNotification(user ? user.pseudo : 'Utilisateur', messageText);
        }
    });

    // Admin : Générer un code
    socket.on('admin_generate_code', (customPseudo) => {
        const session = activeSessions.get(socket.id);
        if (!session || session.role !== 'admin') return;

        const pseudo = String(customPseudo).trim() || 'Utilisateur';
        const newCode = Math.floor(100000 + Math.random() * 900000).toString();

        const entry = { code: newCode, pseudo: pseudo };
        userCodes.set(newCode, entry);
        conversations.set(newCode, { label: pseudo, messages: [] });

        io.to('admin_room').emit('code_generated', entry);
    });

    // Admin : Supprimer un code
    socket.on('admin_delete_code', (codeToDelete) => {
        const session = activeSessions.get(socket.id);
        if (!session || session.role !== 'admin') return;

        userCodes.delete(codeToDelete);
        conversations.delete(codeToDelete);

        io.to('admin_room').emit('code_deleted', codeToDelete);
    });

    socket.on('disconnect', () => {
        activeSessions.delete(socket.id);
    });
});

// Port dynamique Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré avec succès sur le port ${PORT}`);
});
