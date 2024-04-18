// require("dotenv").config();
// We set REDIRECT_URI in process.env but have falsy alternatives set in place, just in case.

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const REDIRECT_URI = process.env.REDIRECT_URI;


const SpotifyWebApi = require("spotify-web-api-node");
const spotifyAuthAPI = new SpotifyWebApi({
    clientId: CLIENT_ID,
    clientSecret: SECRET_KEY,
    redirectUri: REDIRECT_URI,
});

const express = require("express");
const app = express();
const cookieParser = require("cookie-parser");
app.use(cookieParser());



app.get("/", (req, res) => {
    const generateRandomString = (length) => {
        let text = "";
        let possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

        for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    };

    const stateString = generateRandomString(16);
    res.cookie("authState", stateString);

    const scopes = ["user-top-read"];
    const loginLink = spotifyAuthAPI.createAuthorizeURL(scopes, stateString);
    res.redirect(loginLink);
}); 

app.get("/callback", (req, res) => {
    if (req.query.state !== req.cookies["authState"]) {
        return res.redirect("/");
      }
    
      res.clearCookie("authState");

      const authenticationCode = req.query.code;
      if (authenticationCode) {
        spotifyAuthAPI.authorizationCodeGrant(authenticationCode).then((data) => {
          res.cookie("accTkn", data.body["access_token"], {
            maxAge: data.body["expires_in"] * 1000,
          });
          res.cookie("refTkn", data.body["refresh_token"]);
    
          // poor man's JSON visualizer.
          // You should stay here or redirect to another page instead of including this bit.
          return res
            .status(200)
            .send(`<pre>${JSON.stringify(data.body, null, 2)}</pre>`);
        });
      }
});

const accTknRefreshments = (req, res, next) => {
    if (req.cookies["accTkn"]) return next();
    else if (req.cookies["refTkn"]) {
      spotifyAuthAPI.setRefreshToken(refresh_token);
      spotifyAuthAPI.refreshAccessToken().then((data) => {
        spotifyAuthAPI.resetRefreshToken();
  
        const newAccTok = data.body["access_token"];
        res.cookie("accTkn", newAccTok, {
          maxAge: data.body["expires_in"] * 1000,
        });
  
        return next();
      });
    } else {
      return res.redirect("/");
    }
  };

app.get("/top", accTknRefreshments, (req, res) => {
    const spotifyAPI = new SpotifyWebApi({ accessToken: req.cookies["accTkn"] });
  
    count = 50;
    spotifyAPI
        .getMyTopArtists({ limit: count, time_range: "long_term" })
        .then((data) => {
        return res
            .status(200)
            .send(`<pre>${JSON.stringify(data.body.items, null, 2)}</pre>`);
      });
  });


console.log("authTest running on port " + PORT);
app.listen(PORT);