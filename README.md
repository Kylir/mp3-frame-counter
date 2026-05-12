# MP3 Frame Counter

A TypeScript/Node.js HTTP service that accepts an MP3 file upload, counts its audio frames, and returns the result as JSON.

For a detailed breakdown of the MP3 binary format, see [doc/format.md](doc/format.md).

---

## Installation

```bash
npm install
```

## Start the server

```bash
npm run build
npm start
```

The server listens on port 3000 by default. Set the `PORT` environment variable to override.

---

## Usage

Send a `multipart/form-data` POST request with the MP3 file in the `file` field:

```bash
curl -X POST -F "file=@data/sample.mp3" http://localhost:3000/file-upload
```

Example response:

```json
{ "frameCount": 6089 }
```

---

## Analyzer functions

All parsing logic lives in `src/analyzer.ts`.

### `hasId3v2Tag(buffer)`
Checks whether the file starts with an ID3v2 metadata tag by looking for the `ID3` magic bytes at offset 0.

### `readId3v2TagSize(buffer)`
Parses the 10-byte ID3v2 header and returns the total size of the tag in bytes (header included). The size field uses a synchsafe integer encoding where only the lower 7 bits of each byte are used.

### `isValidMp3Frame(buffer)`
Returns `true` if the buffer starts with a valid MP3 sync word — 11 consecutive set bits (`0xFF` followed by a byte with the top 3 bits set).

### `readFrameHeader(buffer)`
Reads the 4-byte MP3 frame header and returns a `FrameHeader` object with all fields decoded: MPEG version, layer, bitrate, sample rate, channel mode, padding flag, and more.

### `computeFrameSize(header)`
Computes the total byte length of a frame using the standard formula:

```
floor(144 × bitrate_bps / sample_rate) + padding
```

### `isInfoFrame(buffer, header)`
Detects whether a frame is a Xing/Info metadata frame rather than an audio frame. These are valid MP3 frames that encode VBR/CBR metadata and should not be counted. The tag identifier sits at byte offset 36 (stereo) or 21 (mono) within the frame.

### `analyzeFile(buffer)`
Orchestrates the full analysis: skips the ID3v2 tag if present, then walks frame by frame counting only audio frames, and returns `{ frameCount }`.
