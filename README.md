# Simple Node.js Dash streaming server & client

## Features
### Server to canvas encryption
Streamed video is encrypted, so only client JavaScript can decrypt it, therefore heading directly to `GET /stream/:name/:stream/:chunk` will not provide any useful data, making video downloads impossible.

### WebGL player
In addition to server-to-canvas encryption, video is played inside WebGL canvas, giving you option to draw additional watermarks or other DRM features while making it impossible to directly save video

## How to use
### Server

1. Encode MP4 video into dash format using `encode.bat videoName` or `encode.sh videoName` (**without .mp4 extension**)
2. Run server using `node index.js`
3. Connect `http://localhost:9001/stream#videoName`

### Client

1. Use `index.html` as template
2. Call `StreamVideo(containerElement, streamName)` to stream video into canvas in given container (streamName must be without `.mpd`)