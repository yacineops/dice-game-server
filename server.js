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
   إعدادات النقاط
========================= */

const STARTING_POINTS = 500;
const GAME_COST = 5;
const WIN_REWARD = 20;


/*
   النقاط محفوظة في السيرفر.

   نستخدم اسم اللاعب كمُعرّف لأن اللعبة
   لا تحتوي على تسجيل دخول.
*/
const playerPoints = new Map();


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


/* =========================
   أدوات النقاط
========================= */

function getPlayerKey(name) {

    return String(name || "Player")
        .trim()
        .toLowerCase()
        .slice(0, 20);
}


function getPoints(name) {

    const key = getPlayerKey(name);

    if (!playerPoints.has(key)) {
        playerPoints.set(key, STARTING_POINTS);
    }

    return playerPoints.get(key);
}


function setPoints(name, points) {

    const key = getPlayerKey(name);

    points = Math.max(0, Number(points) || 0);

    playerPoints.set(key, points);

    return points;
}


function addPoints(name, amount) {

    const current = getPoints(name);

    return setPoints(
        name,
        current + Number(amount || 0)
    );
}


function removePoints(name, amount) {

    const current = getPoints(name);

    return setPoints(
        name,
        current - Number(amount || 0)
    );
}


function getRank(name) {

    const currentPoints = getPoints(name);

    const allPoints = [];

    for (const points of playerPoints.values()) {
        allPoints.push(points);
    }

    allPoints.sort((a, b) => b - a);

    const index = allPoints.indexOf(currentPoints);

    return index >= 0 ? index + 1 : 1;
}


function sendPlayerStats(player) {

    if (!player || !player.ws) return;

    const points = getPoints(player.name);
    const rank = getRank(player.name);

    send(player.ws, {
        type: "player_stats",
        points: points,
        rank: rank
    });
}


function sendPointsUpdate(player) {

    if (!player || !player.ws) return;

    const points = getPoints(player.name);
    const rank = getRank(player.name);

    send(player.ws, {
        type: "points_update",
        points: points
    });

    send(player.ws, {
        type: "rank_update",
        rank: rank
    });

    send(player.ws, {
        type: "player_stats",
        points: points,
        rank: rank
    });
}


function hasEnoughPoints(name) {

    return getPoints(name) >= GAME_COST;
}


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

    return game.players.find(
        p => p.id === playerId
    );
}


function getAlivePlayers(game) {

    return game.players.filter(
        p => p.coins > 0
    );
}


function createPlayer(ws, name) {

    const cleanName =
        String(name || "Player")
            .trim()
            .slice(0, 20) || "Player";

    return {

        ws: ws,

        id: 0,

        name: cleanName,

        coins: 0,

        out: false,

        game: null,

        room: null,

        paid: false,

        rewardGiven: false
    };
}


function getGamePlayers(game) {

    return game.players.map(player => ({

        id: player.id,

        name: player.name,

        coins: player.coins,

        out: player.coins <= 0
    }));
}


/* =========================
   عداد المتصلين
========================= */

function getOnlineCount() {

    let count = 0;

    for (const ws of wss.clients) {

        if (ws.readyState === WebSocket.OPEN) {
            count++;
        }
    }

    return count;
}


function broadcastOnlineCount() {

    const count = getOnlineCount();

    for (const ws of wss.clients) {

        send(ws, {

            type: "online_count",

            count: count
        });
    }
}


/* =========================
   إرسال حالة اللعبة
========================= */

