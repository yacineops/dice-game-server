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
   Point Settings
========================= */

const STARTING_POINTS = 100;
const GAME_COST = 5;
const WIN_REWARD = 10;

const CONNECTION_REWARD = 5;
const MAX_DAILY_CONNECTION_REWARDS = 4;


/* =========================
   Final Round Settings
========================= */

const FINAL_ROUNDS = 10;


/*
   Points are stored on the server.

   Player name is used as the identifier
   because the game has no login system.
*/

const playerPoints = new Map();


/* =========================
   Daily Connection Rewards
========================= */

const dailyConnectionRewards = new Map();


function getTodayKey() {

    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Algiers",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}


function giveConnectionRewardOnce(ws, name) {

    if (!ws || ws.connectionRewardGiven) {
        return;
    }

    ws.connectionRewardGiven = true;

    const key = getPlayerKey(name);
    const today = getTodayKey();

    let record =
        dailyConnectionRewards.get(key);


    if (
        !record ||
        record.date !== today
    ) {

        record = {
            date: today,
            count: 0
        };

        dailyConnectionRewards.set(
            key,
            record
        );
    }


    if (
        record.count >=
        MAX_DAILY_CONNECTION_REWARDS
    ) {

        return;
    }


    record.count++;

    addPoints(
        name,
        CONNECTION_REWARD
    );
}


/* =========================
   General Data
========================= */

const matchmaking = {
    2: [],
    3: [],
    4: []
};

const rooms = new Map();

let nextGameId = 1;


/* =========================
   Point Tools
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

    const index =
        allPoints.indexOf(currentPoints);

    return index >= 0 ? index + 1 : 1;
}


function sendPlayerStats(player) {

    if (!player || !player.ws) return;

    const points =
        getPoints(player.name);

    const rank =
        getRank(player.name);

    send(player.ws, {

        type: "player_stats",

        points: points,

        rank: rank
    });
}


function sendPointsUpdate(player) {

    if (!player || !player.ws) return;

    const points =
        getPoints(player.name);

    const rank =
        getRank(player.name);

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
   Helper Tools
========================= */

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );
    }
}


