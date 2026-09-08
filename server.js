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


/* إرسال رسالة */
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


/* تنظيف اسم اللاعب */
function cleanName(name) {

    if (typeof name !== "string")
        return "Player 1";

    name = name.trim();

    if (name === "")
        return "Player 1";

    return name.slice(0, 20);
}


/* إرسال حالة اللعبة */
function sendGameState() {

    if (!game)
        return;

    const state = {

        type: "game_state",

        coins1: game.coins1,

        coins2: game.coins2,

        currentPlayer:
            game.currentPlayer,

        player1Name:
            game.player1Name,

        player2Name:
            game.player2Name
    };


    send(
        game.player1,
        state
    );

    send(
        game.player2,
        state
    );
}


/* اتصال لاعب */
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


        /* =====================
           البحث عن مباراة
        ===================== */

        if(data.type === "find_match") {


            /* حفظ اسم اللاعب */

            ws.playerName =
                cleanName(data.name);


            /*
             إذا لا يوجد لاعب ينتظر
             يصبح هذا اللاعب منتظرًا
            */

            if(
                waitingPlayer === null ||
                waitingPlayer.readyState !== WebSocket.OPEN
            ){

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
             إذن وجدنا مباراة
            */

            const player1 =
                waitingPlayer;

            const player2 =
                ws;


            waitingPlayer = null;


            /*
             إنشاء اللعبة
            */

            game = {

                player1: player1,

                player2: player2,

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


            console.log(
                "Match found:",
                game.player1Name,
                "vs",
                game.player2Name
            );


            /* إخبار اللاعب الأول */

            send(player1, {

                type: "matched",

                player: 1,

                myName:
                    game.player1Name,

                opponentName:
                    game.player2Name
            });


            /* إخبار اللاعب الثاني */

            send(player2, {

                type: "matched",

                player: 2,

                myName:
                    game.player2Name,

                opponentName:
                    game.player1Name
            });


            /* إرسال حالة البداية */

            sendGameState();


            return;
        }


        /* =====================
           رمي النرد
        ===================== */

        if(data.type === "roll") {


            if(!game)
                return;


            /*
             التأكد أن اللاعب
             داخل المباراة
            */

            if(
                ws !== game.player1 &&
                ws !== game.player2
            ){

                return;
            }


            /*
             التأكد أن هذا
             هو دوره
            */

            if(
                ws.playerNumber !==
                game.currentPlayer
            ){

                return;
            }


            /*
             منع الرمي المكرر
            */

            if(game.rolling)
                return;


            game.rolling = true;


            /*
             السيرفر هو الذي
             يولد نتيجة النرد
            */

            const roll =
                Math.floor(
                    Math.random() * 6
                ) + 1;


            let opponentCoins;


            if(
                game.currentPlayer === 1
            ){

                opponentCoins =
                    game.coins2;

            }else{

                opponentCoins =
                    game.coins1;
            }


            let winner = null;


            /*
             إذا النرد مساوي
             لعملات الخصم = فوز
            */

            if(
                roll === opponentCoins
            ){

                winner =
                    game.currentPlayer;
            }


            /*
             إذا النرد أقل
             تنتقل العملات
            */

            else if(
                roll < opponentCoins
            ){

                if(
                    game.currentPlayer === 1
                ){

                    game.coins2 -= roll;

                    game.coins1 += roll;

                }else{

                    game.coins1 -= roll;

                    game.coins2 += roll;
                }
            }


            /*
             حفظ اللاعب الذي رمى
             قبل تغيير الدور
            */

            const roller =
                game.currentPlayer;


            /*
             إرسال النتيجة للاعبين
            */

            const result = {

                type: "dice_result",

                roll: roll,

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
             ننتقل للدور التالي
            */

            if(!winner){

                game.currentPlayer =
                    game.currentPlayer === 1
                    ? 2
                    : 1;


                sendGameState();
            }


            game.rolling = false;


            return;
        }

    });


    /* =====================
       خروج اللاعب
    ===================== */

    ws.on("close", () => {

        console.log(
            "Player disconnected"
        );


        /*
         إذا كان ينتظر
        */

        if(
            waitingPlayer === ws
        ){

            waitingPlayer = null;
        }


        /*
         إذا كان داخل لعبة
        */

        if(game){

            if(
                ws === game.player1 ||
                ws === game.player2
            ){

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


                game = null;
            }
        }

    });

});


/* =====================
   تشغيل السيرفر
===================== */

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
