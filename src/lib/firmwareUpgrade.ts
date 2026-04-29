export type FirmwareBootloaderProfile = {
  label: string;
  vendorId: number;
  productId: number;
};

type FirmwareBytes = Uint8Array<ArrayBufferLike>;

export type FirmwareChunk = {
  index: number;
  offset: number;
  data: FirmwareBytes;
  packet: FirmwareBytes;
};

export type FirmwareTransferPlan = {
  chunks: FirmwareChunk[];
  restartPayload: FirmwareBytes;
  uploadBytes: FirmwareBytes;
};

export const FNB58_BOOTLOADER_PROFILE: FirmwareBootloaderProfile = {
  label: "FNB58 bootloader",
  vendorId: 0x0483,
  productId: 0x0038
};

export const FIRMWARE_PACKET_SIZE = 64;
export const FIRMWARE_PACKET_PAYLOAD_SIZE = 58;
export const FALLBACK_FIRMWARE_VERSION_CODE = 0;

const START_UPDATE_ENDPOINT = 0x28;
const WRITE_DATA_ENDPOINT = 0x2b;
const RESTART_PAYLOAD = new Uint8Array([0x28, 0xdd, 0x59, 0xb6, 0x2c, 0x45]);

export function crc8Dfu(payload: FirmwareBytes): number {
  let crc = 0x00;

  for (const byte of payload) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ 0x39) & 0xff;
      } else {
        crc = (crc << 1) & 0xff;
      }
    }
  }

  return crc;
}

export function buildFirmwarePacket(endpoint: number, parameter: number, payload: FirmwareBytes = new Uint8Array()): FirmwareBytes {
  const packet = new Uint8Array(FIRMWARE_PACKET_SIZE);
  const writeLength = Math.min(payload.byteLength, FIRMWARE_PACKET_PAYLOAD_SIZE);

  packet[0] = endpoint & 0xff;
  writeU32Le(packet, 1, parameter >>> 0);
  packet.set(payload.subarray(0, writeLength), 5);
  packet[FIRMWARE_PACKET_SIZE - 1] = crc8Dfu(packet.subarray(0, FIRMWARE_PACKET_SIZE - 1));

  return packet;
}

export function buildStartUpdatePacket(firmwareVersionCode: number, firmwareSize: number): FirmwareBytes {
  if (!Number.isInteger(firmwareVersionCode) || firmwareVersionCode < 0 || firmwareVersionCode > 0xffff) {
    throw new Error("Firmware version code must be an unsigned 16-bit integer.");
  }

  if (!Number.isInteger(firmwareSize) || firmwareSize <= 0 || firmwareSize > 0xffffffff) {
    throw new Error("Firmware size must fit in an unsigned 32-bit integer.");
  }

  const payload = new Uint8Array(6);
  writeU16Le(payload, 0, firmwareVersionCode);
  writeU32Le(payload, 2, firmwareSize);
  return buildFirmwarePacket(START_UPDATE_ENDPOINT, payload.byteLength, payload);
}

export function extractFirmwareVersionCode(fileName: string): number {
  const match =
    /(?:^|[^a-z0-9])v\s*([0-9]+(?:\.[0-9]+)?)/i.exec(fileName) ??
    /(?:^|[^0-9])([0-9]+\.[0-9]+)(?=[^0-9]|$)/.exec(fileName);
  if (!match) {
    return FALLBACK_FIRMWARE_VERSION_CODE;
  }

  const [majorText, minorText = "0"] = match[1].split(".");
  const major = Number(majorText);
  const minor = Number(minorText.padEnd(2, "0").slice(0, 2));
  const versionCode = major * 100 + minor;
  if (!Number.isInteger(versionCode) || versionCode < 0 || versionCode > 0xffff) {
    return FALLBACK_FIRMWARE_VERSION_CODE;
  }

  return versionCode;
}

export function buildFirmwareDataPacket(chunkIndex: number, payload: FirmwareBytes): FirmwareBytes {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error("Chunk index must be a non-negative integer.");
  }

  if (payload.byteLength === 0 || payload.byteLength > FIRMWARE_PACKET_PAYLOAD_SIZE) {
    throw new Error(`Firmware chunks must contain 1-${FIRMWARE_PACKET_PAYLOAD_SIZE} bytes.`);
  }

  return buildFirmwarePacket(WRITE_DATA_ENDPOINT, buildFirmwareChunkParameter(chunkIndex), payload);
}

export function buildFirmwareRestartPacket(nextChunkIndex: number, payload: FirmwareBytes = RESTART_PAYLOAD): FirmwareBytes {
  if (!Number.isInteger(nextChunkIndex) || nextChunkIndex < 0) {
    throw new Error("Next chunk index must be a non-negative integer.");
  }

  if (payload.byteLength === 0 || payload.byteLength > FIRMWARE_PACKET_PAYLOAD_SIZE) {
    throw new Error(`Restart payload must contain 1-${FIRMWARE_PACKET_PAYLOAD_SIZE} bytes.`);
  }

  const nextChunkParameter = buildFirmwareChunkParameter(nextChunkIndex);
  const restartParameter = ((nextChunkParameter & 0xffffff00) | payload.byteLength) >>> 0;
  return buildFirmwarePacket(WRITE_DATA_ENDPOINT, restartParameter, payload);
}

export function createFirmwareChunks(firmware: FirmwareBytes): FirmwareChunk[] {
  const chunks: FirmwareChunk[] = [];

  for (let offset = 0; offset < firmware.byteLength; offset += FIRMWARE_PACKET_PAYLOAD_SIZE) {
    const index = chunks.length;
    const data = firmware.subarray(offset, Math.min(offset + FIRMWARE_PACKET_PAYLOAD_SIZE, firmware.byteLength));
    chunks.push({
      index,
      offset,
      data,
      packet: buildFirmwareDataPacket(index, data)
    });
  }

  return chunks;
}

export function createFirmwareTransferPlan(firmware: FirmwareBytes): FirmwareTransferPlan {
  const hasRestartTrailer =
    firmware.byteLength > RESTART_PAYLOAD.byteLength &&
    endsWithBytes(firmware, RESTART_PAYLOAD);
  const restartPayload = hasRestartTrailer
    ? firmware.subarray(firmware.byteLength - RESTART_PAYLOAD.byteLength)
    : RESTART_PAYLOAD;
  const uploadBytes = hasRestartTrailer
    ? firmware.subarray(0, firmware.byteLength - RESTART_PAYLOAD.byteLength)
    : firmware;

  return {
    chunks: createFirmwareChunks(uploadBytes),
    restartPayload,
    uploadBytes
  };
}

function buildFirmwareChunkParameter(chunkIndex: number): number {
  const oneBasedIndex = chunkIndex + 1;
  const lowByte = oneBasedIndex & 0xff;
  const highByte = (oneBasedIndex >> 8) & 0xff;
  return (0x3a | ((oneBasedIndex % 0x32) << 8) | (highByte << 16) | (lowByte << 24)) >>> 0;
}

function endsWithBytes(bytes: FirmwareBytes, suffix: FirmwareBytes): boolean {
  if (bytes.byteLength < suffix.byteLength) {
    return false;
  }

  const offset = bytes.byteLength - suffix.byteLength;
  for (let index = 0; index < suffix.byteLength; index += 1) {
    if (bytes[offset + index] !== suffix[index]) {
      return false;
    }
  }

  return true;
}

function writeU16Le(buffer: FirmwareBytes, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

function writeU32Le(buffer: FirmwareBytes, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}
