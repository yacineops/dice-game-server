const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Dice Game Server is running!");
});

const wss = new WebSocket.Server({
    server: server
});

/* =========================
   البيانات العامة
========================= */

const matchmaking = {
    2: [],
    3: [],
    4: []
};

const rooms = new Map();

let nextGameId = 1;
let nextRoomId = 1;


/* =========================
   أدوات مساعدة
========================= */

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}


function broadcast(game, data) {
    if (!game || !game.players) return;

    for (const player of game.players) {
        send(player.ws, data);
    }
}


function getPlayer(game, playerId) {
    return game.players.find(p => p.id === playerId);
}


function getAlivePlayers(game) {
    return game.players.filter(p => p.coins > 0);
}


function createPlayer(ws, name) {
    return {
        ws: ws,
        id: 0,
        name: String(name || "Player").slice(0, 20),
        coins: 0,
        out: false
    };
}


/* =========================
   إرسال حالة اللعبة
========================= */

function getGamePlayers(game) {
    return game.players.map(player => ({
        id: player.id,
        name: player.name,
        coins: player.coins,
        out: player.coins <= 0
    }));
}


function sendGameState(game, extra = {}) {

    const data = {
        type: "game_state",

        gameId: game.id,

        playerCount: game.playerCount,

        players: getGamePlayers(game),

        currentPlayer: game.currentPlayer,

        phase: game.phase,

        winner: game.winner || null,

        ...extra
    };

    broadcast(game, data);
}


/* =========================
   بدء لعبة
========================= */

function startGame(players, playerCount) {

    const game = {
        id: nextGameId++,

        playerCount: playerCount,

        players: players,

        currentPlayer: 1,

        phase: "roll",

        pendingRoll: null,

        eligibleTargets: [],

        winner: null
    };


    players.forEach((player, index) => {

        player.id = index + 1;

        player.coins = 8;

        player.out = false;

        player.game = game;
    });


    for (const player of players) {
        player.ws.game = game;
        player.ws.playerId = player.id;
    }


    sendGameState(game);


    return game;
}


/* =========================
   البحث العشوائي
========================= */

function removeFromMatchmaking(ws) {

    for (const count of [2, 3, 4]) {

        matchmaking[count] =
            matchmaking[count].filter(item => item.ws !== ws);
    }

    ws.searching = false;
}


function sendWaiting(count) {

    const list = matchmaking[count];

    const message = {
        type: "waiting",

        playerCount: list.length,

        maxPlayers: count
    };

    for (const item of list) {
        send(item.ws, message);
    }
}


function findMatch(ws, name, playerCount) {

    playerCount = Number(playerCount);

    if (![2, 3, 4].includes(playerCount)) {
        send(ws, {
            type: "room_error",
            message: "عدد اللاعبين غير صحيح"
        });

        return;
    }


    removeFromMatchmaking(ws);


    const player = createPlayer(ws, name);

    player.searching = true;

    matchmaking[playerCount].push(player);

    ws.searching = true;


    sendWaiting(playerCount);


    if (matchmaking[playerCount].length >= playerCount) {

        const selected =
            matchmaking[playerCount].splice(0, playerCount);


        selected.forEach(p => {
            p.searching = false;
            p.ws.searching = false;
        });


        const game =
            startGame(selected, playerCount);


        for (const p of selected) {

            send(p.ws, {
                type: "matched",

                gameId: game.id,

                player: p.id,

                playerCount: playerCount,

                players: getGamePlayers(game)
            });
        }


        sendGameState(game);
    }
}


/* =========================
   الغرف الخاصة
========================= */

function generateRoomCode() {

    let code;

    do {
        code =
            Math.floor(100000 + Math.random() * 900000).toString();
    }
    while (rooms.has(code));

    return code;
}


function createRoom(ws, name, playerCount) {

    playerCount = Number(playerCount);

    if (![2, 3, 4].includes(playerCount)) {

        send(ws, {
            type: "room_error",
            message: "عدد اللاعبين يجب أن يكون 2 أو 3 أو 4"
        });

        return;
    }


    const code = generateRoomCode();


    const player = createPlayer(ws, name);


    const room = {

        code: code,

        playerCount: playerCount,

        players: [player],

        game: null
    };


    rooms.set(code, room);


    ws.room = room;


    send(ws, {

        type: "room_created",

        roomCode: code,

        playerCount: playerCount,

        players: room.players.map(p => ({
            id: 1,
            name: p.name
        }))
    });


    sendRoomWaiting(room);
}


