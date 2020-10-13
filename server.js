const express = require("express");
const bodyParser = require('body-parser');
const dotenv = require("dotenv").config({path: './config.env'});
const connectDb = require("./config/db");
const morgan = require("morgan");
const mongodb = require('mongodb');
const ObjectID = require('mongodb').ObjectID;
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const cookieSession = require('cookie-session');
const app = express();
const Ably = require("ably");
const session = require("express-session");
const MongoStore = require("connect-mongo")(session);
const cookieParser = require("cookie-parser"); // parse cookie header
const mongoose = require("mongoose");
const {ensureAuth, ensureGuest} = require("./middleware/auth");


// morgan logging
app.use(morgan("dev"));

app.use(express.static("public"));
app.use(bodyParser.json());

app.use(cookieSession({
    name: "session",
    keys: ["thisappisawesome"],
    maxAge: 24 * 60 * 60 * 100
}));

// parse cookies
app.use(cookieParser());

// Sessions
app.use(
    session({
        secret: 'keyboard cat',
        resave: false,
        saveUninitialized: false,
        store: new MongoStore({mongooseConnection: mongoose.connection})
    })
)


//////////////////////// MONGO STUFF ////////////////////////
const client = new mongodb.MongoClient(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

let collection = null;

client.connect()
    .then(() => {
        return client.db('final-project').collection('users');
    })
    .then(__collection => {
        collection = __collection;

        return collection.find({}).toArray();
    })
    .then(console.log("MongoDB Connected Successfully!"));


//////////////////////// PASSPORT JS STUFF ////////////////////////
app.use(passport.initialize());
app.use(passport.session());


passport.use(new LocalStrategy(
    function (userName, passWord, done) {
        collection.find({
            username: userName,
        }).toArray()
            .then(function (result) {
                // successful login
                if (result.length >= 1) {
                    console.log("Successful Login!")
                    console.log(result);

                    // verify password
                    if (result[0].password === passWord) {
                        return done(null, userName, {
                            message: "Login Successful!"
                        });
                    } else {
                        return done(null, null, {
                            message: "Incorrect username / password"
                        });
                    }
                } else {
                    // create new user
                    collection.insertOne({username: userName, password: passWord, score: 0})
                        .then(() => {
                            return done(null, userName);
                        });
                }
            });
    }
));

passport.serializeUser(function (user, done) {
    done(null, user);
});

passport.deserializeUser(function (user, done) {
    done(null, user);
});

//////////////////////// GAME VARS ////////////////////////

const PLAYER_MOVEMENT_INCREMENT = 25;
const CANVAS_HEIGHT = 750;
const CANVAS_WIDTH = 1400;
const CANVAS_TO_ARRAY_HEIGHT_MODIFIER = (CANVAS_HEIGHT / PLAYER_MOVEMENT_INCREMENT) / CANVAS_HEIGHT
const CANVAS_TO_ARRAY_WIDTH_MODIFIER = (CANVAS_WIDTH / PLAYER_MOVEMENT_INCREMENT) / CANVAS_WIDTH
const PLAYER_VERTICAL_MOVEMENT_UPDATE_INTERVAL = 1000;
const PLAYER_SCORE_INCREMENT = 5;
const P2_WORLD_TIME_STEP = 1 / 16;
const OTHER_AXIS_RANGE = 20;
const SAME_AXIS_RANGE = 12;
const MIN_PLAYERS_TO_START_GAME = 4;
const PLAYER_MOVEMENT_OFFSET = PLAYER_MOVEMENT_INCREMENT / 2;

const GAME_TICKER_MS = 500;

let peopleAccessingTheWebsite = 0;
let players = {};
let monsters = {"Ivan": {x: 37.5, y: 37.5, direction: 1}};
let deadPlayers = new Array();
let rankings = new Array();
let coins = {}; // idea was to store this as an object so we can check if the size of the coins is 0 - at that point, the game is over
let walls = [ // 2d array of the whole board (walls) ( 1 is a wall, 0 is empty space that a player can occupy ) this will be 56x30  (each position is 25px).
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
    [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1],
    [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1],
    [1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1],
    [1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1],
    [1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1],
    [1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1],
    [1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 1],
    [1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1],
    [1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
    [1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
    [1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];
let playerChannels = {};
let gameOn = false;
let alivePlayers = 0;
let totalPlayers = 0;
let gameRoom;
let gameTickerOn = false;

// spawn locations - these are currently hardcoded for a 1400x750px board
let spawnLocations = [{x: 1362.5, y: 712.5, occupied: false}, {x: 37.5, y: 712.5, occupied: false}, {
    x: 1362.5,
    y: 37.5,
    occupied: false
}, {x: 37.5, y: 37.5, occupied: false}]
let avatarColors = ["green", "cyan", "yellow"];
let avatarTypes = ["A", "B", "C"];


// setup ably
const realtime = new Ably.Realtime({
    key: process.env.ABLY_API_KEY,
    echoMessages: false,
});


///////////////////// GAME LOGIC ////////////////////////
function subscribeToPlayerInput(channelInstance, playerId) {
    channelInstance.subscribe("pos", (msg) => {
        if (msg.data.keyPressed === "left") { // direction is West
            players[playerId].direction = 4;
        } else if (msg.data.keyPressed === "right") { // direction is East
            players[playerId].direction = 2;
        } else if (msg.data.keyPressed === "up") { // direction is North
            players[playerId].direction = 1;
        } else if (msg.data.keyPressed === "down") { // direction is South
            players[playerId].direction = 3;
        }
        // console.log( "Canvas W: " + CANVAS_WIDTH
        //  + ", Canvas H: "+ CANVAS_HEIGHT
        //  + ", Player X: " + players[playerId].x
        //  + ", Player Y: " + players[playerId].y )
    });

}

// move all present players based on their keyboard input
function moveEveryPlayer() {

    Object.values(players).forEach(function (player) {

        if (player !== null) {

            let tryDirection = player.direction;
            let previousX = player.x;
            let previousY = player.y;

            let movementDirection = (tryDirection === 1 || tryDirection === 3) ? 0 : 1;

            if (player.isAlive === false) {
                //console.log("FOUND DEAD PLAYER: " + player.id);
            }

            // can move in the current direction
            if (player.isAlive !== false && canMove(tryDirection, player)) {
                // console.log( "We can move in this direction: " + tryDirection )
                if (tryDirection === 1) { // direction is North
                    player.y -= PLAYER_MOVEMENT_INCREMENT
                    checkIfDead(player.id, player.y, previousY, previousX, movementDirection)

                } else if (tryDirection === 2) { // direction is West
                    player.x += PLAYER_MOVEMENT_INCREMENT
                    checkIfDead(player.id, previousX, player.x, previousY, movementDirection)

                } else if (tryDirection === 3) { // direction is South
                    player.y += PLAYER_MOVEMENT_INCREMENT
                    checkIfDead(player.id, previousY, player.y, previousX, movementDirection)

                } else if (tryDirection === 4) { // direction is East
                    player.x -= PLAYER_MOVEMENT_INCREMENT
                    checkIfDead(player.id, player.x, previousX, previousY, movementDirection)
                }
            }

            //console.log( "My player " + player.id + " updated position: x = " + player.x + ", y = " + player.y )
        }
        //console.log("My player's updated position: x = " + player.x + ", y = " + player.y)

        player.score += collectCoin(Math.floor(player.x / 25), (Math.floor(player.y / 25)))
    })
}

function getCoinId(x, y) {
    if (x < 10) {
        x = `0${x}`
    }

    if (y < 10) {
        y = `0${y}`
    }

    return `${x}|${y}`;
}

function collectCoin(x, y) {
    let coordinates = getCoinId(x, y)
    if (coordinates in coins) {
        let score = coins[coordinates]
        delete coins[coordinates]
        return score
    }
    return 0
}


function checkRange(positionVal, minimalRange, maxRange, constant) {
    if ((positionVal >= (minimalRange - constant)) &&
        (positionVal <= (maxRange + constant))) {
        return true;

    }

    return false;
}


function checkIfDead(id, minRange, maxRange, otherAxisVal, direction) {
    let inRange = false;
    let currentPlayerDead = false;

    Object.values(players).forEach(function (player) {
        if (player.id !== id && player.isAlive) {
            // direction was vertical (SAME AXIS WOULD BE Y-AXIS)
            if (direction === 0) {

                if (checkRange(player.y, minRange, maxRange, SAME_AXIS_RANGE) &&
                    checkRange(player.x, otherAxisVal, otherAxisVal, OTHER_AXIS_RANGE)) {
                    inRange = true;
                }

            } else { // direction was horizontal (SAME AXIS WOULD BE X-AXIS)

                if (checkRange(player.x, minRange, maxRange, SAME_AXIS_RANGE) &&
                    checkRange(player.y, otherAxisVal, otherAxisVal, OTHER_AXIS_RANGE)) {
                    inRange = true;
                }
            }

            if (inRange) {
                currentPlayerDead = true;
                console.log("Killed " + player.id)
                console.log(player.id)
                player.isAlive = false;

            }
        }

        inRange = false
    })

    if (currentPlayerDead) {
        if (players[id].isAlive) {
            console.log("Killing Current")
            console.log(id)
            //deadPlayers.push(players[id])
            players[id].isAlive = false;
        }

        collection
            .updateOne(
                {username: players[id].id},
                {
                    $set: {"score": players[id].score}
                }
            )
        //players[id].score =100; for testing purposes
        //console.log("Deleted " + players[id].id);
        //delete players[id];
    }
}


function withinBoundary(x, y) {
    if (x >= 0 && x <= CANVAS_WIDTH) {
        if (y >= 0 && y <= CANVAS_HEIGHT) {
            return true;
        }
    }

    return false;
}

function moveAllMonsters() {
    Object.values(monsters).forEach(function (monster) {
            let tryDirection = monster.direction;
            let newDirection = null;

            if (canMove(tryDirection, monster)) {
                newDirection = tryDirection
            } else {
                newDirection = getRandomAvailableDir(monster, tryDirection)
            }

            if (newDirection === 1) { // direction is North
                monster.y -= PLAYER_MOVEMENT_INCREMENT

            } else if (newDirection === 2) { // direction is West
                monster.x += PLAYER_MOVEMENT_INCREMENT

            } else if (newDirection === 3) { // direction is South
                monster.y += PLAYER_MOVEMENT_INCREMENT

            } else if (newDirection === 4) { // direction is East
                monster.x -= PLAYER_MOVEMENT_INCREMENT
            }
            console.log("Monster's new position: " +monster.x + ", " +monster.y)
        }
    )
}

function getRandomAvailableDir(monster, current) {
    let available = []
    for (let i = 1; i < 5; i++) {
        if (i === current) continue;
        if (canMove(i, monster)) {
            available.push(i)
        }
    }
    return available[Math.floor(Math.random() * available.length)]
}


function gameHasEnded() {
    let numOfDeadPlayers = deadPlayers.length

    let count = Object.keys(coins).length

    // do no know if this works
    if (count === 0) {
        return true;
    }

    if (totalPlayers > 1) {
        if (numOfDeadPlayers === totalPlayers || numOfDeadPlayers === (totalPlayers - 1)) {
            return true;
        }

    }

    return false;
}


function finishGame() {

    console.log("Dead Players = " + deadPlayers.length)
    console.log("Alive Players = " + alivePlayers)

    let winnerName = "Nobody";

    Object.values(players).forEach(function (player) {
        rankings.push({
            name: player.id,
            score: player.score,
        });
        collection
            .updateOne(
                {username: player.id},
                {
                    $set: {"score": player.score}
                }
            )
    });

    rankings.sort((a, b) => {
        return b.score - a.score;
    });

    if (totalPlayers === 1) {
        winnerName = rankings[0].name;

    } else if (rankings[0].score !== rankings[1].score) {
        winnerName = rankings[0].name;
    }


    gameRoom.publish("game-over", {
        winner: winnerName,
        totalPlayers: totalPlayers,
    });

    console.log("GAME OVER");
    resetServerState();
}


// check if a player's move would be valid
// check against game boundaries
// check against wall locations
function canMove(direction, player) {

    if (players[player.id] === null) {
        return false;
    }

    let positionX = player.x;
    let positionY = player.y;

    // console.log( "My current location: Pixels - " + positionX + ", " + positionY ". Array - " )

    var positionXArray = 1
    var positionYArray = 1
    //console.log("My direction: " + direction)
    if (direction === 1) { // direction is North
        positionY -= PLAYER_MOVEMENT_INCREMENT;
        positionXArray = (positionX - PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_WIDTH_MODIFIER
        positionYArray = (positionY - PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_HEIGHT_MODIFIER


    } else if (direction === 2) { // direction is East
        positionX += PLAYER_MOVEMENT_INCREMENT;
        positionXArray = (positionX - PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_WIDTH_MODIFIER
        positionYArray = (positionY - PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_HEIGHT_MODIFIER

    } else if (direction === 3) { // direction is South
        positionY += PLAYER_MOVEMENT_INCREMENT;
        positionXArray = (positionX - PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_WIDTH_MODIFIER
        positionYArray = (positionY + PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_HEIGHT_MODIFIER - 1

    } else if (direction === 4) { // direction is West
        positionX -= PLAYER_MOVEMENT_INCREMENT;
        positionXArray = (positionX + PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_WIDTH_MODIFIER - 1
        positionYArray = (positionY - PLAYER_MOVEMENT_OFFSET) * CANVAS_TO_ARRAY_HEIGHT_MODIFIER
    }

    if (!withinBoundary(positionXArray, positionYArray)) {
        console.log("Error! That would be outside of the boundary. X: " + positionX + ", Y: " + positionY)
        return false;
    }

    //checking if wall is present

    //console.log( "destination coordinates: Pixels - " + positionX + ", " + positionY + ". Array - " + positionYArray + ", " + positionXArray )
    // console.log( "That space contains: " + walls[positionYArray][positionXArray] )
    if (walls[positionYArray][positionXArray] === 1) {
        //console.log("There is a wall here")
        return false;
    } else {
        return true
    }

}

const startGameDataTicker = function () {

    for (let i = 0; i < walls[0].length; i++) {
        for (let j = 0; j < walls.length; j++) {
            if (walls[j][i] === 0) {
                let id = getCoinId(i, j)
                let coin = 5
                coins[id] = coin
            }
        }
    }

    let tickInterval = setInterval(() => {
        if (!gameTickerOn) {
            clearInterval(tickInterval);
        } else {
            // move every player
            moveEveryPlayer();
            moveAllMonsters()
            gameRoom.publish("game-state", {
                players: players,
                playerCount: totalPlayers,
                gameOn: gameOn,
                monsters: monsters,
                coins
            });

            // right here check for end game
            if (gameHasEnded()) {
                finishGame();
            }
        }
    }, GAME_TICKER_MS);
}


const handlePlayerEntered = function (player) {
    let newPlayerId;
    alivePlayers++;
    totalPlayers++;

    let xPos;
    let yPos;
    if (totalPlayers === 1) {
        gameTickerOn = true;
        startGameDataTicker();
    }

    newPlayerId = player.clientId;
    playerChannels[newPlayerId] = realtime.channels.get(
        "clientChannel-" + player.clientId
    );


    // check through the spawn locations to find a location that has not been used yet


    for (location of spawnLocations) {
        if (location.occupied === false) {
            xPos = location.x
            yPos = location.y
            location.occupied = true
            break;
        }
    }

    //TODO figure out how to spawn them in a smarter way

    let newPlayerObject = {
        id: newPlayerId,
        x: xPos,
        y: yPos,
        invaderAvatarType: avatarTypes[randomAvatarSelector()], // get from db
        invaderAvatarColor: avatarColors[randomAvatarSelector()],
        direction: 1,
        score: 0,
        isAlive: true
    };

    players[newPlayerId] = newPlayerObject;
    subscribeToPlayerInput(playerChannels[newPlayerId], newPlayerId);
}

const handlePlayerLeft = function (player) {
    let leavingPlayer = player.clientId;
    alivePlayers--;
    totalPlayers--;
    delete players[leavingPlayer];
    if (totalPlayers <= 0) {
        resetServerState();
    }
}

function resetServerState() {
    peopleAccessingTheWebsite = 0;
    gameOn = false;
    gameTickerOn = false;
    totalPlayers = 0;
    alivePlayers = 0;
    deadPlayers = [];
    spawnLocations = [{x: 1362.5, y: 712.5, occupied: false}, {x: 37.5, y: 712.5, occupied: false}, {
        x: 1362.5,
        y: 37.5,
        occupied: false
    }, {x: 37.5, y: 37.5, occupied: false}]

    for (let item in playerChannels) {
        playerChannels[item].unsubscribe();
    }
}

function randomAvatarSelector() {
    return Math.floor(Math.random() * 3);
}

///////////////////// END GAME LOGIC ////////////////////////

// initialize channels and channel-listeners
realtime.connection.once("connected", () => {
    gameRoom = realtime.channels.get("game-room");
    gameRoom.presence.subscribe("enter", (player) => handlePlayerEntered(player));
    gameRoom.presence.subscribe("leave", (player) => handlePlayerLeft(player));
});


// routes
app.get("/auth/game", (request, response) => {
    const tokenParams = {clientId: request.user};
    realtime.auth.createTokenRequest(tokenParams, function (err, tokenRequest) {
        if (err) {
            response
                .status(500)
                .send("Error requesting token: " + JSON.stringify(err));
        } else {
            response.setHeader("Content-Type", "application/json");
            response.send(JSON.stringify(tokenRequest));
        }
    });
});

app.get("/getBoard", bodyParser.json(), (req, res) => res.json(walls))

app.get("/topScores", bodyParser.json(), (req, res) => {
    collection.find().project({
        username: 1,
        score: 1
    }).sort({score: -1}).limit(10).toArray().then(result => res.json(result))
})

app.get('/', ensureAuth, (req, res) => {
    console.log(req.user);
    res.sendFile(__dirname + "/views/home.html");
});

app.get('/login', ensureGuest, (req, res) => {
    res.sendFile(__dirname + "/views/login.html");
});

app.get('/game', ensureAuth, (req, res) => {
    peopleAccessingTheWebsite++;

    if (peopleAccessingTheWebsite > MIN_PLAYERS_TO_START_GAME) {
        res.sendFile(__dirname + "/views/gameRoomFull.html")
    } else {
        res.sendFile(__dirname + "/views/game.html");
    }
});

app.get('/auth/logout', (req, res) => {
    req.logout();
    res.redirect('/login')
});

app.post("/auth/signin", passport.authenticate('local', {failureRedirect: '/login'}), (req, res) => {
    res.redirect('/');
});

app.listen(process.env.PORT, () => {
    console.log("Server is listening on port: ", process.env.PORT);
});
