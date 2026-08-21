export const EXPECTED_BACKGROUND_WIDTH = 2560;
export const EXPECTED_BACKGROUND_HEIGHT = 1440;

export function readWebPDimensions(buffer) {
  if (buffer.length < 30 || buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("not a RIFF WebP file");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) throw new Error(`truncated ${type} chunk`);
    if (type === "VP8X") {
      if (size < 10) throw new Error("invalid VP8X chunk");
      return {
        width: 1 + buffer.readUIntLE(data + 4, 3),
        height: 1 + buffer.readUIntLE(data + 7, 3)
      };
    }
    if (type === "VP8 ") {
      if (size < 10 || buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) throw new Error("invalid VP8 frame");
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff
      };
    }
    if (type === "VP8L") {
      if (size < 5 || buffer[data] !== 0x2f) throw new Error("invalid VP8L frame");
      const bits = buffer.readUInt32LE(data + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff)
      };
    }
    offset = data + size + (size & 1);
  }
  throw new Error("missing WebP image chunk");
}

export function hasWebPAlpha(buffer) {
  if (buffer.length < 20 || buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") {
    return false;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) return false;
    if (type === "VP8X" && size >= 10 && (buffer[data] & 0x10)) return true;
    if (type === "ALPH") return true;
    if (type === "VP8L" && size >= 5 && buffer[data] === 0x2f) {
      return Boolean(buffer.readUInt32LE(data + 1) & 0x10000000);
    }
    offset = data + size + (size & 1);
  }
  return false;
}

export function assertBackgroundDimensions(buffer) {
  const size = readWebPDimensions(buffer);
  if (size.width !== EXPECTED_BACKGROUND_WIDTH || size.height !== EXPECTED_BACKGROUND_HEIGHT) {
    throw new Error(`Expected ${EXPECTED_BACKGROUND_WIDTH}x${EXPECTED_BACKGROUND_HEIGHT} WebP, got ${size.width}x${size.height}`);
  }
  return size;
}