function broadcast(game, data) {

    if (!game || !game.players) return;

    for (const player of game.players) {

        send(
            player.ws,
            data
        );
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

    return game.players.map(
        player => ({

            id: player.id,

            name: player.name,

            coins: player.coins,

            out: player.coins <= 0
        })
    );
}


/* =========================
   Online Counter
========================= */

function getOnlineCount() {

    let count = 0;

    for (const ws of wss.clients) {

        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {

            count++;
        }
    }

    return count;
}


function broadcastOnlineCount() {

    const count =
        getOnlineCount();

    for (const ws of wss.clients) {

        send(ws, {

            type: "online_count",

            count: count
        });
    }
}


/* =========================
   Game State
========================= */

function sendGameState(
    game,
    extra = {}
) {

    if (!game) return;

    const data = {

        type: "game_state",

        gameId: game.id,

        playerCount:
            game.playerCount,

        players:
            getGamePlayers(game),

        currentPlayer:
            game.currentPlayer,

        phase:
            game.phase,

        winner:
            game.winner || null,

        finalShowdown:
            game.finalShowdown || false,

        finalRound:
            game.finalRound || 0,

        finalTotalRounds:
            game.finalTotalRounds ||
            FINAL_ROUNDS,

        finalPlayers:
            game.finalPlayers || [],

        ...extra
    };

    broadcast(
        game,
        data
    );
}


/* =========================
   Charge Game Cost
========================= */

function chargePlayers(players) {

    for (const player of players) {

        if (
            !hasEnoughPoints(
                player.name
            )
        ) {

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
   Winner Reward
========================= */

function rewardWinner(
    game,
    winnerPlayer
) {

    if (!game || !winnerPlayer)
        return;

    if (game.rewardGiven)
        return;

    game.rewardGiven = true;

    winnerPlayer.rewardGiven = true;


    const newPoints =
        addPoints(
            winnerPlayer.name,
            WIN_REWARD
        );


    send(
        winnerPlayer.ws,
        {

            type: "points_update",

            points: newPoints,

            reward: WIN_REWARD
        }
    );


    send(
        winnerPlayer.ws,
        {

            type: "rank_update",

            rank:
                getRank(
                    winnerPlayer.name
                )
        }
    );


    send(
        winnerPlayer.ws,
        {

            type: "player_stats",

            points: newPoints,

            rank:
                getRank(
                    winnerPlayer.name
                )
        }
    );
}


/* =========================
   Final Round Data
========================= */

function getFinalPlayers(game) {

    if (
        !game ||
        !game.finalPlayers
    ) {

        return [];
    }

    return game.finalPlayers
        .map(id => {

            const player =
                getPlayer(
                    game,
                    id
                );

            if (!player)
                return null;

            return {

                id: player.id,

                name: player.name,

                coins: player.coins,

                out:
                    player.coins <= 0
            };

        })
        .filter(Boolean);
}


function getFinalOpponent(
    game,
    playerId
) {

    if (
        !game ||
        !game.finalPlayers
    ) {

        return null;
    }

    const opponentId =
        game.finalPlayers.find(
            id => id !== playerId
        );

    if (!opponentId)
        return null;

    return getPlayer(
        game,
        opponentId
    );
}


/* =========================
   Start Final Showdown
========================= */

function startFinalShowdown(game) {

    if (!game) return;

    if (game.playerCount < 3)
        return;

    if (game.finalShowdown)
        return;


    const alive =
        getAlivePlayers(game);


    if (alive.length !== 2)
        return;


    game.finalShowdown = true;

    game.finalRound = 1;

    game.finalTotalRounds =
        FINAL_ROUNDS;

    game.finalPlayers =
        alive.map(
            player => player.id
        );


    game.pendingRoll = null;

    game.eligibleTargets = [];

    game.phase = "roll";


    if (
        !game.finalPlayers.includes(
            game.currentPlayer
        )
    ) {

        game.currentPlayer =
            game.finalPlayers[0];
    }


    sendGameState(
        game,
        {

            finalShowdown: true,

            finalRound:
                game.finalRound,

            finalTotalRounds:
                game.finalTotalRounds,

            finalPlayers:
                getFinalPlayers(game)
        }
    );
}


/* =========================
   Advance Final Round
========================= */

function advanceFinalRound(game) {

    if (
        !game ||
        !game.finalShowdown
    ) {

        return;
    }


    game.finalRound++;


    if (
        game.finalRound >
        game.finalTotalRounds
    ) {

        finishFinalShowdown(game);

        return;
    }


    game.pendingRoll = null;

    game.eligibleTargets = [];

    game.phase = "roll";


    const nextPlayer =
        getFinalOpponent(
            game,
            game.currentPlayer
        );


    if (nextPlayer) {

        game.currentPlayer =
            nextPlayer.id;
    }


    sendGameState(
        game,
        {

            finalShowdown: true,

            finalRound:
                game.finalRound,

            finalTotalRounds:
                game.finalTotalRounds,

            finalPlayers:
                getFinalPlayers(game)
        }
    );
}


/* =========================
   Finish Final Showdown
========================= */

function finishFinalShowdown(game) {

    if (
        !game ||
        !game.finalShowdown
    ) {

        return;
    }


    const players =
        game.finalPlayers
            .map(
                id =>
                    getPlayer(game, id)
            )
            .filter(Boolean);


    if (players.length !== 2)
        return;


    const player1 = players[0];

    const player2 = players[1];


    if (
        player1.coins <= 0 &&
        player2.coins > 0
    ) {

        completeFinalWinner(
            game,
            player2
        );

        return;
    }


    if (
        player2.coins <= 0 &&
        player1.coins > 0
    ) {

        completeFinalWinner(
            game,
            player1
        );

        return;
    }


    if (
        player1.coins >
        player2.coins
    ) {

        completeFinalWinner(
            game,
            player1
        );

        return;
    }


    if (
        player2.coins >
        player1.coins
    ) {

        completeFinalWinner(
            game,
            player2
        );

        return;
    }


    game.finalTotalRounds++;

    game.phase = "roll";

    game.pendingRoll = null;

    game.eligibleTargets = [];


    const nextPlayer =
        getFinalOpponent(
            game,
            game.currentPlayer
        );


    if (nextPlayer) {

        game.currentPlayer =
            nextPlayer.id;
    }


    sendGameState(
        game,
        {

            finalShowdown: true,

            finalRound:
                game.finalRound,

            finalTotalRounds:
                game.finalTotalRounds,

            finalTie: true,

            finalPlayers:
                getFinalPlayers(game)
        }
    );
}


/* =========================
   Complete Final Winner
========================= */

function completeFinalWinner(
    game,
    winner
) {

    if (!game || !winner)
        return;


    game.winner =
        winner.id;

    game.phase =
        "game_over";

    game.pendingRoll = null;

    game.eligibleTargets = [];


    rewardWinner(
        game,
        winner
    );


    sendGameState(
        game,
        {

            finalShowdown: true,

            finalRound:
                game.finalRound,

            finalTotalRounds:
                game.finalTotalRounds,

            finalPlayers:
                getFinalPlayers(game),

            winner:
                winner.id
        }
    );


    broadcast(
        game,
        {

            type: "game_over",

            winner:
                winner.id,

            reward:
                WIN_REWARD,

            finalShowdown: true,

            finalRound:
                game.finalRound,

            finalTotalRounds:
                game.finalTotalRounds,

            players:
                getGamePlayers(game)
        }
    );
}


/* =========================
   Start Game
========================= */

function startGame(
    players,
    playerCount
) {

    if (!chargePlayers(players)) {

        for (
            const player of players
        ) {

            send(
                player.ws,
                {

                    type: "room_error",

                    message:
                        "لا يمكن بدء اللعبة. يجب أن يملك كل لاعب 5 نقاط على الأقل."
                }
            );
        }

        return null;
    }


    const game = {

        id: nextGameId++,

        playerCount:
            playerCount,

        players:
            players,

        currentPlayer: 1,

        phase: "roll",

        pendingRoll: null,

        eligibleTargets: [],

        winner: null,

        rewardGiven: false,

        finalShowdown: false,

        finalRound: 0,

        finalTotalRounds:
            FINAL_ROUNDS,

        finalPlayers: []
    };


    players.forEach(
        (player, index) => {

            player.id =
                index + 1;

            player.coins = 10;

            player.out = false;

            player.game = game;

            player.ws.game = game;

            player.ws.playerId =
                player.id;
        }
    );


    sendGameState(game);

    return game;
}


/* =========================
   Matchmaking
========================= */

function removeFromMatchmaking(ws) {

    for (
        const count of [2, 3, 4]
    ) {

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

        playerCount:
            list.length,

        maxPlayers:
            count
    };


    for (
        const item of list
    ) {

        send(
            item.ws,
            message
        );
    }
}


function findMatch(
    ws,
    name,
    playerCount
) {

    playerCount =
        Number(playerCount);


    if (
        ![2, 3, 4].includes(
            playerCount
        )
    ) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "عدد اللاعبين غير صحيح"
            }
        );

        return;
    }


    const cleanName =
        String(name || "Player")
            .trim()
            .slice(0, 20) || "Player";


    /* Daily connection reward */

    giveConnectionRewardOnce(
        ws,
        cleanName
    );


    if (
        !hasEnoughPoints(
            cleanName
        )
    ) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "رصيدك غير كافٍ. تحتاج إلى 5 نقاط للعب أونلاين."
            }
        );

        send(
            ws,
            {

                type:
                    "insufficient_points",

                points:
                    getPoints(cleanName),

                required:
                    GAME_COST
            }
        );

        return;
    }


    removeFromMatchmaking(ws);


    const player =
        createPlayer(
            ws,
            cleanName
        );


    player.searching = true;


    matchmaking[playerCount].push(
        player
    );

    ws.searching = true;


    sendPlayerStats(player);

    sendWaiting(playerCount);


    matchmaking[playerCount] =
        matchmaking[playerCount].filter(
            p => {

                if (
                    !hasEnoughPoints(
                        p.name
                    )
                ) {

                    p.searching = false;

                    p.ws.searching =
                        false;

                    send(
                        p.ws,
                        {

                            type:
                                "room_error",

                            message:
                                "رصيدك أصبح أقل من 5 نقاط."
                        }
                    );

                    return false;
                }

                return true;
            }
        );


    sendWaiting(playerCount);


    if (
        matchmaking[playerCount]
            .length >= playerCount
    ) {

        const selected =
            matchmaking[playerCount]
                .splice(
                    0,
                    playerCount
                );


        selected.forEach(p => {

            p.searching = false;

            p.ws.searching = false;
        });


        const game =
            startGame(
                selected,
                playerCount
            );


        if (!game)
            return;


        for (
            const p of selected
        ) {

            send(
                p.ws,
                {

                    type: "matched",

                    gameId:
                        game.id,

                    player:
                        p.id,

                    playerCount:
                        playerCount,

                    players:
                        getGamePlayers(game)
                }
            );
        }


        sendGameState(game);
    }
}


