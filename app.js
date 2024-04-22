import express from "express";
import "dotenv/config";
import SpotifyWebApi from "spotify-web-api-node";
import cookieParser from "cookie-parser";
import session from "express-session";
import SolrNode from "solr-node";

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const REDIRECT_URI = process.env.REDIRECT_URI;

const credentials = {
    clientId: CLIENT_ID,
    clientSecret: SECRET_KEY,
    redirectUri: REDIRECT_URI,
};
const spotifyAuthAPI = new SpotifyWebApi(credentials);

const app = express();
app.use(cookieParser());
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(
    session({
        secret: "mysecretkey7324687",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: "auto", maxAge: 86400000 },
    })
);

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
const scopes = ["user-top-read playlist-modify-private"];
const authorizeURL = spotifyAuthAPI.createAuthorizeURL(scopes, stateString);

app.get("/", (req, res) => {
    res.cookie("authState", stateString);
    res.redirect(authorizeURL);
});

app.get("/callback", (req, res) => {
    if (req.query.state !== req.cookies["authState"]) {
        return res.redirect("/");
    }
    res.clearCookie("authState");

    const authenticationCode = req.query.code;
    if (authenticationCode) {
        spotifyAuthAPI
            .authorizationCodeGrant(authenticationCode)
            .then((data) => {
                res.cookie("accTkn", data.body["access_token"], {
                    maxAge: data.body["expires_in"] * 1000,
                });
                res.cookie("refTkn", data.body["refresh_token"]);
                return res.render("home.ejs");
            });
    }
});

const accTknRefreshments = (req, res, next) => {
    if (req.cookies["accTkn"]) {
        spotifyAuthAPI.setAccessToken(req.cookies["accTkn"]);
        return next();
    } else if (req.cookies["refTkn"]) {
        spotifyAuthAPI.setRefreshToken(req.cookies["refTkn"]);
        spotifyAuthAPI
            .refreshAccessToken()
            .then((data) => {
                const newAccTok = data.body["access_token"];
                res.cookie("accTkn", newAccTok, {
                    maxAge: data.body["expires_in"] * 1000,
                });
                spotifyAuthAPI.setAccessToken(newAccTok);
                return next();
            })
            .catch((err) => {
                console.error("Error refreshing access token", err);
                return res.redirect("/");
            });
    } else {
        return res.redirect("/");
    }
};

app.post("/initial_selections", (req, res) => {
    req.session.playlistName = req.body.playlistName;
    req.session.playlistSize = req.body.playlistSize;
    req.session.playlistDesc = req.body.playlistDesc;
    const timeRange = req.body.timeRange;

    res.redirect(`/artists?time_range=${encodeURIComponent(timeRange)}`);
});

app.get("/artists", accTknRefreshments, (req, res) => {
    const timeRangeMap = {
        short: "short_term", // 4 weeks
        medium: "medium_term", // 6 months
        long: "long_term", // 1 year
    };
    let timeRange = req.query.time_range;
    timeRange = timeRangeMap[timeRange] || "medium_term";

    spotifyAuthAPI
        .getMyTopArtists({ limit: 20, time_range: timeRange })
        .then((data) => {
            const artists = data.body.items.map((artist) => ({
                id: artist.id,
                name: artist.name,
                imageUrl: artist.images[0]
                    ? artist.images[0].url
                    : "https://via.placeholder.com/150",
                genres: artist.genres.join(", "),
                followers: artist.followers.total,
            }));
            res.render("artists", {artists: artists});
        })
        .catch((err) => {
            console.error("Error fetching top artists", err);
            res.status(500).send("Failed to fetch top artists");
        });
});

app.post("/artist_selections", async (req, res) => {
    let selectedArtists = req.body.selectedArtists || [];
    selectedArtists = selectedArtists.filter((artist) => artist.trim() !== "");

    if (!Array.isArray(selectedArtists)) {
        selectedArtists = [selectedArtists];
    }

    req.session.artists = selectedArtists;

    try {
        const genres = new Set();
        for (const artist of selectedArtists) {
            const response = await spotifyAuthAPI.getArtist(artist);
            response.body.genres.forEach((genre) => genres.add(genre));
        }
        res.render("features", {
            genres: Array.from(genres),
            selectedArtists: selectedArtists,
        });
    } catch (err) {
        console.error("Error fetching artist genres", err);
        res.status(500).send("Failed to fetch artist genres.");
    }
});

app.get("/feature_selections", (req, res) => {
    res.render("features");
});

