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

wss.on("connection", (ws) => {

    console.log("Player connected");

    ws.send(JSON.stringify({
        type: "connected"
    }));

    ws.on("message", (message) => {

        let data;

        try {
            data = JSON.parse(message);
        } catch {
            return;
        }

        if (data.type === "find_match") {

            // إذا لا يوجد لاعب ينتظر
            if (
                waitingPlayer === null ||
                waitingPlayer.readyState !== WebSocket.OPEN
            ) {

                waitingPlayer = ws;

                ws.send(JSON.stringify({
                    type: "waiting"
                }));

                console.log("Player waiting");

                return;
            }

            // وجدنا لاعبًا ثانيًا
            const player1 = waitingPlayer;
            const player2 = ws;

            waitingPlayer = null;

            console.log("Match found");

            player1.send(JSON.stringify({
                type: "matched",
                player: 1
            }));

            player2.send(JSON.stringify({
                type: "matched",
                player: 2
            }));
        }
    });

    ws.on("close", () => {

        if (waitingPlayer === ws) {
            waitingPlayer = null;
        }

        console.log("Player disconnected");
    });
});


const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(
        `Server running on port ${PORT}`
    );
});
