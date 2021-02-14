const express = require("express");
const app = express();
const fs = require("fs");
const xml2js = require("xml2js");
const crypto = require("crypto");

const streams = {};
const sessions = {};

/**
 * Accelerated way to calculte a^b mod n
 * @param {bigint} a 
 * @param {bigint} b 
 * @param {bigint} n 
 */
function modExp(a, b, n) {
	a = a % n;
    var result = 1n;
    var x = a;
    while (b > 0) {
        var leastSignificantBit = b % 2n;
        b = b / 2n;
        if (leastSignificantBit == 1n) {
            result = result * x;
            result = result % n;
        }
        x = x * x;
        x = x % n;
    }
    return result;
};

/**
 * Stream meta-data endpoint
 * In order to establish stream, we need to communicate
 * shared key over Diffie-Hellman key exchange
 * and send simplified version of .mpd file as JSON
 * to client
 */
app.get("/stream/:id", async (req, res) => {
    if(!req.params.id){
        return res.send({error: "unknown stream"});
    }
    if(!req.headers.dhea || !req.headers.dhep || !req.headers.dheg){
        return res.send({error: "dhe missing"});
    }
    const session = crypto.randomBytes(16).toString("base64");
    /**
     * Diffie-Hellman parameters
     * g = generator
     * p = prime
     * A = g^a mod A, where a is client's privately chosen bigint
     */
    const dheParams = {
        g: req.headers.dheg,
        p: req.headers.dhep,
        A: req.headers.dhea
    };
    /**
     * Make sure to correctly padd to zeroes
     */
    ["g", "p", "A"].forEach( (key) => {
        if(dheParams[key].length % 2 == 1)
            dheParams[key] = "0" + dheParams[key];
        return key;
    });
    /**
     * Now it's time to compute shared secret
     */
    const dhe = crypto.createDiffieHellman(Buffer.from(dheParams.p, "hex"), Buffer.from(dheParams.g, "hex"));
    dhe.generateKeys();
    dheParams.g2 = dhe.getGenerator("hex");
    dheParams.p2 = dhe.getPrime("hex");
    dheParams.b = dhe.getPrivateKey("hex"); // b is our private key
    dheParams.B = dhe.getPublicKey("hex");  // B is g^b mod p, we send this one to client
    dheParams.K = dhe.computeSecret(dheParams.A, "hex", "hex"); // We compute shared key, that is A^b mod p

    // Let's remember shared key to given session
    sessions[session] = crypto.createHash("sha256").update(dheParams.K).digest();

    // Translate complicated .mpd XML file into simplified JSON format
    req.params.id = req.params.id.replace(/[^a-zA-Z0-9_]/g, "");
    const path = "data/" + req.params.id + "/" + req.params.id + ".mpd";
    fs.stat(path, (err, stat) => {
        if(err){
            return res.send({ error: "invalid stream" });
        }
        fs.readFile(path, (err, data) => {
            const str = new String(data, "utf-8");
            xml2js.parseStringPromise(str, { trim: true }).then( (val) => {
                const stream = {};
                val.MPD.Period[0].AdaptationSet.forEach( adaptationSet => {
                    const representation = adaptationSet.Representation[0];
                    const template = representation.SegmentTemplate ? representation.SegmentTemplate[0] : undefined;
                    if(typeof(template) !== "undefined"){
                        const timeline = template.SegmentTimeline[0];
                        const timescale = parseInt(template.$.timescale);
                        stream[representation.$.id]= { 
                            representation: representation.$,
                            template: template.$,
                            timeline: timeline.S.map( stop => {
                                return {
                                    t: parseInt(stop.$.t || "0") / timescale,
                                    d: parseInt(stop.$.d || "0") / timescale,
                                    r: parseInt(stop.$.r || "0")
                                };
                            })
                        };
                    } else {
                        const list = representation.SegmentList[0];
                        const timescale = parseInt(list.$.timescale);
                        const duration = parseInt(list.$.duration) / timescale;
                        const stops = [];
                        //list.SegmentURL.forEach( (segment, index) => {
                            stops.push({
                                t: 0,
                                d: duration,
                                r: list.SegmentURL.length
                            })
                        //});
                        stream[representation.$.id] = {
                            representation: representation.$,
                            template: {
                                media: "chunk-stream$RepresentationID$-$Number%05d$.m4s",
                                initialization: "init-stream$RepresentationID$.m4s",
                                timescale: timescale,
                                duration: duration * timescale,
                                startNumber: 1
                            },
                            timeline: stops
                        }
                    }
                });
                streams[req.params.id] = stream;
                res.setHeader("DHEB", dheParams.B);
                res.setHeader("SID", session);
                res.send(stream);
            });
        });
    });
});

