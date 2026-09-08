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

let waitingPlayer = null;
let game = null;


/* إرسال رسالة للاعب */
function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}


/* إرسال حالة اللعبة للاعبين */
function sendGameState() {

    if (!game)
        return;

    const state = {
        type: "game_state",
        coins1: game.coins1,
        coins2: game.coins2,
        currentPlayer: game.currentPlayer
    };

    send(game.player1, state);
    send(game.player2, state);
}


/* اتصال لاعب */
wss.on("connection", (ws) => {

    console.log("Player connected");

    send(ws, {
        type: "connected"
    });


    ws.on("message", (message) => {

        let data;

        try {
            data = JSON.parse(message);
        } catch {
            return;
        }


        /* البحث عن مباراة */
        if (data.type === "find_match") {

            /* إذا كان اللاعب ينتظر بالفعل */
            if (
                waitingPlayer &&
                waitingPlayer.readyState === WebSocket.OPEN
            ) {
                return;
            }


            /* لا يوجد لاعب ينتظر */
            if (waitingPlayer === null) {

                waitingPlayer = ws;

                send(ws, {
                    type: "waiting"
                });

                console.log("Player waiting");

                return;
            }


            /* وجدنا لاعبًا ثانيًا */
            const player1 = waitingPlayer;
            const player2 = ws;

            waitingPlayer = null;


            /* إنشاء اللعبة */
            game = {

                player1: player1,

                player2: player2,

                coins1: 8,

                coins2: 8,

                currentPlayer: 1,

                rolling: false
            };


            player1.playerNumber = 1;
            player2.playerNumber = 2;


            console.log("Match found");


            send(player1, {
                type: "matched",
                player: 1
            });


            send(player2, {
                type: "matched",
                player: 2
            });


            /* إرسال حالة البداية */
            sendGameState();

            return;
        }


        /* رمي النرد */
        if (data.type === "roll") {

            if (!game)
                return;


            /* التأكد أن اللاعب داخل اللعبة */
            if (
                ws !== game.player1 &&
                ws !== game.player2
            ) {
                return;
            }


            /* التأكد من الدور */
            if (
                ws.playerNumber !==
                game.currentPlayer
            ) {
                return;
            }


            /* منع الرمي أثناء الرمية */
            if (game.rolling)
                return;


            game.rolling = true;


            /* السيرفر يولد النتيجة */
            const roll =
                Math.floor(
                    Math.random() * 6
                ) + 1;


            let opponentCoins;


            if (game.currentPlayer === 1) {

                opponentCoins =
                    game.coins2;

            } else {

                opponentCoins =
                    game.coins1;
            }


            let winner = null;


            /* مساوي = فوز */
            if (roll === opponentCoins) {

                winner =
                    game.currentPlayer;

            }


            /* أقل = نقل العملات */
            else if (roll < opponentCoins) {

                if (game.currentPlayer === 1) {

                    game.coins2 -= roll;
                    game.coins1 += roll;

                } else {

                    game.coins1 -= roll;
                    game.coins2 += roll;
                }
            }


            /* إرسال النتيجة */
            send(game.player1, {

                type: "dice_result",

                roll: roll,

                coins1: game.coins1,

                coins2: game.coins2,

                currentPlayer:
                    game.currentPlayer,

                winner: winner
            });


            send(game.player2, {

                type: "dice_result",

                roll: roll,

                coins1: game.coins1,

                coins2: game.coins2,

                currentPlayer:
                    game.currentPlayer,

                winner: winner
            });


            /* إذا لم يوجد فائز ينتقل الدور */
            if (!winner) {

                game.currentPlayer =
                    game.currentPlayer === 1
                    ? 2
                    : 1;

            }


            game.rolling = false;


            /* إرسال الدور الجديد */
            if (!winner) {

                sendGameState();

            }


            return;
        }
    });


    /* خروج اللاعب */
    ws.on("close", () => {

        console.log("Player disconnected");


        if (waitingPlayer === ws) {

            waitingPlayer = null;

        }


        if (game) {

            if (
                ws === game.player1 ||
                ws === game.player2
            ) {

                const otherPlayer =
                    ws === game.player1
                    ? game.player2
                    : game.player1;


                send(otherPlayer, {
                    type: "opponent_disconnected"
                });


                game = null;
            }
        }
    });
});


const PORT =
    process.env.PORT || 3000;


server.listen(PORT, () => {

    console.log(
        `Server running on port ${PORT}`
    );

});