/* =========================
   Private Rooms
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


function createRoom(
    ws,
    name,
    playerCount
) {

    playerCount =
        Number(playerCount);


    if (
        ![2, 3, 4].includes(
            playerCount
        )
    ) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "عدد اللاعبين يجب أن يكون 2 أو 3 أو 4"
            }
        );

        return;
    }


    const cleanName =
        String(name || "Player")
            .trim()
            .slice(0, 20) || "Player";


    /* Daily connection reward */

    giveConnectionRewardOnce(
        ws,
        cleanName
    );


    if (
        !hasEnoughPoints(
            cleanName
        )
    ) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "رصيدك غير كافٍ. تحتاج إلى 5 نقاط لإنشاء غرفة."
            }
        );

        send(
            ws,
            {

                type:
                    "insufficient_points",

                points:
                    getPoints(cleanName),

                required:
                    GAME_COST
            }
        );

        return;
    }


    removeFromMatchmaking(ws);


    const code =
        generateRoomCode();


    const player =
        createPlayer(
            ws,
            cleanName
        );


    const room = {

        code: code,

        playerCount:
            playerCount,

        players:
            [player],

        game: null
    };


    player.room = room;

    ws.room = room;


    rooms.set(
        code,
        room
    );


    sendPlayerStats(player);


    send(
        ws,
        {

            type: "room_created",

            roomCode: code,

            playerCount:
                playerCount,

            cost:
                GAME_COST,

            players:
                room.players.map(
                    (p, index) => ({

                        id:
                            index + 1,

                        name:
                            p.name
                    })
                )
        }
    );


    sendRoomWaiting(room);
}


