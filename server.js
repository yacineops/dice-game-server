const http = require("http");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain"
    });

    res.end("Dice Game Server is running!");
});

const wss = new WebSocket.Server({
    server: server
});


/* =========================
   غرف اللعب العشوائي
========================= */

const matchmakingRooms = {
    2: [],
    3: [],
    4: []
};


/* =========================
   غرف الأصدقاء
========================= */

const rooms = new Map();


/* =========================
   إرسال رسالة
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


/* =========================
   تنظيف اسم اللاعب
========================= */

function cleanName(name) {

    if (typeof name !== "string")
        return "Player 1";

    name = name.trim();

    if (name === "")
        return "Player 1";

    return name.slice(0, 20);
}


/* =========================
   التأكد من عدد اللاعبين
========================= */

function validPlayerCount(count) {

    return (
        count === 2 ||
        count === 3 ||
        count === 4
    );
}


/* =========================
   إنشاء كود غرفة
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


/* =========================
   إرسال حالة الانتظار
========================= */

function sendWaitingState(players, maxPlayers) {

    const count =
        players.length;

    players.forEach((player, index) => {

        send(player, {

            type: "waiting",

            players:
                count,

            maxPlayers:
                maxPlayers,

            position:
                index + 1
        });

    });
}


/* =========================
   بدء مباراة عشوائية
========================= */

function startRandomGame(players) {

    const game = {

        players: players,

        maxPlayers:
            players.length,

        currentPlayer: 1,

        rolling: false,

        coins: players.map(() => 8),

        playerNames:
            players.map(
                p =>
                    p.playerName ||
                    "Player"
            )
    };


    players.forEach(
        (player, index) => {

            player.game =
                game;

            player.playerNumber =
                index + 1;

        }
    );


    console.log(
        "Random game started:",
        game.playerNames.join(" vs ")
    );


    /*
     إرسال matched لكل لاعب
    */

    players.forEach(
        (player, index) => {

            send(player, {

                type: "matched",

                player:
                    index + 1,

                playerCount:
                    players.length,

                myName:
                    game.playerNames[index],

                playerNames:
                    game.playerNames

            });

        }
    );


    /*
     إرسال حالة البداية
    */

    sendGameState(game);
}


/* =========================
   إرسال حالة اللعبة
========================= */

function sendGameState(game) {

    if (!game)
        return;


    const state = {

        type: "game_state",

        playerCount:
            game.players.length,

        coins:
            game.coins,

        currentPlayer:
            game.currentPlayer,

        playerNames:
            game.playerNames
    };


    game.players.forEach(
        player => {

            send(
                player,
                state
            );

        }
    );
}


/* =========================
   إضافة لاعب للبحث
========================= */

function findRandomMatch(ws, playerCount) {

    /*
     التأكد من وجود قائمة
    */

    if (!matchmakingRooms[playerCount])
        matchmakingRooms[playerCount] = [];


    /*
     منع اللاعب من الدخول
     أكثر من مرة
    */

    Object.keys(matchmakingRooms)
        .forEach(count => {

            matchmakingRooms[count] =
                matchmakingRooms[count]
                    .filter(
                        player =>
                            player !== ws &&
                            player.readyState === WebSocket.OPEN
                    );

        });


    const queue =
        matchmakingRooms[playerCount];


    /*
     إضافة اللاعب
    */

    queue.push(ws);


    console.log(
        "Player searching:",
        ws.playerName,
        "for",
        playerCount,
        "players"
    );


    /*
     هل اكتمل العدد؟
    */

    if (
        queue.length >=
        playerCount
    ) {

        const players =
            queue.splice(
                0,
                playerCount
            );


        startRandomGame(
            players
        );

        return;
    }


    /*
     لم يكتمل العدد
    */

    sendWaitingState(
        queue,
        playerCount
    );
}


/* =========================
   تنظيف اللاعب من البحث
========================= */

function removeFromMatchmaking(ws) {

    Object.keys(
        matchmakingRooms
    ).forEach(count => {

        matchmakingRooms[count] =
            matchmakingRooms[count]
                .filter(
                    player =>
                        player !== ws
                );

    });

}


/* =========================
   اتصال لاعب
========================= */

