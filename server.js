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

// morgan logging
app.use(morgan("dev"));

app.use(express.static("public"));
app.use(bodyParser.json());

app.use(cookieSession({
    name: 'session',
    keys: ['key1']
}));

function setUserSession(request, username) {
    request.session['User'] = username;
}

//connectDb(process.env.MONGO_URI)

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
passport.use(new LocalStrategy(
    function (userName, passWord, done) {
        collection.find({
            username: userName,
            password: passWord
        }).toArray()

        .then(function (result) {
            // successful login
            if (result.length >= 1) {
                console.log("Successful Login!")
                return done(null, userName, {
                    message: "Login Successful!"
                });

            } else {
                // failed login
                console.log("Login Failed!")
                return done(null, false, {
                    message: "Incorrect username or password!"
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

app.use(passport.initialize());

//////////////////////// <--- END PASSPORT JS STUFF ---> ////////////////////////

// routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + "/views/home.html");
});

app.get('/login', (req, res) => {
    res.sendFile(__dirname + "/views/login.html");
});

/*
app.post("/login", bodyParser.json(), function(req, res, next) {
    passport.authenticate('local', function(err, user, info) {
        if (err) {
            return next(err);
        }

        if (!user) {
            return res.json({message: info.message})
        
        } else {
            console.log('FOUND')
        }
    })
});
*/

/*
TODO
-get page to be redirected
*/
app.post("/login", bodyParser.json(),
    function(req, res, next) {
        passport.authenticate('local', function(error, user, info) {
            if (error) {
                res.status(401).send(error);
            
            } else if (!user) {
                res.status(401).send(info);
            
            } else {
                next();
            }
            
            //res.status(401).send(info);
        }) (req, res);
    },

    function (request, response) {
        let userName = request.body.username;
        console.log('Logged In')
        setUserSession(request, userName);
        response.redirect("/");
    }
);


app.post("/signUp", bodyParser.json(), (request, response) => {

    collection.find({
        username: request.body.username
    }).toArray()

    .then(function (result) {
        if (result.length < 1) {
            console.log("New User!");

            collection.insertOne(request.body)
            .then(() => {
                let userName = request.body.username;
                setUserSession(request, userName);

                response.status(200).send({message: "User was created!"});
            });

        } else {
            response.status(401).send({message: "User with the given username already exists"});
        }
    }).catch(function () {
        console.log("Rejected");
    });
});


app.listen(process.env.PORT, () => {
    console.log("Server is listening on port: ", process.env.PORT);
});