function sendRoomWaiting(room) {

    if (!room) return;


    const players =
        room.players.map(
            (p, index) => ({

                id:
                    index + 1,

                name:
                    p.name
            })
        );


    for (
        const player of
        room.players
    ) {

        send(
            player.ws,
            {

                type:
                    "room_players",

                roomCode:
                    room.code,

                playerCount:
                    room.players.length,

                players:
                    players,

                maxPlayers:
                    room.playerCount
            }
        );
    }
}


function joinRoom(
    ws,
    name,
    roomCode
) {

    roomCode =
        String(
            roomCode || ""
        ).trim();


    if (!rooms.has(roomCode)) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "الغرفة غير موجودة"
            }
        );

        return;
    }


    const room =
        rooms.get(roomCode);


    if (room.game) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "اللعبة بدأت بالفعل"
            }
        );

        return;
    }


    if (
        room.players.length >=
        room.playerCount
    ) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "الغرفة ممتلئة"
            }
        );

        return;
    }


    const cleanName =
        String(name || "Player")
            .trim()
            .slice(0, 20) || "Player";


    /* Daily connection reward */

    giveConnectionRewardOnce(
        ws,
        cleanName
    );


    if (
        !hasEnoughPoints(
            cleanName
        )
    ) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "رصيدك غير كافٍ. تحتاج إلى 5 نقاط لدخول الغرفة."
            }
        );

        send(
            ws,
            {

                type:
                    "insufficient_points",

                points:
                    getPoints(cleanName),

                required:
                    GAME_COST
            }
        );

        return;
    }


    removeFromMatchmaking(ws);


    const player =
        createPlayer(
            ws,
            cleanName
        );


    player.room = room;

    room.players.push(player);

    ws.room = room;


    sendPlayerStats(player);

    sendRoomWaiting(room);


    if (
        room.players.length ===
        room.playerCount
    ) {

        const canStart =
            room.players.every(
                p =>
                    hasEnoughPoints(
                        p.name
                    )
            );


        if (!canStart) {

            for (
                const p of room.players
            ) {

                send(
                    p.ws,
                    {

                        type:
                            "room_error",

                        message:
                            "لا يمكن بدء اللعبة لأن أحد اللاعبين لا يملك 5 نقاط."
                    }
                );
            }

            return;
        }


        rooms.delete(
            room.code
        );


        const game =
            startGame(
                room.players,
                room.playerCount
            );


        if (!game)
            return;


        room.game = game;


        for (
            const p of room.players
        ) {

            send(
                p.ws,
                {

                    type: "matched",

                    gameId:
                        game.id,

                    player:
                        p.id,

                    playerCount:
                        game.playerCount,

                    players:
                        getGamePlayers(game)
                }
            );
        }


        sendGameState(game);
    }
}