function sendGameState(game, extra = {}) {

    if (!game) return;

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
   دفع تكلفة اللعبة
========================= */

function chargePlayers(players) {

    for (const player of players) {

        if (!hasEnoughPoints(player.name)) {

            return false;
        }
    }


    for (const player of players) {

        removePoints(
            player.name,
            GAME_COST
        );

        player.paid = true;

        sendPointsUpdate(player);
    }

    return true;
}


/* =========================
   مكافأة الفائز
========================= */

function rewardWinner(game, winnerPlayer) {

    if (!game || !winnerPlayer) return;

    /*
       منع إعطاء المكافأة أكثر من مرة
    */

    if (game.rewardGiven) return;

    game.rewardGiven = true;

    winnerPlayer.rewardGiven = true;


    const newPoints =
        addPoints(
            winnerPlayer.name,
            WIN_REWARD
        );


    send(winnerPlayer.ws, {

        type: "points_update",

        points: newPoints,

        reward: WIN_REWARD
    });


    send(winnerPlayer.ws, {

        type: "rank_update",

        rank: getRank(winnerPlayer.name)
    });


    send(winnerPlayer.ws, {

        type: "player_stats",

        points: newPoints,

        rank: getRank(winnerPlayer.name)
    });
}


/* =========================
   بدء لعبة
========================= */

function startGame(players, playerCount) {

    /*
       التأكد من النقاط قبل بدء اللعبة
    */

    if (!chargePlayers(players)) {

        for (const player of players) {

            send(player.ws, {

                type: "room_error",

                message:
                    "لا يمكن بدء اللعبة. يجب أن يملك كل لاعب 5 نقاط على الأقل."
            });
        }

        return null;
    }


    const game = {

        id: nextGameId++,

        playerCount: playerCount,

        players: players,

        currentPlayer: 1,

        phase: "roll",

        pendingRoll: null,

        eligibleTargets: [],

        winner: null,

        rewardGiven: false
    };


    players.forEach((player, index) => {

        player.id = index + 1;

        player.coins = 8;

        player.out = false;

        player.game = game;

        player.ws.game = game;

        player.ws.playerId = player.id;
    });


    sendGameState(game);

    return game;
}


/* =========================
   البحث عن لعبة
========================= */

function removeFromMatchmaking(ws) {

    for (const count of [2, 3, 4]) {

        matchmaking[count] =
            matchmaking[count].filter(
                item => item.ws !== ws
            );
    }

    ws.searching = false;
}


function sendWaiting(count) {

    const list =
        matchmaking[count];

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


    const cleanName =
        String(name || "Player")
            .trim()
            .slice(0, 20) || "Player";


    /*
       فحص الرصيد قبل الدخول إلى البحث
    */

    if (!hasEnoughPoints(cleanName)) {

        send(ws, {

            type: "room_error",

            message:
                "رصيدك غير كافٍ. تحتاج إلى 5 نقاط للعب أونلاين."
        });

        send(ws, {

            type: "insufficient_points",

            points: getPoints(cleanName),

            required: GAME_COST
        });

        return;
    }


    removeFromMatchmaking(ws);


    const player =
        createPlayer(ws, cleanName);


    player.searching = true;


    matchmaking[playerCount].push(player);

    ws.searching = true;


    sendPlayerStats(player);

    sendWaiting(playerCount);


    /*
       حذف اللاعبين الذين لم يعد لديهم رصيد كافٍ
    */

    matchmaking[playerCount] =
        matchmaking[playerCount].filter(p => {

            if (!hasEnoughPoints(p.name)) {

                p.searching = false;
                p.ws.searching = false;

                send(p.ws, {

                    type: "room_error",

                    message:
                        "رصيدك أصبح أقل من 5 نقاط."
                });

                return false;
            }

            return true;
        });


    sendWaiting(playerCount);


    if (matchmaking[playerCount].length >= playerCount) {

        const selected =
            matchmaking[playerCount]
                .splice(0, playerCount);


        selected.forEach(p => {

            p.searching = false;

            p.ws.searching = false;
        });


        const game =
            startGame(
                selected,
                playerCount
            );


        if (!game) {

            return;
        }


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
            Math.floor(
                100000 +
                Math.random() * 900000
            ).toString();

    } while (rooms.has(code));

    return code;
}


function createRoom(ws, name, playerCount) {

    playerCount = Number(playerCount);


    if (![2, 3, 4].includes(playerCount)) {

        send(ws, {

            type: "room_error",

            message:
                "عدد اللاعبين يجب أن يكون 2 أو 3 أو 4"
        });

        return;
    }


    const cleanName =
        String(name || "Player")
            .trim()
            .slice(0, 20) || "Player";


    /*
       فحص النقاط قبل إنشاء الغرفة
    */

    if (!hasEnoughPoints(cleanName)) {

        send(ws, {

            type: "room_error",

            message:
                "رصيدك غير كافٍ. تحتاج إلى 5 نقاط لإنشاء غرفة."
        });

        send(ws, {

            type: "insufficient_points",

            points: getPoints(cleanName),

            required: GAME_COST
        });

        return;
    }


    removeFromMatchmaking(ws);


    const code =
        generateRoomCode();


    const player =
        createPlayer(ws, cleanName);


    const room = {

        code: code,

        playerCount: playerCount,

        players: [player],

        game: null
    };


    player.room = room;

    ws.room = room;


    rooms.set(code, room);


    sendPlayerStats(player);


    send(ws, {

        type: "room_created",

        roomCode: code,

        playerCount: playerCount,

        cost: GAME_COST,

        players:
            room.players.map(
                (p, index) => ({

                    id: index + 1,

                    name: p.name
                })
            )
    });


    sendRoomWaiting(room);
}


function sendRoomWaiting(room) {

    if (!room) return;


    const players =
        room.players.map(
            (p, index) => ({

                id: index + 1,

                name: p.name
            })
        );


    for (const player of room.players) {

        send(player.ws, {

            type: "room_players",

            roomCode: room.code,

            playerCount:
                room.players.length,

            players: players,

            maxPlayers:
                room.playerCount
        });
    }
}


function joinRoom(ws, name, roomCode) {

    roomCode =
        String(roomCode || "").trim();


    if (!rooms.has(roomCode)) {

        send(ws, {

            type: "room_error",

            message:
                "الغرفة غير موجودة"
        });

        return;
    }


    const room =
        rooms.get(roomCode);


    if (room.game) {

        send(ws, {

            type: "room_error",

            message:
                "اللعبة بدأت بالفعل"
        });

        return;
    }


    if (
        room.players.length >=
        room.playerCount
    ) {

        send(ws, {

            type: "room_error",

            message:
                "الغرفة ممتلئة"
        });

        return;
    }


    const cleanName =
        String(name || "Player")
            .trim()
            .slice(0, 20) || "Player";


    /*
       فحص رصيد اللاعب
    */

    if (!hasEnoughPoints(cleanName)) {

        send(ws, {

            type: "room_error",

            message:
                "رصيدك غير كافٍ. تحتاج إلى 5 نقاط لدخول الغرفة."
        });

        send(ws, {

            type: "insufficient_points",

            points: getPoints(cleanName),

            required: GAME_COST
        });

        return;
    }


    removeFromMatchmaking(ws);


    const player =
        createPlayer(ws, cleanName);


    player.room = room;

    room.players.push(player);

    ws.room = room;


    sendPlayerStats(player);

    sendRoomWaiting(room);


    /*
       بدأت اللعبة
    */

    if (
        room.players.length ===
        room.playerCount
    ) {

        /*
           تأكيد أن الجميع يملك 5 نقاط
        */

        const canStart =
            room.players.every(
                p => hasEnoughPoints(p.name)
            );


        if (!canStart) {

            for (const p of room.players) {

                send(p.ws, {

                    type: "room_error",

                    message:
                        "لا يمكن بدء اللعبة لأن أحد اللاعبين لا يملك 5 نقاط."
                });
            }

            return;
        }


        rooms.delete(room.code);


        const game =
            startGame(
                room.players,
                room.playerCount
            );


        if (!game) {

            return;
        }


        room.game = game;


        for (const p of room.players) {

            send(p.ws, {

                type: "matched",

                gameId: game.id,

                player: p.id,

                playerCount:
                    game.playerCount,

                players:
                    getGamePlayers(game)
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

            message:
                "لا توجد لعبة"
        });

        return;
    }


    const playerId =
        ws.playerId;


    if (game.winner) return;


    if (
        game.currentPlayer !==
        playerId
    ) {

        send(ws, {

            type: "room_error",

            message:
                "ليس دورك"
        });

        return;
    }


    if (game.phase !== "roll") {

        send(ws, {

            type: "room_error",

            message:
                "لا يمكنك الرمي الآن"
        });

        return;
    }


    const player =
        getPlayer(
            game,
            playerId
        );


    if (
        !player ||
        player.coins <= 0
    ) {

        nextTurn(game);

        return;
    }


    /* نتيجة النرد من السيرفر */

    const roll =
        Math.floor(
            Math.random() * 6
        ) + 1;


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


    /* لا يوجد هدف */

    if (
        eligibleTargets.length === 0
    ) {

        game.phase =
            "no_target";


        sendGameState(game, {

            roll: roll,

            roller: playerId,

            phase: "no_target"
        });


        setTimeout(() => {

            if (
                game.winner ||
                game.currentPlayer !== playerId ||
                game.phase !== "no_target"
            ) {

                return;
            }


            nextTurn(game);

        }, 700);


        return;
    }


    /* يوجد هدف */

    game.phase =
        "target";


    const publicDiceResult = {

        type: "dice_result",

        roll: roll,

        roller: playerId,

        currentPlayer: playerId,

        phase: "target",

        players:
            getGamePlayers(game)
    };


    for (const p of game.players) {

        if (p.id === playerId) {

            send(p.ws, {

                ...publicDiceResult,

                eligibleTargets:
                    eligibleTargets
            });

        } else {

            send(
                p.ws,
                publicDiceResult
            );
        }
    }
}


/* =========================
   اختيار الخصم
========================= */

function chooseTarget(ws, targetId) {

    const game = ws.game;


    if (!game) return;


    targetId =
        Number(targetId);


    const playerId =
        ws.playerId;


    if (game.winner) return;


    if (
        game.currentPlayer !==
        playerId
    ) {

        send(ws, {

            type: "room_error",

            message:
                "ليس دورك"
        });

        return;
    }


    if (game.phase !== "target") {

        send(ws, {

            type: "room_error",

            message:
                "لا يوجد اختيار هدف الآن"
        });

        return;
    }


    if (
        !game.eligibleTargets
            .includes(targetId)
    ) {

        send(ws, {

            type: "room_error",

            message:
                "هذا اللاعب غير صالح كهدف"
        });

        return;
    }


    const roller =
        getPlayer(
            game,
            playerId
        );


    const target =
        getPlayer(
            game,
            targetId
        );


    if (!roller || !target) return;


    const roll =
        Number(
            game.pendingRoll
        );


    if (
        !roll ||
        roll < 1 ||
        roll > 6
    ) {

        game.phase = "roll";

        game.pendingRoll = null;

        game.eligibleTargets = [];

        return;
    }


    if (target.coins < roll) {

        send(ws, {

            type: "room_error",

            message:
                "الخصم لا يملك عملات كافية"
        });

        return;
    }


    const oldCoins = {

        roller:
            roller.coins,

        target:
            target.coins
    };


    /* نقل العملات */

    target.coins -= roll;

    roller.coins += roll;


    if (target.coins <= 0) {

        target.coins = 0;

        target.out = true;
    }


    roller.out =
        roller.coins <= 0;


    const alive =
        getAlivePlayers(game);


    /* =========================
       فوز
    ========================= */

    if (alive.length === 1) {

        game.winner =
            alive[0].id;

        game.phase =
            "game_over";

        game.pendingRoll = null;

        game.eligibleTargets = [];


        /*
           إعطاء الفائز +10
        */

        rewardWinner(
            game,
            alive[0]
        );


        sendGameState(game, {

            roll: roll,

            target: targetId,

            roller: playerId,

            oldCoins: oldCoins,

            winner:
                game.winner
        });


        broadcast(game, {

            type: "game_over",

            winner:
                game.winner,

            reward:
                WIN_REWARD,

            players:
                getGamePlayers(game)
        });


        return;
    }


    /* =========================
       الجولة التالية
    ========================= */

    game.pendingRoll = null;

    game.eligibleTargets = [];

    game.phase = "roll";


    const next =
        findNextAlivePlayer(
            game,
            playerId
        );


    game.currentPlayer =
        next;


    sendGameState(game, {

        roll: roll,

        target: targetId,

        roller: playerId,

        oldCoins: oldCoins
    });
}


/* =========================
   الدور التالي
========================= */

function findNextAlivePlayer(
    game,
    currentId
) {

    for (
        let i = 1;
        i <= game.playerCount;
        i++
    ) {

        const id =
            (
                (currentId - 1 + i) %
                game.playerCount
            ) + 1;


        const player =
            getPlayer(game, id);


        if (
            player &&
            player.coins > 0
        ) {

            return id;
        }
    }


    return currentId;
}


function nextTurn(game) {

    if (!game || game.winner)
        return;


    const alive =
        getAlivePlayers(game);


    if (alive.length <= 1) {

        if (alive.length === 1) {

            game.winner =
                alive[0].id;


            /*
               إعطاء الفائز +10
            */

            rewardWinner(
                game,
                alive[0]
            );
        }


        game.phase =
            "game_over";


        broadcast(game, {

            type: "game_over",

            winner:
                game.winner,

            reward:
                WIN_REWARD,

            players:
                getGamePlayers(game)
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
   الشات
========================= */

function sendChatMessage(ws, message) {

    const game = ws.game;


    if (!game) return;


    let text =
        String(message || "").trim();


    if (!text) return;


    /* الحد الأقصى 100 حرف */

    text =
        text.substring(0, 100);


    const player =
        getPlayer(
            game,
            ws.playerId
        );


    if (!player) return;


    const chatData = {

        type: "chat",

        message: text,

        name: player.name
    };


    /*
       الشات فقط للاعبي نفس اللعبة
    */

    broadcast(
        game,
        chatData
    );
}


/* =========================
   مغادرة الغرفة
========================= */

function leaveRoom(ws) {

    const room =
        ws.room;


    if (!room) return;


    /* إذا بدأت اللعبة فلا نعالجها كغرفة انتظار */

    if (ws.game) return;


    room.players =
        room.players.filter(
            p => p.ws !== ws
        );


    ws.room = null;


    if (room.players.length === 0) {

        rooms.delete(
            room.code
        );

        return;
    }


    sendRoomWaiting(room);
}


/* =========================
   قطع الاتصال
========================= */

function handleDisconnect(ws) {

    /* منع التنفيذ مرتين */

    if (ws.cleaned) return;

    ws.cleaned = true;


    /* إزالة من البحث */

    removeFromMatchmaking(ws);


    /* إزالة من غرفة الانتظار */

    if (
        ws.room &&
        !ws.game
    ) {

        const room =
            ws.room;


        room.players =
            room.players.filter(
                p => p.ws !== ws
            );


        ws.room = null;


        if (
            room.players.length === 0
        ) {

            rooms.delete(
                room.code
            );

        } else {

            sendRoomWaiting(room);
        }
    }


    /* اللعبة */

    const game =
        ws.game;


    if (game) {

        const disconnectedId =
            ws.playerId;


        const remaining =
            game.players.filter(
                p =>
                    p.ws !== ws &&
                    p.ws.readyState ===
                    WebSocket.OPEN
            );


        /*
           إخبار باقي اللاعبين
        */

        for (
            const player of
            game.players
        ) {

            if (
                player.ws !== ws &&
                player.ws.readyState ===
                WebSocket.OPEN
            ) {

                send(
                    player.ws,
                    {

                        type:
                            "opponent_disconnected",

                        player:
                            disconnectedId,

                        players:
                            getGamePlayers(game)
                    }
                );
            }
        }


        /*
           إذا بقي لاعب واحد
        */

        if (
            remaining.length === 1 &&
            !game.winner
        ) {

            const winner =
                remaining[0];


            game.winner =
                winner.id;


            game.phase =
                "game_over";


            game.pendingRoll = null;

            game.eligibleTargets = [];


            /*
               الفائز بسبب انسحاب الخصم
               يحصل أيضًا على +10
            */

            rewardWinner(
                game,
                winner
            );


            broadcast(game, {

                type:
                    "game_over",

                winner:
                    winner.id,

                reward:
                    WIN_REWARD,

                players:
                    getGamePlayers(game)
            });
        }


        ws.game = null;
    }


    /* تحديث عدد المتصلين */

    setTimeout(() => {

        broadcastOnlineCount();

    }, 50);
}


/* =========================
   WebSocket
========================= */

wss.on("connection", ws => {

    ws.searching = false;

    ws.cleaned = false;


    /* إرسال حالة الاتصال */

    send(ws, {

        type: "connected"
    });


    /* إرسال عدد المتصلين مباشرة */

    send(ws, {

        type: "online_count",

        count:
            getOnlineCount()
    });


    /* تحديث الجميع */

    broadcastOnlineCount();


    ws.on("message", raw => {

        let data;


        try {

            data =
                JSON.parse(
                    raw.toString()
                );

        } catch (e) {

            send(ws, {

                type:
                    "room_error",

                message:
                    "بيانات غير صحيحة"
            });

            return;
        }


        if (
            !data ||
            typeof data !== "object"
        ) {

            return;
        }


        const type =
            data.type;


        /* =========================
           البحث
        ========================= */

        if (
            type === "find_match"
        ) {

            findMatch(
                ws,
                data.name,
                data.playerCount
            );

            return;
        }


        /* =========================
           إلغاء البحث
        ========================= */

        if (
            type ===
            "cancel_search"
        ) {

            removeFromMatchmaking(ws);


            send(ws, {

                type:
                    "search_cancelled"
            });

            return;
        }


        /* =========================
           إنشاء غرفة
        ========================= */

        if (
            type ===
            "create_room"
        ) {

            createRoom(
                ws,
                data.name,
                data.playerCount
            );

            return;
        }


        /* =========================
           دخول غرفة
        ========================= */

        if (
            type ===
            "join_room"
        ) {

            joinRoom(
                ws,
                data.name,
                data.roomCode
            );

            return;
        }


        /* =========================
           مغادرة غرفة
        ========================= */

        if (
            type ===
            "leave_room"
        ) {

            leaveRoom(ws);

            return;
        }


        /* =========================
           رمي النرد
        ========================= */

        if (
            type === "roll"
        ) {

            rollDice(ws);

            return;
        }


        /* =========================
           اختيار الخصم
        ========================= */

        if (
            type === "target"
        ) {

            chooseTarget(
                ws,
                data.targetPlayer
            );

            return;
        }


        /* =========================
           الشات
        ========================= */

        if (
            type === "chat"
        ) {

            sendChatMessage(
                ws,
                data.message
            );

            return;
        }


        /* =========================
           مغادرة اللعبة
        ========================= */

        if (
            type ===
            "leave_game"
        ) {

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

server.listen(
    PORT,
    () => {

        console.log(
            `Dice Game Server running on port ${PORT}`
        );

        console.log(
            `Game cost: ${GAME_COST} points`
        );

        console.log(
            `Winner reward: ${WIN_REWARD} points`
        );
    }
);