function sendRoomWaiting(room) {

    const players = room.players.map((p, index) => ({
        id: index + 1,
        name: p.name
    }));


    for (const player of room.players) {

        send(player.ws, {

            type: "room_players",

            roomCode: room.code,

            playerCount: room.playerCount,

            players: players,

            maxPlayers: room.playerCount
        });
    }
}


function joinRoom(ws, name, roomCode) {

    roomCode =
        String(roomCode || "").trim();


    if (!rooms.has(roomCode)) {

        send(ws, {
            type: "room_error",
            message: "الغرفة غير موجودة"
        });

        return;
    }


    const room = rooms.get(roomCode);


    if (room.game) {

        send(ws, {
            type: "room_error",
            message: "اللعبة بدأت بالفعل"
        });

        return;
    }


    if (room.players.length >= room.playerCount) {

        send(ws, {
            type: "room_error",
            message: "الغرفة ممتلئة"
        });

        return;
    }


    const player = createPlayer(ws, name);

    player.room = room;

    room.players.push(player);

    ws.room = room;


    sendRoomWaiting(room);


    if (room.players.length === room.playerCount) {

        rooms.delete(room.code);


        const game =
            startGame(room.players, room.playerCount);


        room.game = game;


        for (const p of room.players) {

            send(p.ws, {

                type: "matched",

                gameId: game.id,

                player: p.id,

                playerCount: game.playerCount,

                players: getGamePlayers(game)
            });
        }


        sendGameState(game);
    }
}


/* =========================
   رمية النرد
========================= */

function rollDice(ws) {

    const game = ws.game;

    if (!game) {

        send(ws, {
            type: "room_error",
            message: "لا توجد لعبة"
        });

        return;
    }


    const playerId = ws.playerId;


    if (game.winner) return;


    if (game.currentPlayer !== playerId) {

        send(ws, {
            type: "room_error",
            message: "ليس دورك"
        });

        return;
    }


    if (game.phase !== "roll") {

        send(ws, {
            type: "room_error",
            message: "لا يمكنك الرمي الآن"
        });

        return;
    }


    const player =
        getPlayer(game, playerId);


    if (!player || player.coins <= 0) {

        nextTurn(game);

        return;
    }


    const roll =
        Math.floor(Math.random() * 6) + 1;


    game.pendingRoll = roll;


    const eligibleTargets =
        game.players
            .filter(p =>
                p.id !== playerId &&
                p.coins >= roll
            )
            .map(p => p.id);


    game.eligibleTargets =
        eligibleTargets;


    if (eligibleTargets.length === 0) {

        sendGameState(game, {

            roll: roll,

            roller: playerId,

            phase: "no_target"
        });


        setTimeout(() => {

            if (
                game.winner ||
                game.currentPlayer !== playerId
            ) {
                return;
            }

            nextTurn(game);

        }, 700);


        return;
    }


    game.phase = "target";


    broadcast(game, {

        type: "dice_result",

        roll: roll,

        roller: playerId,

        currentPlayer: playerId,

        phase: "target",

        eligibleTargets: eligibleTargets,

        players: getGamePlayers(game)
    });


    /* في حالة وجود خصم واحد فقط
       لا نختار نيابة عن العميل.
       العميل سيرسل target. */
}


/* =========================
   اختيار الخصم
========================= */

function chooseTarget(ws, targetId) {

    const game = ws.game;

    if (!game) return;


    targetId = Number(targetId);


    const playerId = ws.playerId;


    if (game.winner) return;


    if (game.currentPlayer !== playerId) {

        send(ws, {
            type: "room_error",
            message: "ليس دورك"
        });

        return;
    }


    if (game.phase !== "target") {

        send(ws, {
            type: "room_error",
            message: "لا يوجد اختيار هدف الآن"
        });

        return;
    }


    if (!game.eligibleTargets.includes(targetId)) {

        send(ws, {
            type: "room_error",
            message: "هذا اللاعب غير صالح كهدف"
        });

        return;
    }


    const roller =
        getPlayer(game, playerId);


    const target =
        getPlayer(game, targetId);


    if (!roller || !target) return;


    const roll =
        game.pendingRoll;


    if (target.coins < roll) {

        send(ws, {
            type: "room_error",
            message: "الخصم لا يملك عملات كافية"
        });

        return;
    }


    const oldCoins = {
        roller: roller.coins,
        target: target.coins
    };


    /* نقل العملات */

    target.coins -= roll;

    roller.coins += roll;


    if (target.coins <= 0) {
        target.coins = 0;
        target.out = true;
    }


    roller.out = roller.coins <= 0;


    const alive =
        getAlivePlayers(game);


    /* فوز */

    if (alive.length === 1) {

        game.winner = alive[0].id;

        game.phase = "game_over";

        sendGameState(game, {

            roll: roll,

            target: targetId,

            oldCoins: oldCoins,

            winner: game.winner
        });


        broadcast(game, {

            type: "game_over",

            winner: game.winner,

            players: getGamePlayers(game)
        });


        return;
    }


    /* الجولة التالية */

    game.pendingRoll = null;

    game.eligibleTargets = [];

    game.phase = "roll";


    const next =
        findNextAlivePlayer(game, playerId);


    game.currentPlayer = next;


    sendGameState(game, {

        roll: roll,

        target: targetId,

        oldCoins: oldCoins
    });
}


