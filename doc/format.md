# MP3 File Format

## Top-level structure

```
[ ID3v2 tag ]        ← optional, at the very start
[ Frame 1 ]
[ Frame 2 ]
[ Frame N ]
...
[ ID3v1 tag ]        ← optional, last 128 bytes of the file
```

## ID3v2 tag (header metadata)

- Starts with the 3-byte magic: `ID3`
- Contains title, artist, album, cover art, etc.
- Variable length — you must parse its header to know how many bytes to skip before the first audio frame

## Audio frame structure

Each frame has two parts:

### Frame header (4 bytes)

```
Bits 31–21  Sync word              All 1s (0xFFE or 0xFFF)
Bits 20–19  MPEG version           e.g. MPEG-1, MPEG-2
Bits 18–17  Layer                  e.g. Layer III = MP3
Bit  16     Protection             CRC present or not
Bits 15–12  Bitrate index          lookup table → kbps
Bits 11–10  Sample rate index      lookup table → Hz
Bit  9      Padding                frame is 1 byte larger
Bit  8      Private bit
Bits 7–6    Channel mode           stereo, joint stereo, mono
Bits 5–4    Mode extension         used with joint stereo
Bit  3      Copyright
Bit  2      Original
Bits 1–0    Emphasis
```

### Frame data (variable length)

Follows immediately after the 4-byte header (plus 2-byte CRC if the protection bit is set).

Length is calculated from the bitrate and sample rate in the header:

```
frame_size = floor(144 × bitrate / sample_rate) + padding
```

## ID3v1 tag (footer metadata)

- Exactly 128 bytes at the end of the file
- Starts with the 3-byte magic: `TAG`
- Fixed-length fields for title, artist, album, year, comment, genre

## Summary: parsing flow

1. Skip ID3v2 tag if present (check for `ID3` at byte 0)
2. Scan for the sync word (`0xFF` followed by `0xE0` or higher) to find the first frame
3. Parse the 4-byte header to get bitrate, sample rate, padding
4. Calculate frame length, jump to the next frame, repeat
5. Stop when you hit `TAG` (ID3v1) or the end of the buffer
