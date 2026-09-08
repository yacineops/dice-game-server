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
   نظام اللعب العشوائي
========================= */

let waitingPlayer = null;


/* =========================
   نظام الغرف
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
   إرسال حالة غرفة
========================= */

function sendRoomGameState(room) {

    if (!room)
        return;

    const state = {

        type: "game_state",

        coins1:
            room.coins1,

        coins2:
            room.coins2,

        currentPlayer:
            room.currentPlayer,

        player1Name:
            room.player1Name,

        player2Name:
            room.player2Name
    };


    send(
        room.player1,
        state
    );

    send(
        room.player2,
        state
    );
}


/* =========================
   إنشاء مباراة
========================= */

function startGame(
    player1,
    player2
) {

    const game = {

        player1:
            player1,

        player2:
            player2,

        player1Name:
            player1.playerName ||
            "Player 1",

        player2Name:
            player2.playerName ||
            "Player 1",

        coins1: 8,

        coins2: 8,

        currentPlayer: 1,

        rolling: false
    };


    player1.playerNumber = 1;
    player2.playerNumber = 2;


    return game;
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

        if (data.type === "find_match") {

            ws.playerName =
                cleanName(data.name);


            /*
             إذا لا يوجد لاعب ينتظر
            */

            if (
                waitingPlayer === null ||
                waitingPlayer.readyState !== WebSocket.OPEN
            ) {

                waitingPlayer = ws;

                send(ws, {
                    type: "waiting"
                });

                console.log(
                    "Player waiting:",
                    ws.playerName
                );

                return;
            }


            /*
             يوجد لاعب ينتظر
            */

            const player1 =
                waitingPlayer;

            const player2 =
                ws;


            waitingPlayer = null;


            const game =
                startGame(
                    player1,
                    player2
                );


            /*
             حفظ اللعبة في اللاعبين
            */

            player1.game = game;
            player2.game = game;


            console.log(
                "Random match:",
                game.player1Name,
                "vs",
                game.player2Name
            );


            /*
             إخبار اللاعب الأول
            */

            send(player1, {

                type: "matched",

                player: 1,

                myName:
                    game.player1Name,

                opponentName:
                    game.player2Name
            });


            /*
             إخبار اللاعب الثاني
            */

            send(player2, {

                type: "matched",

                player: 2,

                myName:
                    game.player2Name,

                opponentName:
                    game.player1Name
            });


            /*
             إرسال حالة البداية
            */

            sendRoomGameState(game);


            return;
        }


        /* =================================================
           إنشاء غرفة
        ================================================= */

        if (data.type === "create_room") {

            ws.playerName =
                cleanName(data.name);


            /*
             إنشاء كود جديد
            */

            const roomCode =
                generateRoomCode();


            /*
             إنشاء الغرفة
            */

            const room = {

                roomCode:
                    roomCode,

                player1:
                    ws,

                player2:
                    null,

                player1Name:
                    ws.playerName,

                player2Name:
                    null,

                coins1: 8,

                coins2: 8,

                currentPlayer: 1,

                rolling: false
            };


            /*
             حفظ الغرفة
            */

            rooms.set(
                roomCode,
                room
            );


            /*
             ربط اللاعب بالغرفة
            */

            ws.roomCode =
                roomCode;

            ws.playerNumber = 1;


            console.log(
                "Room created:",
                roomCode,
                "by",
                ws.playerName
            );


            /*
             إرسال كود الغرفة
            */

            send(ws, {

                type:
                    "room_created",

                roomCode:
                    roomCode
            });


            /*
             إخبار اللاعب أنه ينتظر
            */

            send(ws, {

                type:
                    "room_waiting"
            });


            return;
        }


        /* =================================================
           الانضمام إلى غرفة
        ================================================= */

        if (data.type === "join_room") {

            ws.playerName =
                cleanName(data.name);


            const roomCode =
                String(
                    data.roomCode || ""
                ).trim();


            /*
             التأكد من الكود
            */

            if (!/^\d{6}$/.test(roomCode)) {

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
                rooms.get(roomCode);


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

            if (room.player2 !== null) {

                send(ws, {

                    type:
                        "room_error",

                    message:
                        "الغرفة ممتلئة"
                });

                return;
            }


            /*
             إضافة اللاعب الثاني
            */

            room.player2 =
                ws;

            room.player2Name =
                ws.playerName;


            ws.roomCode =
                roomCode;

            ws.playerNumber = 2;


            console.log(
                "Player joined room:",
                roomCode,
                ws.playerName
            );


            /*
             إخبار اللاعب الأول
            */

            send(room.player1, {

                type:
                    "matched",

                player: 1,

                myName:
                    room.player1Name,

                opponentName:
                    room.player2Name
            });


            /*
             إخبار اللاعب الثاني
            */

            send(room.player2, {

                type:
                    "matched",

                player: 2,

                myName:
                    room.player2Name,

                opponentName:
                    room.player1Name
            });


            /*
             إرسال حالة البداية
            */

            sendRoomGameState(room);


            return;
        }


        /* =================================================
           رمي النرد
        ================================================= */

        if (data.type === "roll") {

            /*
             اللعبة العشوائية
             أو غرفة خاصة
            */

            const game =
                ws.game ||
                (
                    ws.roomCode
                    ? rooms.get(ws.roomCode)
                    : null
                );


            if (!game)
                return;


            /*
             التأكد من اللاعب
            */

            if (
                ws !== game.player1 &&
                ws !== game.player2
            ) {

                return;
            }


            /*
             التأكد من وجود اللاعب الثاني
            */

            if (!game.player2)
                return;


            /*
             التأكد من الدور
            */

            if (
                ws.playerNumber !==
                game.currentPlayer
            ) {

                return;
            }


            /*
             منع الرمي المكرر
            */

            if (game.rolling)
                return;


            game.rolling = true;


            /*
             إنشاء نتيجة النرد
            */

            const roll =
                Math.floor(
                    Math.random() * 6
                ) + 1;


            let opponentCoins;


            if (
                game.currentPlayer === 1
            ) {

                opponentCoins =
                    game.coins2;

            } else {

                opponentCoins =
                    game.coins1;
            }


            let winner = null;


            /*
             النرد مساوي للعملات
             = فوز
            */

            if (
                roll === opponentCoins
            ) {

                winner =
                    game.currentPlayer;
            }


            /*
             النرد أقل من العملات
             = نقل العملات
            */

            else if (
                roll < opponentCoins
            ) {

                if (
                    game.currentPlayer === 1
                ) {

                    game.coins2 -= roll;

                    game.coins1 += roll;

                } else {

                    game.coins1 -= roll;

                    game.coins2 += roll;
                }
            }


            /*
             حفظ اللاعب الذي رمى
            */

            const roller =
                game.currentPlayer;


            /*
             النتيجة
            */

            const result = {

                type:
                    "dice_result",

                roll:
                    roll,

                coins1:
                    game.coins1,

                coins2:
                    game.coins2,

                currentPlayer:
                    roller,

                winner:
                    winner,

                player1Name:
                    game.player1Name,

                player2Name:
                    game.player2Name
            };


            /*
             إرسال النتيجة
            */

            send(
                game.player1,
                result
            );

            send(
                game.player2,
                result
            );


            /*
             إذا لا يوجد فائز
             نغير الدور
            */

            if (!winner) {

                game.currentPlayer =
                    game.currentPlayer === 1
                    ? 2
                    : 1;


                sendRoomGameState(
                    game
                );
            }


            game.rolling = false;


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
         إذا كان ينتظر
         مباراة عشوائية
        */

        if (
            waitingPlayer === ws
        ) {

            waitingPlayer = null;
        }


        /*
         إذا كان داخل غرفة
        */

        if (ws.roomCode) {

            const room =
                rooms.get(
                    ws.roomCode
                );


            if (room) {

                const otherPlayer =
                    ws === room.player1
                    ? room.player2
                    : room.player1;


                /*
                 إخبار اللاعب الآخر
                */

                send(
                    otherPlayer,
                    {
                        type:
                            "opponent_disconnected"
                    }
                );


                /*
                 حذف الغرفة
                */

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


            const otherPlayer =
                ws === game.player1
                ? game.player2
                : game.player1;


            send(
                otherPlayer,
                {
                    type:
                        "opponent_disconnected"
                }
            );


            /*
             إزالة اللعبة
            */

            if (
                game.player1
            ) {
                game.player1.game =
                    null;
            }


            if (
                game.player2
            ) {
                game.player2.game =
                    null;
            }
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