/* =========================
   Dice Roll
========================= */

function rollDice(ws) {

    const game =
        ws.game;


    if (!game) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "لا توجد لعبة"
            }
        );

        return;
    }


    const playerId =
        ws.playerId;


    if (game.winner)
        return;


    if (
        game.currentPlayer !==
        playerId
    ) {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "ليس دورك"
            }
        );

        return;
    }


    if (game.phase !== "roll") {

        send(
            ws,
            {

                type: "room_error",

                message:
                    "لا يمكنك الرمي الآن"
            }
        );

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


    const roll =
        Math.floor(
            Math.random() * 6
        ) + 1;


    game.pendingRoll =
        roll;


    const eligibleTargets =
        game.players
            .filter(
                p =>
                    p.id !== playerId &&
                    p.coins >= roll &&
                    (
                        !game.finalShowdown ||
                        game.finalPlayers.includes(
                            p.id
                        )
                    )
            )
            .map(
                p => p.id
            );


    game.eligibleTargets =
        eligibleTargets;


    if (
        eligibleTargets.length === 0
    ) {

        game.phase =
            "no_target";


        sendGameState(
            game,
            {

                roll: roll,

                roller:
                    playerId,

                phase:
                    "no_target",

                finalShowdown:
                    game.finalShowdown ||
                    false,

                finalRound:
                    game.finalRound ||
                    0,

                finalTotalRounds:
                    game.finalTotalRounds ||
                    FINAL_ROUNDS
            }
        );


        setTimeout(
            () => {

                if (
                    game.winner ||
                    game.currentPlayer !==
                        playerId ||
                    game.phase !==
                        "no_target"
                ) {

                    return;
                }


                if (
                    game.finalShowdown
                ) {

                    advanceFinalRound(
                        game
                    );

                } else {

                    nextTurn(game);
                }

            },
            700
        );


        return;
    }


    game.phase =
        "target";


    const publicDiceResult = {

        type:
            "dice_result",

        roll:
            roll,

        roller:
            playerId,

        currentPlayer:
            playerId,

        phase:
            "target",

        players:
            getGamePlayers(game),

        finalShowdown:
            game.finalShowdown ||
            false,

        finalRound:
            game.finalRound ||
            0,

        finalTotalRounds:
            game.finalTotalRounds ||
            FINAL_ROUNDS
    };


    for (
        const p of game.players
    ) {

        if (
            p.id === playerId
        ) {

            send(
                p.ws,
                {

                    ...publicDiceResult,

                    eligibleTargets:
                        eligibleTargets
                }
            );

        } else {

            send(
                p.ws,
                publicDiceResult
            );
        }
    }
}


/* =========================
   Choose Target
========================= */

