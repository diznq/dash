import { sha256 } from "js-sha256";

/**
 * Stream video into container
 * @param {HTMLElement} container 
 * @param {string} streamName 
 * @param {boolean} useAES set to true to enable AES encryption
 */
function StreamVideo(container, streamName, useAES){
    if(useAES){
        if(typeof(window.crypto) == "undefined"
            || typeof(window.crypto.subtle) == "undefined"
            || typeof(window.crypto.subtle.decrypt) == "undefined"){
                console.warn("SubtleCrypto isn't supported, turning AES off");
                useAES = false;
            }
    }
    const canvas = container instanceof HTMLCanvasElement ? container : container.querySelectorAll("canvas")[0];
    const ctx = canvas.getContext("2d");    // Canvas 2D context
    const video = document.createElement("video");  // Even though we use canvas, we still need in-memory only HTML5 video player to get video texture
    const controls = container.querySelectorAll("div.video-controls")[0] || false;
    const videoTimestamp = container.querySelectorAll("div.video-time")[0] || false;
    const videoTotalTime = container.querySelectorAll("div.video-total-time")[0] || false;
    const videoSizer = container.querySelectorAll("div.video-track-sizer")[0] || false;
    const videoLine = container.querySelectorAll("div.video-track-line")[0] || false;
    const videoFullscreen = container.querySelectorAll("div.video-fullscreen")[0] || false;

    const logo = new Image();
    const vignete = new Image();
    vignete.src = "/image/vignete.png";
    logo.src = "/image/logo.png";

    const videoBuffers = [];

    /**
     * Stringify time
     * @param {number} t 
     * @param {boolean?} includeHour 
     */
    function toHumanTime(t, includeHour){
        includeHour = includeHour || false;
        const s = Math.floor(t) % 60;
        const min = Math.floor(t / 60) % 60;
        const hr = Math.floor(t / 3600);
        const strSeconds = s < 10 ? ("0" + s) : s;
        const strMin = min < 10 ? ("0" + min) : min;
        const strHr = hr;
        if(includeHour){
            return `${strHr}:${strMin}:${strSeconds}`;
        }
        return `${strMin}:${strSeconds}`
    }

    /**
     * When meta-data is ready, we can finally display info as total video time
     */
    video.addEventListener("loadedmetadata", function() {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if(videoTotalTime){
            videoTotalTime.textContent = toHumanTime(video.duration, video.duration >= 3600);
        }
    });

    /**
     * As video keeps playing, we need to update interface as well
     */
    video.addEventListener("timeupdate", function(){
        if(videoTimestamp){
            const includeHour = video.duration >= 3600;
            videoTimestamp.textContent = toHumanTime(video.currentTime, includeHour);
        }
        if(videoLine){
            // Create elements that will serve to display buffered parts of video (those gray chunks)
            for(var i = videoBuffers.length; i < video.buffered.length; i++){
                const videoBuffer = document.createElement("div");
                videoBuffer.className = "video-track-buffer";
                videoLine.appendChild(videoBuffer);
                videoBuffers.push(videoBuffer);
            }
            // Set positions and widths of those elements correspondingly
            for(var i=0; i<video.buffered.length; i++){
                const start = video.buffered.start(i);
                const length = video.buffered.end(i) - start;
                const left = 100 * start / video.duration;
                const width = 100 * length / video.duration;
                videoBuffers[i].style.left = left + "%";
                videoBuffers[i].style.width = width + "%"; 
            }
        }
        if(videoSizer){
            // Set width of video progress bar (that yellow line)
            videoSizer.style.width = (100 * video.currentTime / video.duration) + "%";
        }
    });

    if(videoLine){
        // When user clicks on the track line, we need to seek video to that part
        videoLine.addEventListener("click", function(event){
            if(typeof(event.clientX) != "undefined"){
                // Calculate timestamp where user clicked
                const rect = videoLine.getBoundingClientRect();
                const width = rect.width;
                const left = rect.left;
                const posX = event.clientX - left;
                const t = posX / width * video.duration;
                // First pause
                video.pause();
                video.currentTime = t;
                // Then resume (so fetching chunks doesn't go all crazy)
                playVideo();
            }
        });
    }

    let isFullscreen = false, lastEvent = Date.now();

    function toggleFullscreen(){
        if(isFullscreen){
            document.exitFullscreen();
        } else {
            container.requestFullscreen();
        }
    }

    if(videoFullscreen){
        videoFullscreen.addEventListener("click", toggleFullscreen);
    }

    // Add comfort of double clicking on video to toggle fullscreen
    canvas.addEventListener("dblclick", toggleFullscreen);

    // We shall also show controls if user interacted with player or moved mouse
    canvas.addEventListener("mousemove", showControls);
    canvas.addEventListener("mousedown", showControls);
    canvas.addEventListener("touchstart", showControls);

    document.addEventListener("fullscreenchange", function () {
        var fullscreenElement = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
        if (fullscreenElement != null) {
            isFullscreen = true;
        } else {
            isFullscreen = false;             
        }
    });

    let reqeustedFrame = false;

    function showControls(){
        lastEvent = Date.now();
        canvas.style.cursor = "";
        if(controls)
            controls.style.display = "";
    }

    function hideControls(){
        canvas.style.cursor = "none";
        if(controls)
            controls.style.display = "none";
    }

    /**
     * Safely request frame, to make sure we don't request same frame twice
     * @param {() => void} fn callback 
     */
    function safeRequestFrame(fn){
        if(reqeustedFrame) return false;
        requestAnimationFrame( function(){
            reqeustedFrame = false;
            fn();
        });
    }

    /**
     * Update video render
     */
    function onFrame(){
        // If aspect ratio differs, we need to adjust video resolution and position within canvas
        const rect = canvas.getBoundingClientRect();
        const cRatio = rect.width / rect.height;
        const vRatio = canvas.width / canvas.height;
        const size = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        if(vRatio > cRatio){
            const ratio = vRatio / cRatio;
            size.height = canvas.height / ratio;
            size.y = (canvas.height - size.height) / 2;
        } else {
            const ratio = cRatio / vRatio;
            size.width = canvas.width / ratio;
            size.x = (canvas.width - size.width) / 2;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.drawImage(video, size.x, size.y, size.width, size.height);

        // If we already successfuly communicated session
        // we shall render DRM (a.k.a. watermark)
        if(typeof(dheParams.SID) != "undefined" && dheParams.SID){
            // Idea with DRM is simple
            // we split video into 5 second chunks and render a watermark
            // we then get n-th bit of session ID, where n is ID of chunk 
            // currently being played, i.e. in 7th second, it's 2nd chunk
            // and if this bit is 0, watermark is semi-transparent
            // and if this bit is 1, watermark if fully opaque
            const sid = Uint8Array.from(atob(dheParams.SID), c => c.charCodeAt(0));
            const pointer = Math.floor(video.currentTime / 5) % (16 * 8);
            const logoId = (sid[(pointer >> 3) % 16] >> (pointer & 7)) & 1;
            const logoSize = 48;
            const logoPadding = 8;
            let alpha = 0.4;
            if(logoId){
                // To make it less suspicios why transparency level is changing
                // we can apply some smooth transition
                alpha += Math.max(0,Math.sin(2 * 0.2 * Math.PI * video.currentTime)) * (1 - alpha);
            }
            // Optionally we can render slight vignete effect behind watermark
            ctx.drawImage(vignete, canvas.width - logoSize - logoPadding, canvas.height - logoSize - logoPadding, logoSize + logoPadding, logoSize + logoPadding)
            ctx.globalAlpha = alpha;
            // and now we finally draw watermark
            ctx.drawImage(logo, canvas.width - logoSize - logoPadding, canvas.height - logoSize - logoPadding, logoSize, logoSize);
        }

        // In order not to waste resources, we shouldn't render video is player is stopped
        if(!video.paused){
            safeRequestFrame(onFrame);
            if(Date.now() - lastEvent > 2500){
                hideControls();
            }
        } else showControls();
    }

    function playVideo(){
        video.play();
        safeRequestFrame(onFrame);
    }

    canvas.addEventListener("click", () => {
        if(video.paused){
            playVideo();
        } else video.pause();
    });
    
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
    }

    // Well, screw IE which doesn't even support bigint anyways :D
    const dheA = new Uint8Array(2048);
    window.crypto.getRandomValues(dheA);

    const dheParams = {
        p: 25099552766942844933223712235716091924152211550465978680129705202709825360278218096296475379609912444439100980928458239353017482832501866454661094006858424772934884873555199514015711013309014645273730865676502244977060845958886335682411812280653235841465862277254600577554669166523762471112389048884049340166194531521686494178404450414366125027213409901448898349767842311013845893036244352637776318882319722220320245761316160828664005354775978963282315190208049614991040761108728905230322535871785511823330701036582783051238652129305810884107554563790322733394693439028109856194511421092271254974073093909506851549997n,
        g: 3n,
        a: BigInt("0x" + dheA.map( o => o < 16 ? "0" + o.toString(16) : o.toString(16)).join(""))
    };
    dheParams.A = modExp(dheParams.g, dheParams.a, dheParams.p);

    /**
     * Fetch video meta-data
     * @param {string} streamName 
     * @param {*} callback 
     */
    function fetchManifest(streamName, callback){
        var xhr = new XMLHttpRequest();
        const start = Date.now();    
        xhr.onload = () => {
            dheParams.B = BigInt("0x" + xhr.getResponseHeader("DHEB"));
            dheParams.K = modExp(dheParams.B, dheParams.a, dheParams.p);
            dheParams.SID = xhr.getResponseHeader("SID");
            // Calculate shared key, shared key = sha256(B^a mod p)
            dheParams.S = sha256(dheParams.K.toString(16));
            console.log("DHES: ", dheParams.S);
            const helper = [];
            for(let i=0; i<dheParams.S.length; i+=2){
                helper.push(parseInt(dheParams.S.substr(i, 2), 16) & 0xff);
            }
            dheParams.S = new Uint8Array(helper);
            console.log("Session initialization took " + (Date.now() - start) + "ms")
            callback(xhr.response);
        }
        xhr.open("GET", "/stream/"+streamName);
        xhr.responseType = "json";
        // Send our Diffie-Hellman parameters to server
        xhr.setRequestHeader("DHEP", dheParams.p.toString(16));
        xhr.setRequestHeader("DHEG", dheParams.g.toString(16));
        xhr.setRequestHeader("DHEA", dheParams.A.toString(16));
        xhr.send();
    }

    // Fetch video data and create media source with streams
    fetchManifest(streamName, (manifest) => {
        var mediaSource = new MediaSource();
        mediaSource.addEventListener("sourceopen", (event) => {
            let durationSet = false;

            /**
             * Create new stream for given media source
             * @param {*} streamId stream id
             * @param {*} stream stream info
             */
            function AddSource(streamId, stream){
                const representation = stream.representation;
                const timeline = stream.timeline;
                //console.log(stream);
                const mimeCodec = `${representation.mimeType}; codecs="${representation.codecs}"`;
                
                const loadedChunks = {};
                const stops = [];
                const bufferStepSize = 2;
                const bufferSteps = 10;
                let duration = 0;
                let stopCtr = 1;

                // Compute total video duration and pre-calculate stops
                for(let i=0; i < timeline.length; i++){
                    for(let j = 0; j <= timeline[i].r; j++, stopCtr++){
                        stops.push({
                            id: stopCtr, 
                            t: (stops.length == 0 ? 0 : (stops[stops.length - 1].t + stops[stops.length - 1].d)),
                            d: timeline[i].d,
                        });
                        duration += timeline[i].d;
                    }
                }

                // Get ID of chunk for given MPEG-DASH stream
                function getStop(time){
                    for(let i=0; i<stops.length; i++){
                        if(time >= stops[i].t && time < (stops[i].t + stops[i].d)){
                            return stops[i].id;
                        }
                    }
                    return false;
                }

                /**
                 * Decrypt data
                 * @param {*} data 
                 * @param {*} useAES 
                 */
                async function decrypt(data, useAES, chunkId, streamId){
                    async function decryptChunk(view){
                        const key = await crypto.subtle.importKey("raw", dheParams.S, 'AES-GCM' , false, ["encrypt", "decrypt"]);
                        const tag = view.subarray(view.length - 32, view.length - 16);
                        const iv = view.subarray(view.length - 16, view.length);
                        const result = await window.crypto.subtle.decrypt({
                            name: "AES-GCM",
                            iv: iv,
                            tagLength: 128
                        }, key, view.subarray(0, view.length - 16));
                        return new Uint8Array(result);
                    }
                    let results = [], result = null
                    
                    // We can either use AES for decryption or our simplistic XOR stream cipher
                    // The problem with AES is that it is kinda slow so it would be better to
                    // relay that work to separate web workers in next iteration of this project
                    // but that's far ahead future and for now, it works just right for proof
                    // of concept
                    if(useAES){
                        try {
                            let pointer = 0, cycles = 0
                            while(true){
                                const header = data.subarray(pointer, pointer + 4);
                                const length = (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3];    
                                results.push(decryptChunk(data.subarray(pointer + 4, pointer + 4 + length)))
                                pointer += length + 4;
                                cycles++;
                                if(pointer >= data.length) break;
                            }
                            result = new Uint8Array((await Promise.all(results)).reduce((acc, curr) => [...acc, ...curr], []))
                        } catch(ex){
                            console.log("Decrypt failed: ", ex)
                        }
                    } else {
                        const key = dheParams.S;
                        for(let i=0, ctr = 0; i<data.length; i++, ctr++){
                            data[i] = (data[i] ^ ((key[ctr % key.length] + ctr + parseInt(chunkId) * 3 + parseInt(streamId)) & 0xFF)) & 0xFF;
                        }
                        result = data;
                    }
                    return result;
                }

                const activeRequests = {};
                
                // Fetch single chunk into source buffer
                function fetchChunk(sourceBuffer, streamId, chunkId, callback){
                    //console.log("Try ", streamId, chunkId);
                    if(chunkId in activeRequests) return false;
                    if(chunkId in loadedChunks) return false;

                    var xhr = new XMLHttpRequest();
                    xhr.onload = async () => {
                        loadedChunks[chunkId] = true;
                        let view = new Uint8Array(xhr.response);
                        // Once chunk is loaded, we ought to decrypt it with our shared key
                        
                        const decrypted = await decrypt(view, useAES, chunkId, streamId);
                        // Source buffer doesn't really work in an instant
                        // and therefore we must only append new buffer
                        // when previous buffer was successfuly appended.
                        // Therefore we use `finished` variable, which is
                        // true only if source buffer is ready, otherwise
                        // we push video into demand buffer, which will later
                        // be appended to source buffer
                        if(finished){
                            // Set buffer as not ready as we are appending new buffer
                            finished = false;
                            sourceBuffer.appendBuffer(decrypted);
                        } else {
                            demand.push(decrypted);
                        }
                        typeof(callback) == "function" && callback(decrypted);
                    }
                    xhr.open("GET", "/stream/"+streamName+"/"+streamId+"/"+chunkId);
                    xhr.responseType = "arraybuffer";
                    xhr.setRequestHeader("SID", dheParams.SID);
                    if(useAES)
                        xhr.setRequestHeader("AES", "1");
                    activeRequests[chunkId] = true;
                    xhr.send();
                }

                // Fetch chunk for given timestamp
                function fetchChunkTime(sourceBuffer, streamId, time, callback){
                    const chunkId = getStop(time);
                    if(chunkId)
                        fetchChunk(sourceBuffer, streamId, chunkId, callback);
                }

                const demand = [];
                let finished = true;

                var sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
                if(!durationSet){
                    mediaSource.duration = duration;
                    durationSet = true;
                }

                // This even is called when source buffer successfuly finished appending buffer
                sourceBuffer.addEventListener("updateend", function(ev) {
                    finished = true;
                    //console.log("Stream#"+streamId+": Buffer succesfuly added");
                    if(demand.length > 0){
                        const chunk = demand.shift();
                        finished = false;
                        sourceBuffer.appendBuffer(chunk);
                    }
                });

                // Make sure to also catch errors, if any occur
                sourceBuffer.addEventListener("error", function(ev) {
                    console.error("Stream#"+streamId+": Error occured during adding buffer");
                });
                
                // As video keeps playing, we also want to pre-fetch upcoming chunks
                // so that player doesn't lag much
                video.addEventListener("timeupdate", (event) => {
                    fetchChunkTime(sourceBuffer, streamId, video.currentTime);
                    // We buffer bufferSteps * bufferStepSize seconds worth of content in forward
                    for(let i = 0; i < bufferSteps; i++){
                        fetchChunkTime(sourceBuffer, streamId, video.currentTime + (i + 1) * bufferStepSize);
                    }
                });

                // Fetch the very first two chunks
                fetchChunk(sourceBuffer, streamId, 0, () => {
                    fetchChunk(sourceBuffer, streamId, 1);
                });
            }
            // Add all streams that were specified in manifest
            for(let streamId in manifest){
                AddSource(streamId, manifest[streamId]);
            }
        });
        // Assign our media source object to virtual HTML5 video player
        video.src = URL.createObjectURL(mediaSource);
    });
}

// Export our function, so it's publicly accessible from other JavaScript code out there
window.StreamVideo = StreamVideo;