/**
 * MPEG-DASH chunk endpoint
 * 
 * In order to stream audio-video, we need to encrypt chunks
 * with shared key in real-time. Parameter stream is either 0
 * or 1, as we have audio and video and these are sent separately
 */
app.get("/stream/:id/:stream/:chunk", async (req, res) => {
    const id = req.params.id;
    if(!(id in streams)){
        return res.send({ error: "unknown stream" });
    }
    const sessionId = req.headers.sid || false;
    if(!sessionId){
        return res.send({ error: "session missing" });
    }
    if(!(sessionId in sessions)){
        return res.send({ error: "invalid session" });
    }
    const session = sessions[sessionId];
    if(isNaN(parseInt(req.params.stream || "0", 10)) || isNaN(parseInt(req.params.chunk || "0", 10))){
        return res.send({ error: "invalid stream / chunk" });
    }
    const streamId = parseInt(req.params.stream || 0).toString();
    const chunkId = parseInt(req.params.chunk || 0).toString();
    const base = "data/" + id + "/";
    const stream = streams[id];
    if(!(streamId in stream)){
        return res.send({ error: "invalid stream id" });
    }
    const info = streams[id][streamId];
    const representation = info.representation;
    const template = info.template;
    const list = info.list;

    const params = {
        RepresentationID: streamId,
        Number: chunkId
    };

    let pathBase = "", path = "";

    // Find path to video chunk on our storage
    pathBase = chunkId == "0" ? template.initialization : template.media;
    path = base + pathBase.replace(/\$(RepresentationID|Number)(%[0-9]+d)?\$/g, (full, what, padding) => {
        const value = what == "RepresentationID" ? params[what] : (parseInt(params[what]) + parseInt(template.startNumber) - 1).toString();
        let padd = 0;
        if(typeof(padding) == "string" && padding.length > 0){
            padd = parseInt(padding.substr(2, padding.length - 3));
        }
        return (padd - value.length) > 0 ? "0".repeat(padd - value.length) + value : value;
    });


    fs.stat(path, (err, stat) => {
        if(err){
            res.status(404);
            return res.send({ error: "unknown stream", pathBase: pathBase, path: path, base: base});
        }
        const fileSize = stat.size;
        const useAES = req.header("AES") || 0;
        const head = {
            "Content-Type": representation.mimeType,
            "Codecs" : representation.codecs
        };
        res.writeHead(200, head);
        const readable = fs.createReadStream(path);
        const key = session;
        let ctr = 0;

        readable.on("data", (data) => {
            // Encrypt video with shared key
            if(useAES){
                const len = Buffer.alloc(4);
                const iv = crypto.randomBytes(16);
                const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
                const enc = Buffer.concat([cipher.update(data), cipher.final()]);
                const final = Buffer.concat([len, enc, cipher.getAuthTag(), iv])
                final.writeUInt32BE(final.length - 4)
                res.write(final);
            } else {
                for(let i=0; i<data.length; i++, ctr++){
                    data[i] = (data[i] ^ ((key[ctr % key.length] + ctr + parseInt(chunkId) * 3 + parseInt(streamId)) & 0xFF)) & 0xFF;
                }
                res.write(data)
            }
        });

        // If we are finished, mark request as finished
        readable.on("end", () => {
            res.end();
        })
    });
});

app.get("/stream", (req, res) => {
    res.sendFile("www/index.html", { root: __dirname }); 
});

app.use(express.static("www"))

app.listen(9001);