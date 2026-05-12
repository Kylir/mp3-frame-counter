import * as fs from 'fs';
import * as path from 'path';
import {
  hasId3v2Tag,
  readId3v2TagSize,
  isValidMp3Frame,
  readFrameHeader,
  computeFrameSize,
  isInfoFrame,
  analyzeFile,
} from './analyzer';

// A typical MPEG1, Layer III, 128kbps, 44100Hz, Joint stereo, original frame header
const VALID_FRAME_HEADER = Buffer.from([0xFF, 0xFB, 0x90, 0x44]);

function makeId3v2Header(tagBodySize: number): Buffer {
  const buf = Buffer.alloc(10);
  buf[0] = 0x49; buf[1] = 0x44; buf[2] = 0x33; // 'ID3'
  buf[6] = (tagBodySize >>> 21) & 0x7F;
  buf[7] = (tagBodySize >>> 14) & 0x7F;
  buf[8] = (tagBodySize >>>  7) & 0x7F;
  buf[9] = (tagBodySize >>>  0) & 0x7F;
  return buf;
}

// ---------------------------------------------------------------------------

describe('hasId3v2Tag', () => {
  it('returns true when the buffer starts with ID3', () => {
    expect(hasId3v2Tag(Buffer.from([0x49, 0x44, 0x33]))).toBe(true);
  });

  it('returns false when the magic bytes do not match', () => {
    expect(hasId3v2Tag(Buffer.from([0xFF, 0xFB, 0x90]))).toBe(false);
  });

  it('returns false when the buffer is shorter than 3 bytes', () => {
    expect(hasId3v2Tag(Buffer.from([0x49, 0x44]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('readId3v2TagSize', () => {
  it('returns 10 plus the decoded synchsafe body size', () => {
    // body size = (0 << 21) | (0 << 14) | (2 << 7) | 0 = 256 → total = 266
    const buf = makeId3v2Header(256);
    expect(readId3v2TagSize(buf)).toBe(266);
  });

  it('correctly decodes all four synchsafe bytes', () => {
    // body size = (1 << 21) | (1 << 14) | (1 << 7) | 1 = 2113665 → total = 2113675
    const buf = makeId3v2Header(2113665);
    expect(readId3v2TagSize(buf)).toBe(2113675);
  });

  it('throws when the buffer is too small', () => {
    expect(() => readId3v2TagSize(Buffer.alloc(9))).toThrow();
  });

  it('throws when there is no ID3v2 tag', () => {
    expect(() => readId3v2TagSize(Buffer.alloc(10))).toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('isValidMp3Frame', () => {
  it('returns true for a valid sync word', () => {
    expect(isValidMp3Frame(VALID_FRAME_HEADER)).toBe(true);
  });

  it('returns true when the lower bits of byte 1 vary', () => {
    // 0xE0 = minimum valid second byte (top 3 bits set)
    expect(isValidMp3Frame(Buffer.from([0xFF, 0xE0, 0x00, 0x00]))).toBe(true);
  });

  it('returns false when byte 0 is not 0xFF', () => {
    expect(isValidMp3Frame(Buffer.from([0xFE, 0xFB, 0x90, 0x44]))).toBe(false);
  });

  it('returns false when the top 3 bits of byte 1 are not all set', () => {
    expect(isValidMp3Frame(Buffer.from([0xFF, 0xDF, 0x90, 0x44]))).toBe(false);
  });

  it('returns false when the buffer is shorter than 4 bytes', () => {
    expect(isValidMp3Frame(Buffer.from([0xFF, 0xFB, 0x90]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('readFrameHeader', () => {
  it('correctly decodes a known frame header', () => {
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(header.mpegVersion).toBe('MPEG1');
    expect(header.layer).toBe('Layer III');
    expect(header.hasCrc).toBe(false);
    expect(header.bitrate).toBe(128);
    expect(header.sampleRate).toBe(44100);
    expect(header.isPadded).toBe(false);
    expect(header.isPrivate).toBe(false);
    expect(header.channelMode).toBe('Joint stereo');
    expect(header.isCopyrighted).toBe(false);
    expect(header.isOriginal).toBe(true);
    expect(header.emphasis).toBe('None');
  });

  it('detects padding bit', () => {
    // byte 2: 0x92 sets padding bit (bit 9)
    const buf = Buffer.from([0xFF, 0xFB, 0x92, 0x44]);
    expect(readFrameHeader(buf).isPadded).toBe(true);
  });

  it('detects mono channel mode', () => {
    // byte 3: 0xC4 → bits 7-6 = 11 = Mono
    const buf = Buffer.from([0xFF, 0xFB, 0x90, 0xC4]);
    expect(readFrameHeader(buf).channelMode).toBe('Mono');
  });
});

// ---------------------------------------------------------------------------

describe('computeFrameSize', () => {
  it('computes the correct size for 128kbps 44100Hz without padding', () => {
    // floor(144 * 128000 / 44100) = floor(417.959...) = 417
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(computeFrameSize(header)).toBe(417);
  });

  it('adds 1 byte when the padding bit is set', () => {
    const buf = Buffer.from([0xFF, 0xFB, 0x92, 0x44]);
    expect(computeFrameSize(readFrameHeader(buf))).toBe(418);
  });

  it('throws when bitrate is null', () => {
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(() => computeFrameSize({ ...header, bitrate: null })).toThrow();
  });

  it('throws when sampleRate is null', () => {
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(() => computeFrameSize({ ...header, sampleRate: null })).toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('isInfoFrame', () => {
  function makeInfoFrame(tag: string, mono = false): Buffer {
    const offset = mono ? 21 : 36;
    const buf = Buffer.alloc(offset + 4);
    buf.write(tag, offset, 'ascii');
    return buf;
  }

  it('returns true for a Xing tag in a stereo frame', () => {
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(isInfoFrame(makeInfoFrame('Xing'), header)).toBe(true);
  });

  it('returns true for an Info tag in a stereo frame', () => {
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(isInfoFrame(makeInfoFrame('Info'), header)).toBe(true);
  });

  it('returns true for a Xing tag in a mono frame', () => {
    const monoHeader = readFrameHeader(Buffer.from([0xFF, 0xFB, 0x90, 0xC4]));
    expect(isInfoFrame(makeInfoFrame('Xing', true), monoHeader)).toBe(true);
  });

  it('returns false when no Xing/Info tag is present', () => {
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(isInfoFrame(Buffer.alloc(40), header)).toBe(false);
  });

  it('returns false when the buffer is too short', () => {
    const header = readFrameHeader(VALID_FRAME_HEADER);
    expect(isInfoFrame(Buffer.alloc(10), header)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('analyzeFile', () => {
  it('returns the correct frame count for the sample MP3', () => {
    const buffer = fs.readFileSync(path.join(__dirname, '..', 'data', 'sample.mp3'));
    expect(analyzeFile(buffer)).toEqual({ frameCount: 6089 });
  });
});