function chooseTarget(
    ws,
    targetId
) {

    const game =
        ws.game;


    if (!game)
        return;


    targetId =
        Number(targetId);


    const playerId =
        ws.playerId;


    if (game.winner)
        return;


    if (
        game.currentPlayer !==
        playerId
    ) {

        send(
            ws,
            {

                type:
                    "room_error",

                message:
                    "ليس دورك"
            }
        );

        return;
    }


    if (game.phase !== "target") {

        send(
            ws,
            {

                type:
                    "room_error",

                message:
                    "لا يوجد اختيار هدف الآن"
            }
        );

        return;
    }


    if (
        !game.eligibleTargets
            .includes(targetId)
    ) {

        send(
            ws,
            {

                type:
                    "room_error",

                message:
                    "هذا اللاعب غير صالح كهدف"
            }
        );

        return;
    }


    if (
        game.finalShowdown &&
        !game.finalPlayers
            .includes(targetId)
    ) {

        send(
            ws,
            {

                type:
                    "room_error",

                message:
                    "هذا اللاعب غير موجود في الجولة النهائية"
            }
        );

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


    if (!roller || !target)
        return;


    const roll =
        Number(
            game.pendingRoll
        );


    if (
        !roll ||
        roll < 1 ||
        roll > 6
    ) {

        game.phase =
            "roll";

        game.pendingRoll =
            null;

        game.eligibleTargets =
            [];

        return;
    }


    if (
        target.coins < roll
    ) {

        send(
            ws,
            {

                type:
                    "room_error",

                message:
                    "الخصم لا يملك عملات كافية"
            }
        );

        return;
    }


    const oldCoins = {

        roller:
            roller.coins,

        target:
            target.coins
    };


    target.coins -= roll;

    roller.coins += roll;


    /* =========================
       Normal Game
    ========================= */

    if (!game.finalShowdown) {

        if (
            target.coins <= 0
        ) {

            target.coins = 0;

            target.out = true;
        }


        roller.out =
            roller.coins <= 0;


        const alive =
            getAlivePlayers(game);


        if (
            alive.length === 1
        ) {

            game.winner =
                alive[0].id;

            game.phase =
                "game_over";

            game.pendingRoll =
                null;

            game.eligibleTargets =
                [];


            rewardWinner(
                game,
                alive[0]
            );


            sendGameState(
                game,
                {

                    roll:
                        roll,

                    target:
                        targetId,

                    roller:
                        playerId,

                    oldCoins:
                        oldCoins,

                    winner:
                        game.winner
                }
            );


            broadcast(
                game,
                {

                    type:
                        "game_over",

                    winner:
                        game.winner,

                    reward:
                        WIN_REWARD,

                    players:
                        getGamePlayers(game)
                }
            );


            return;
        }


        if (
            game.playerCount >= 3 &&
            alive.length === 2
        ) {

            game.pendingRoll =
                null;

            game.eligibleTargets =
                [];

            game.phase =
                "roll";


            const next =
                findNextAlivePlayer(
                    game,
                    playerId
                );


            game.currentPlayer =
                next;


            sendGameState(
                game,
                {

                    roll:
                        roll,

                    target:
                        targetId,

                    roller:
                        playerId,

                    oldCoins:
                        oldCoins
                }
            );


            setTimeout(
                () => {

                    if (
                        game.winner ||
                        game.finalShowdown
                    ) {

                        return;
                    }


                    startFinalShowdown(
                        game
                    );

                },
                300
            );


            return;
        }


        game.pendingRoll =
            null;

        game.eligibleTargets =
            [];

        game.phase =
            "roll";


        const next =
            findNextAlivePlayer(
                game,
                playerId
            );


        game.currentPlayer =
            next;


        sendGameState(
            game,
            {

                roll:
                    roll,

                target:
                    targetId,

                roller:
                    playerId,

                oldCoins:
                    oldCoins
            }
        );


        return;
    }


    /* =========================
       Final Showdown
    ========================= */

    if (
        target.coins <= 0
    ) {

        target.coins = 0;

        target.out = true;

        game.pendingRoll =
            null;

        game.eligibleTargets =
            [];

        game.phase =
            "game_over";


        completeFinalWinner(
            game,
            roller
        );

        return;
    }


    game.pendingRoll =
        null;

    game.eligibleTargets =
        [];

    game.phase =
        "roll";


    sendGameState(
        game,
        {

            roll:
                roll,

            target:
                targetId,

            roller:
                playerId,

            oldCoins:
                oldCoins,

            finalShowdown:
                true,

            finalRound:
                game.finalRound,

            finalTotalRounds:
                game.finalTotalRounds,

            finalPlayers:
                getFinalPlayers(game)
        }
    );


    setTimeout(
        () => {

            if (
                game.winner ||
                !game.finalShowdown
            ) {

                return;
            }


            advanceFinalRound(
                game
            );

        },
        300
    );
}


/* =========================
   Next Turn
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
            getPlayer(
                game,
                id
            );


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

    if (
        !game ||
        game.winner
    ) {

        return;
    }


    if (game.finalShowdown) {

        advanceFinalRound(
            game
        );

        return;
    }


    const alive =
        getAlivePlayers(game);


    if (alive.length <= 1) {

        if (
            alive.length === 1
        ) {

            game.winner =
                alive[0].id;


            rewardWinner(
                game,
                alive[0]
            );
        }


        game.phase =
            "game_over";


        broadcast(
            game,
            {

                type:
                    "game_over",

                winner:
                    game.winner,

                reward:
                    WIN_REWARD,

                players:
                    getGamePlayers(game)
            }
        );


        return;
    }


    if (
        game.playerCount >= 3 &&
        alive.length === 2
    ) {

        startFinalShowdown(
            game
        );

        return;
    }


    game.currentPlayer =
        findNextAlivePlayer(
            game,
            game.currentPlayer
        );


    game.pendingRoll =
        null;

    game.eligibleTargets =
        [];

    game.phase =
        "roll";


    sendGameState(game);
}


/* =========================
   Chat
========================= */

function sendChatMessage(
    ws,
    message
) {

    const game =
        ws.game;


    if (!game)
        return;


    let text =
        String(
            message || ""
        ).trim();


    if (!text)
        return;


    text =
        text.substring(
            0,
            100
        );


    const player =
        getPlayer(
            game,
            ws.playerId
        );


    if (!player)
        return;


    const chatData = {

        type:
            "chat",

        message:
            text,

        name:
            player.name
    };


    broadcast(
        game,
        chatData
    );
}


/* =========================
   Leave Room
========================= */

function leaveRoom(ws) {

    const room =
        ws.room;


    if (!room)
        return;


    if (ws.game)
        return;


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

        return;
    }


    sendRoomWaiting(room);
}


