export interface AnalysisResult {
  frameCount: number;
}

// Returns true if the buffer starts with the ID3v2 magic bytes ('ID3').
export function hasId3v2Tag(buffer: Buffer): boolean {
  return buffer.length >= 3 &&
    buffer[0] === 0x49 && // 'I'
    buffer[1] === 0x44 && // 'D'
    buffer[2] === 0x33;   // '3'
}

// Parses the 10-byte ID3v2 header and returns the total tag size in bytes (header included).
// The size field is encoded as a 28-bit synchsafe integer spread across bytes 6–9.
export function readId3v2TagSize(buffer: Buffer): number {
  if (buffer.length < 10) throw new Error('Buffer too small to contain an ID3v2 header');
  if (!hasId3v2Tag(buffer)) throw new Error('No ID3v2 tag found');

  return 10 + (
    ((buffer[6] & 0x7F) << 21) |
    ((buffer[7] & 0x7F) << 14) |
    ((buffer[8] & 0x7F) <<  7) |
     (buffer[9] & 0x7F)
  );
}

// Returns true if the buffer starts with a valid MP3 sync word (11 consecutive set bits).
export function isValidMp3Frame(buffer: Buffer): boolean {
  return buffer.length >= 4 &&
    buffer[0] === 0xFF &&
    (buffer[1] & 0xE0) === 0xE0;
}

export interface FrameHeader {
  mpegVersion: 'MPEG1' | 'MPEG2' | 'MPEG2.5' | 'reserved';
  layer: 'Layer I' | 'Layer II' | 'Layer III' | 'reserved';
  hasCrc: boolean;
  bitrate: number | null;
  sampleRate: number | null;
  isPadded: boolean;
  isPrivate: boolean;
  channelMode: 'Stereo' | 'Joint stereo' | 'Dual channel' | 'Mono';
  modeExtension: number;
  isCopyrighted: boolean;
  isOriginal: boolean;
  emphasis: 'None' | '50/15ms' | 'CCIT J.17' | 'reserved';
}

const MPEG_VERSIONS = ['MPEG2.5', 'reserved', 'MPEG2', 'MPEG1'] as const;

const LAYERS = ['reserved', 'Layer III', 'Layer II', 'Layer I'] as const;

// MPEG1, Layer III bitrate table, kbps (null = free/bad)
const BITRATE_TABLE: (number | null)[] =
  [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null];

// MPEG1 sample rate table, Hz (null = reserved)
const SAMPLE_RATE_TABLE: (number | null)[] = [44100, 48000, 32000, null];

const CHANNEL_MODES = ['Stereo', 'Joint stereo', 'Dual channel', 'Mono'] as const;

const EMPHASIS = ['None', '50/15ms', 'reserved', 'CCIT J.17'] as const;

// Decodes the 4-byte MP3 frame header into a structured object with all fields mapped via lookup tables.
export function readFrameHeader(buffer: Buffer): FrameHeader {
  const header = buffer.readUInt32BE(0);

  const versionBits   = (header >>> 19) & 0x03;
  const layerBits     = (header >>> 17) & 0x03;
  const protectionBit = (header >>> 16) & 0x01;
  const bitrateIdx    = (header >>> 12) & 0x0F;
  const sampleRateIdx = (header >>> 10) & 0x03;
  const paddingBit    = (header >>>  9) & 0x01;
  const privateBit    = (header >>>  8) & 0x01;
  const channelMode   = (header >>>  6) & 0x03;
  const modeExt       = (header >>>  4) & 0x03;
  const copyright     = (header >>>  3) & 0x01;
  const original      = (header >>>  2) & 0x01;
  const emphasisBits  = (header >>>  0) & 0x03;

  return {
    mpegVersion:   MPEG_VERSIONS[versionBits],
    layer:         LAYERS[layerBits],
    hasCrc:        protectionBit === 0,
    bitrate:       BITRATE_TABLE[bitrateIdx] ?? null,
    sampleRate:    SAMPLE_RATE_TABLE[sampleRateIdx] ?? null,
    isPadded:      paddingBit === 1,
    isPrivate:     privateBit === 1,
    channelMode:   CHANNEL_MODES[channelMode],
    modeExtension: modeExt,
    isCopyrighted: copyright === 1,
    isOriginal:    original === 1,
    emphasis:      EMPHASIS[emphasisBits],
  };
}

// Computes the total byte length of a frame using: floor(144 × bitrate_bps / sample_rate) + padding.
export function computeFrameSize(header: FrameHeader): number {
  if (header.bitrate === null || header.sampleRate === null)
    throw new Error('Cannot compute frame size: invalid bitrate or sample rate');

  return Math.floor(144 * (header.bitrate * 1000) / header.sampleRate) + (header.isPadded ? 1 : 0);
}

// Returns true if the frame contains a Xing/Info metadata header rather than audio data.
// These frames must be skipped and not counted toward the final frame total.
export function isInfoFrame(buffer: Buffer, header: FrameHeader): boolean {
  const offset = header.channelMode === 'Mono' ? 21 : 36;
  if (buffer.length < offset + 4) return false;
  const tag = buffer.toString('ascii', offset, offset + 4);
  return tag === 'Xing' || tag === 'Info';
}

// Counts the audio frames in an MP3 buffer, skipping any ID3v2 tag and Xing/Info metadata frames.
export function analyzeFile(buffer: Buffer): AnalysisResult {
  let offset = hasId3v2Tag(buffer) ? readId3v2TagSize(buffer) : 0;
  let frameCount = 0;

  while (offset < buffer.length) {
    const slice = buffer.subarray(offset);

    if (!isValidMp3Frame(slice)) break;

    const header = readFrameHeader(slice);
    const frameSize = computeFrameSize(header);

    if (!isInfoFrame(slice, header)) frameCount++;
    offset += frameSize;
  }

  return { frameCount };
}