app.post("/feature_selections", async (req, res) => {
    let selectedGenres = req.body.selectedGenres || [];
    selectedGenres = selectedGenres.filter((genre) => genre.trim() !== "");
    if (!Array.isArray(selectedGenres)) {
        selectedGenres = [selectedGenres];
    }
    req.session.genres = selectedGenres;

    const features = {
        danceability: [
            req.body["danceability-min"],
            req.body["danceability-max"],
        ],
        energy: [req.body["energy-min"], req.body["energy-max"]],
        loudness: [
            -60 + 60 * req.body["loudness-min"],
            -60 + 60 * req.body["loudness-max"],
        ],
        mode: [req.body["mode-min"], req.body["mode-max"]],
        acousticness: [
            req.body["acousticness-min"],
            req.body["acousticness-max"],
        ],
        instrumentalness: [
            req.body["instrumentalness-min"],
            req.body["instrumentalness-max"],
        ],
        tempo: [232 * req.body["tempo-min"], 232 * req.body["tempo-max"]],
        valence: [req.body["valence-min"], req.body["valence-max"]],
    };
    req.session.features = features;

    var rel_artists = new Set();

    // Get artists related to an artist
    for (var artist of req.session.artists) {
        var rel_artist = await spotifyAuthAPI.getArtistRelatedArtists(artist);
        for (var ra of rel_artist.body.artists) {
            rel_artists.add(ra.id);
        }
    }
    //   console.log(rel_artists);

    var playlist = await makePlaylist(
        req.session.playlistSize,
        req.session.artists,
        Array.from(rel_artists),
        req.session.genres,
        req.session.features
    );
    if (playlist.length > 0) {
        var playlistReqs = splitPlaylist(playlist);

        spotifyAuthAPI
            .createPlaylist(req.session.playlistName, {
                description: req.session.playlistDesc,
                public: false,
            })
            .then(
                function (data) {
                    console.log("Created playlist with id " + data.body.id);
                    switch (data.statusCode) {
                        case 201:
                            var playlistID = data.body.id;
                            req.session.playlistID = playlistID;
                            for (req of playlistReqs) {
                                spotifyAuthAPI
                                    .addTracksToPlaylist(playlistID, req)
                                    .then(
                                        function (data) {
                                            console.log(
                                                "Added tracks to playlist!"
                                            );
                                        },
                                        function (err) {
                                            console.log(
                                                "Something went wrong!",
                                                err
                                            );
                                        }
                                    );
                            }
                            res.status(200).redirect("/success");
                            break;
                        case 401:
                            res.status(401).send("Authentication failure");
                            res.redirect("/");
                            break;
                        case 402:
                            res.status(403).send("Bad OAuth");
                            break;
                        case 429:
                            res.status(429).send(
                                "The app has reached its limits, try again tomorrow!"
                            );
                    }
                    return;
                },
                function (err) {
                    console.log("Something went wrong!", err);
                }
            );
    }
});

app.get("/success", accTknRefreshments, async (req, res) => {
    try {
        const data = await spotifyAuthAPI.getPlaylist(req.session.playlistID);
        // console.log(data.body);

        const playlistDetails = {
            name: req.session.playlistName,
            size: req.session.playlistSize,
            description: req.session.playlistDesc,
            link: `https://open.spotify.com/playlist/${req.session.playlistID}` 
        };
        console.log(playlistDetails);
        res.render('success', { playlist: playlistDetails });
    } catch (err) {
        console.error('Something went wrong!', err);
        res.status(500).send("Failed to fetch playlist details.");
    }
});