wss.on("connection", (ws) => {

    console.log(
        "Player connected"
    );


    send(ws, {
        type: "connected"
    });


    ws.on("message", (message) => {

        let data;

        try {

            data =
                JSON.parse(message);

        } catch {

            return;
        }


        /* =================================================
           البحث عن مباراة عشوائية
        ================================================= */

        if (
            data.type ===
            "find_match"
        ) {

            ws.playerName =
                cleanName(data.name);


            const playerCount =
                Number(
                    data.playerCount
                );


            /*
             إذا لم يرسل العدد
             نستخدم 2 للحفاظ
             على التوافق القديم
            */

            const count =
                validPlayerCount(
                    playerCount
                )
                    ? playerCount
                    : 2;


            /*
             حفظ العدد
            */

            ws.playerCount =
                count;


            /*
             الدخول إلى البحث
            */

            findRandomMatch(
                ws,
                count
            );


            return;
        }


        /* =================================================
           إلغاء البحث
        ================================================= */

        if (
            data.type ===
            "cancel_search"
        ) {

            removeFromMatchmaking(
                ws
            );


            send(ws, {

                type:
                    "search_cancelled"

            });


            return;
        }


        /* =================================================
           إنشاء غرفة صديق
        ================================================= */

        if (
            data.type ===
            "create_room"
        ) {

            ws.playerName =
                cleanName(data.name);


            const requestedCount =
                Number(
                    data.playerCount
                );


            const playerCount =
                validPlayerCount(
                    requestedCount
                )
                    ? requestedCount
                    : 2;


            /*
             إنشاء كود
            */

            const roomCode =
                generateRoomCode();


            /*
             إنشاء الغرفة
            */

            const room = {

                roomCode:
                    roomCode,

                maxPlayers:
                    playerCount,

                players:
                    [ws],

                playerNames:
                    [ws.playerName],

                coins:
                    new Array(
                        playerCount
                    ).fill(8),

                currentPlayer:
                    1,

                rolling:
                    false
            };


            rooms.set(
                roomCode,
                room
            );


            ws.roomCode =
                roomCode;

            ws.playerNumber =
                1;


            console.log(
                "Room created:",
                roomCode,
                "players:",
                playerCount
            );


            /*
             إرسال الكود
            */

            send(ws, {

                type:
                    "room_created",

                roomCode:
                    roomCode,

                playerCount:
                    playerCount

            });


            /*
             إخبار اللاعب
             أنه ينتظر
            */

            send(ws, {

                type:
                    "room_waiting",

                players:
                    1,

                maxPlayers:
                    playerCount

            });


            return;
        }


        /* =================================================
           الانضمام إلى غرفة صديق
        ================================================= */

        if (
            data.type ===
            "join_room"
        ) {

            ws.playerName =
                cleanName(data.name);


            const roomCode =
                String(
                    data.roomCode || ""
                ).trim();


            /*
             التأكد من الكود
            */

            if (
                !/^\d{6}$/.test(
                    roomCode
                )
            ) {

                send(ws, {

                    type:
                        "room_error",

                    message:
                        "كود الغرفة غير صحيح"

                });

                return;
            }


            /*
             البحث عن الغرفة
            */

            const room =
                rooms.get(
                    roomCode
                );


            if (!room) {

                send(ws, {

                    type:
                        "room_error",

                    message:
                        "الغرفة غير موجودة"

                });

                return;
            }


            /*
             الغرفة ممتلئة
            */

            if (
                room.players.length >=
                room.maxPlayers
            ) {

                send(ws, {

                    type:
                        "room_error",

                    message:
                        "الغرفة ممتلئة"

                });

                return;
            }


            /*
             إضافة اللاعب
            */

            room.players.push(
                ws
            );

            room.playerNames.push(
                ws.playerName
            );


            ws.roomCode =
                roomCode;

            ws.playerNumber =
                room.players.length;


            console.log(
                "Player joined room:",
                roomCode,
                ws.playerName
            );


            /*
             إخبار جميع اللاعبين
            */

            room.players.forEach(
                (player, index) => {

                    send(player, {

                        type:
                            "room_players",

                        players:
                            room.players.length,

                        maxPlayers:
                            room.maxPlayers,

                        player:
                            index + 1,

                        playerNames:
                            room.playerNames

                    });

                }
            );


            /*
             هل اكتملت الغرفة؟
            */

            if (
                room.players.length >=
                room.maxPlayers
            ) {

                /*
                 ربط اللعبة
                */

                room.players.forEach(
                    player => {

                        player.game =
                            room;

                    }
                );


                /*
                 إرسال matched
                */

                room.players.forEach(
                    (player, index) => {

                        send(player, {

                            type:
                                "matched",

                            player:
                                index + 1,

                            playerCount:
                                room.maxPlayers,

                            myName:
                                room.playerNames[index],

                            playerNames:
                                room.playerNames

                        });

                    }
                );


                /*
                 إرسال البداية
                */

                sendGameState(
                    room
                );

            }


            return;
        }


        /* =================================================
           رمي النرد
           
           هذا الجزء أبقيناه
           متوافقاً مع النظام القديم
           للاعبين فقط.
        ================================================= */

        if (
            data.type ===
            "roll"
        ) {

            const game =
                ws.game ||
                (
                    ws.roomCode
                        ? rooms.get(
                            ws.roomCode
                        )
                        : null
                );


            if (!game)
                return;


            /*
             في هذه المرحلة
             الرمي ما زال يعمل
             بمنطق اللاعبين 1 و2
             فقط.
            */

            if (
                game.players &&
                game.players.length > 2
            ) {

                send(ws, {

                    type:
                        "online_update_required",

                    message:
                        "نظام 3 و4 لاعبين سيتم تفعيله في المرحلة التالية"

                });

                return;
            }


            /*
             التوافق مع اللعبة القديمة
            */

            const player1 =
                game.players
                    ? game.players[0]
                    : game.player1;

            const player2 =
                game.players
                    ? game.players[1]
                    : game.player2;


            if (!player1 || !player2)
                return;


            if (
                ws !== player1 &&
                ws !== player2
            )
                return;


            if (
                ws.playerNumber !==
                game.currentPlayer
            )
                return;


            if (game.rolling)
                return;


            game.rolling = true;


            const roll =
                Math.floor(
                    Math.random() * 6
                ) + 1;


            /*
             قراءة العملات
            */

            let coins1;
            let coins2;


            if (game.coins) {

                coins1 =
                    game.coins[0];

                coins2 =
                    game.coins[1];

            } else {

                coins1 =
                    game.coins1;

                coins2 =
                    game.coins2;

            }


            let winner = null;


            const opponentCoins =
                game.currentPlayer === 1
                    ? coins2
                    : coins1;


            if (
                roll ===
                opponentCoins
            ) {

                winner =
                    game.currentPlayer;

            }

            else if (
                roll <
                opponentCoins
            ) {

                if (
                    game.currentPlayer === 1
                ) {

                    coins2 -= roll;
                    coins1 += roll;

                } else {

                    coins1 -= roll;
                    coins2 += roll;

                }

            }


            /*
             حفظ العملات
            */

            if (game.coins) {

                game.coins[0] =
                    coins1;

                game.coins[1] =
                    coins2;

            } else {

                game.coins1 =
                    coins1;

                game.coins2 =
                    coins2;

            }


            const result = {

                type:
                    "dice_result",

                roll:
                    roll,

                coins1:
                    coins1,

                coins2:
                    coins2,

                currentPlayer:
                    game.currentPlayer,

                winner:
                    winner,

                player1Name:
                    game.playerNames
                        ? game.playerNames[0]
                        : game.player1Name,

                player2Name:
                    game.playerNames
                        ? game.playerNames[1]
                        : game.player2Name

            };


            send(
                player1,
                result
            );

            send(
                player2,
                result
            );


            if (!winner) {

                game.currentPlayer =
                    game.currentPlayer === 1
                        ? 2
                        : 1;


                sendGameState(
                    game
                );

            }


            game.rolling =
                false;


            return;
        }

    });


    /* =================================================
       خروج اللاعب
    ================================================= */

    ws.on("close", () => {

        console.log(
            "Player disconnected"
        );


        /*
         إزالة من البحث
        */

        removeFromMatchmaking(
            ws
        );


        /*
         إذا كان داخل غرفة
        */

        if (ws.roomCode) {

            const room =
                rooms.get(
                    ws.roomCode
                );


            if (room) {

                const remaining =
                    room.players
                        .filter(
                            player =>
                                player !== ws
                        );


                /*
                 إخبار الباقين
                */

                remaining.forEach(
                    player => {

                        send(player, {

                            type:
                                "opponent_disconnected"

                        });

                    }
                );


                rooms.delete(
                    ws.roomCode
                );

            }

        }


        /*
         إذا كان داخل مباراة عشوائية
        */

        if (ws.game) {

            const game =
                ws.game;


            game.players
                .filter(
                    player =>
                        player !== ws
                )
                .forEach(
                    player => {

                        send(player, {

                            type:
                                "opponent_disconnected"

                        });

                        player.game =
                            null;

                    }
                );


            ws.game =
                null;

        }

    });

});


/* =========================
   تشغيل السيرفر
========================= */

const PORT =
    process.env.PORT || 3000;


server.listen(
    PORT,
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);