/* =========================
   الدور التالي
========================= */

function findNextAlivePlayer(game, currentId) {

    for (let i = 1; i <= game.playerCount; i++) {

        const id =
            ((currentId - 1 + i) % game.playerCount) + 1;


        const player =
            getPlayer(game, id);


        if (player && player.coins > 0) {
            return id;
        }
    }


    return currentId;
}


function nextTurn(game) {

    if (!game || game.winner) return;


    const alive =
        getAlivePlayers(game);


    if (alive.length <= 1) {

        if (alive.length === 1) {
            game.winner = alive[0].id;
        }

        game.phase = "game_over";


        broadcast(game, {

            type: "game_over",

            winner: game.winner,

            players: getGamePlayers(game)
        });


        return;
    }


    game.currentPlayer =
        findNextAlivePlayer(
            game,
            game.currentPlayer
        );


    game.pendingRoll = null;

    game.eligibleTargets = [];

    game.phase = "roll";


    sendGameState(game);
}


/* =========================
   قطع الاتصال
========================= */

function handleDisconnect(ws) {

    removeFromMatchmaking(ws);


    /* إذا كان داخل غرفة تنتظر اللاعبين */

    if (ws.room && !ws.game) {

        const room = ws.room;


        room.players =
            room.players.filter(p => p.ws !== ws);


        if (room.players.length === 0) {

            rooms.delete(room.code);

        } else {

            sendRoomWaiting(room);
        }
    }


    /* إذا كان داخل لعبة */

    const game = ws.game;


    if (!game) return;


    const disconnectedId =
        ws.playerId;


    const remaining =
        game.players.filter(
            p => p.ws.readyState === WebSocket.OPEN
        );


    /* إخبار اللاعبين */

    for (const player of game.players) {

        if (player.ws !== ws) {

            send(player.ws, {

                type: "opponent_disconnected",

                player: disconnectedId,

                players: getGamePlayers(game)
            });
        }
    }


    /* إذا بقي لاعب واحد فقط */

    if (remaining.length === 1) {

        const winner =
            remaining[0];


        game.winner =
            winner.id;


        game.phase =
            "game_over";


        broadcast(game, {

            type: "game_over",

            winner: winner.id,

            players: getGamePlayers(game)
        });
    }
}


/* =========================
   WebSocket
========================= */

wss.on("connection", ws => {

    ws.searching = false;

    send(ws, {
        type: "connected"
    });


    ws.on("message", raw => {

        let data;


        try {

            data =
                JSON.parse(raw.toString());

        } catch (e) {

            send(ws, {
                type: "room_error",
                message: "بيانات غير صحيحة"
            });

            return;
        }


        const type =
            data.type;


        /* البحث */

        if (type === "find_match") {

            findMatch(
                ws,
                data.name,
                data.playerCount
            );

            return;
        }


        /* إلغاء البحث */

        if (type === "cancel_search") {

            removeFromMatchmaking(ws);

            send(ws, {
                type: "search_cancelled"
            });

            return;
        }


        /* إنشاء غرفة */

        if (type === "create_room") {

            createRoom(
                ws,
                data.name,
                data.playerCount
            );

            return;
        }


        /* دخول غرفة */

        if (type === "join_room") {

            joinRoom(
                ws,
                data.name,
                data.roomCode
            );

            return;
        }


        /* رمي النرد */

        if (type === "roll") {

            rollDice(ws);

            return;
        }


        /* اختيار الخصم */

        if (type === "target") {

            chooseTarget(
                ws,
                data.targetPlayer
            );

            return;
        }


        /* مغادرة اللعبة */

        if (type === "leave_game") {

            try {
                ws.close();
            } catch (e) {}

            return;
        }
    });


    ws.on("close", () => {

        handleDisconnect(ws);
    });


    ws.on("error", () => {

        handleDisconnect(ws);
    });
});


/* =========================
   تشغيل السيرفر
========================= */

server.listen(PORT, () => {

    console.log(
        `Dice Game Server running on port ${PORT}`
    );
});