/* =========================
   Disconnect
========================= */

function handleDisconnect(ws) {

    if (ws.cleaned)
        return;

    ws.cleaned = true;


    removeFromMatchmaking(ws);


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

            sendRoomWaiting(
                room
            );
        }
    }


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


            game.pendingRoll =
                null;

            game.eligibleTargets =
                [];


            rewardWinner(
                game,
                winner
            );


            broadcast(
                game,
                {

                    type:
                        "game_over",

                    winner:
                        winner.id,

                    reward:
                        WIN_REWARD,

                    players:
                        getGamePlayers(game)
                }
            );
        }


        ws.game = null;
    }


    setTimeout(
        () => {

            broadcastOnlineCount();

        },
        50
    );
}


/* =========================
   WebSocket
========================= */

wss.on(
    "connection",
    ws => {

        ws.searching = false;

        ws.cleaned = false;

        /*
           Prevent more than one reward
           for the same WebSocket connection.
        */

        ws.connectionRewardGiven = false;


        send(
            ws,
            {

                type:
                    "connected"
            }
        );


        send(
            ws,
            {

                type:
                    "online_count",

                count:
                    getOnlineCount()
            }
        );


        broadcastOnlineCount();


        ws.on(
            "message",
            raw => {

                let data;


                try {

                    data =
                        JSON.parse(
                            raw.toString()
                        );

                } catch (e) {

                    send(
                        ws,
                        {

                            type:
                                "room_error",

                            message:
                                "بيانات غير صحيحة"
                        }
                    );

                    return;
                }


                if (
                    !data ||
                    typeof data !==
                        "object"
                ) {

                    return;
                }


                const type =
                    data.type;


                if (
                    type ===
                    "find_match"
                ) {

                    findMatch(
                        ws,
                        data.name,
                        data.playerCount
                    );

                    return;
                }


                if (
                    type ===
                    "cancel_search"
                ) {

                    removeFromMatchmaking(
                        ws
                    );


                    send(
                        ws,
                        {

                            type:
                                "search_cancelled"
                        }
                    );

                    return;
                }


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


                if (
                    type ===
                    "leave_room"
                ) {

                    leaveRoom(ws);

                    return;
                }


                if (
                    type ===
                    "roll"
                ) {

                    rollDice(ws);

                    return;
                }


                if (
                    type ===
                    "target"
                ) {

                    chooseTarget(
                        ws,
                        data.targetPlayer
                    );

                    return;
                }


                if (
                    type ===
                    "chat"
                ) {

                    sendChatMessage(
                        ws,
                        data.message
                    );

                    return;
                }


                if (
                    type ===
                    "leave_game"
                ) {

                    try {

                        ws.close();

                    } catch (e) {}

                    return;
                }
            }
        );


        ws.on(
            "close",
            () => {

                handleDisconnect(ws);
            }
        );


        ws.on(
            "error",
            () => {

                handleDisconnect(ws);
            }
        );
    }
);


/* =========================
   Start Server
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

        console.log(
            `Connection reward: ${CONNECTION_REWARD} points`
        );

        console.log(
            `Max daily connection rewards: ${MAX_DAILY_CONNECTION_REWARDS}`
        );

        console.log(
            `Final showdown rounds: ${FINAL_ROUNDS}`
        );
    }
);