async function makePlaylist(
    playlistSize,
    artists,
    rel_artists,
    genres,
    ranges
) {
    const validSorts = [
        "duration_ms",
        "danceability",
        "energy",
        "key",
        "loudness",
        "mode",
        "speechiness",
        "acousticness",
        "instrumentalness",
        "liveness",
        "valence",
        "tempo",
        "time_signature",
        "_version_",
    ];
    const validSortDirections = ["%20desc", "%20asc"];
    const playlist = new Set();

    // var solr = require("solr-client");

    var client = new SolrNode({
        host: "127.0.0.1",
        port: "8983",
        core: "final",
        protocol: "http",
    });

    var rangeStr =
        "" + " AND danceability:[" + ranges["danceability"][0] + " TO " + ranges["danceability"][1] + "]" +
        " OR " +
        "energy:[" + ranges["energy"][0] + " TO " + ranges["energy"][1] + "]" +
        " OR " +
        "loudness:[" + ranges["loudness"][0] + " TO " + ranges["loudness"][1] + "]" +
        " OR " +
        "mode:[" + ranges["mode"][0] + " TO " + ranges["mode"][1] + "]" +
        " OR " +
        "acousticness:[" + ranges["acousticness"][0] + " TO " + ranges["acousticness"][1] + "]" +
        " OR " +
        "instrumentalness:[" + ranges["instrumentalness"][0] + " TO " + ranges["instrumentalness"][1] + "]" +
        " OR " +
        "valence:[" + ranges["valence"][0] + " TO " + ranges["valence"][1] + "]" +
        " OR " +
        "tempo:[" + ranges["tempo"][0] + " TO " + ranges["tempo"][1] + "]";
    var counter = 0;

    while (playlist.size < playlistSize && counter < playlistSize) {
        counter++;
        var rand = Math.ceil(Math.random() * 3 + 5);
        let songsToAdd = Math.min(rand, playlistSize - playlist.size);

        rand = Math.floor(Math.random() * 3);

        console.log(
            "Adding " +
                songsToAdd +
                " songs to playlist of size " +
                playlist.size +
                " with randCode " +
                rand
        );
        switch (rand) {
            case 0: // Query by selected artist
                if (artists.length < 1) {
                    break;
                }
                songsToAdd = Math.floor(songsToAdd * 1.5);
                var sortBy =
                    "&sort=" +
                    validSorts[Math.floor(Math.random() * validSorts.length)] +
                    validSortDirections[
                        Math.floor(Math.random() * validSortDirections.length)
                    ];
                var strQuery = client
                    .query()
                    .q(
                        'artist_uri:"spotify:artist:' +
                            artists[
                                Math.floor(Math.random() * artists.length)
                            ] +
                            '"' +
                            rangeStr
                    )
                    .start("0")
                    .rows("100");
                strQuery += sortBy;
                var addingSongs = await queryAndReturnSelection(
                    strQuery,
                    songsToAdd,
                    client
                );
                for (var song of addingSongs) {
                    playlist.add(song);
                }
                break;
            case 1: // Query by related artists
                if (rel_artists.length < 1) {
                    break;
                }
                var sortBy =
                    "&sort=" +
                    validSorts[Math.floor(Math.random() * validSorts.length)] +
                    validSortDirections[
                        Math.floor(Math.random() * validSortDirections.length)
                    ];
                var strQuery = client
                    .query()
                    .q(
                        'artist_uri:"spotify:artist:' +
                            rel_artists[
                                Math.floor(Math.random() * rel_artists.length)
                            ] +
                            '"' +
                            rangeStr
                    )
                    .start("0")
                    .rows("100");
                strQuery += sortBy;
                var addingSongs = await queryAndReturnSelection(
                    strQuery,
                    songsToAdd,
                    client
                );
                for (var song of addingSongs) {
                    playlist.add(song);
                }
                break;
            case 2: // Query by Genre
                if (genres.length < 1) {
                    break;
                }
                var sortBy =
                    "&sort=" +
                    validSorts[Math.floor(Math.random() * validSorts.length)] +
                    validSortDirections[
                        Math.floor(Math.random() * validSortDirections.length)
                    ];
                var strQuery = client
                    .query()
                    .q(
                        'genre:"' +
                            genres[Math.floor(Math.random() * genres.length)] +
                            '"' +
                            rangeStr
                    )
                    .start("0")
                    .rows("100");
                strQuery += sortBy;
                var addingSongs = await queryAndReturnSelection(
                    strQuery,
                    songsToAdd,
                    client
                );
                for (var song of addingSongs) {
                    playlist.add(song);
                }
                break;
        }
    }
    const playlistArray = Array.from(playlist);
    let shuffledPlaylist = playlistArray
        .map((value) => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);
    return shuffledPlaylist;
}

function randomIndicies(length, num_wanted) {
    const out = [];
    if (length <= num_wanted) {
        for (i = 0; i < length; i++) {
            out.push(i);
        }
    } else {
        for (var i = 0; i < num_wanted; i++) {
            let new_idx = Math.floor(Math.random() * length);
            while (out.includes(new_idx)) {
                new_idx = Math.floor(Math.random() * length);
            }
            out.push(new_idx);
        }
    }
    return out;
}

function splitPlaylist(playlist) {
    let maxSendSize = 50;
    let numMessages = Math.ceil(playlist.length / maxSendSize);
    console.log("Playlist requires " + numMessages + " messages");
    const messages = [];

    for (var i = 0; i < numMessages; i++) {
        messages[i] = [];
    }

    let counter = 0;
    for (const song of playlist) {
        messages[counter].push(song);
        counter = (counter + 1) % numMessages;
    }
    return messages;
}

async function queryAndReturnSelection(strQuery, numToSelect, client) {
    let playlist = [];
    try {
        var result = await client.search(strQuery);
        var response = result.response;
        if (response.numFound > 0) {
            var numToChooseFrom = Math.min(response.numFound, 100);
            var chosenIndices = randomIndicies(numToChooseFrom, numToSelect);
            for (var i of chosenIndices) {
                playlist.push(response.docs[i].song_uri[0]);
            }
        }
    } catch (e) {
        console.log("Erroring query: " + strQuery);
        console.error(e);
    }
    return playlist;
}

console.log("authTest running on port " + PORT);
app.listen(PORT);
