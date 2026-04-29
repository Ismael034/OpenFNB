import type { DeviceProfile, Measurement } from "../types";

export const SUPPORTED_PROFILES: DeviceProfile[] = [
  {
    key: "fnb48",
    label: "FNB48",
    vendorId: 0x0483,
    productId: 0x003a,
    startupCommands: [0x81, 0x82, 0x83],
    keepaliveCommand: 0x83,
    keepaliveIntervalMs: 3,
    sampleRateHz: 100
  },
  {
    key: "c1",
    label: "C1",
    vendorId: 0x0483,
    productId: 0x003b,
    startupCommands: [0x81, 0x82, 0x83],
    keepaliveCommand: 0x83,
    keepaliveIntervalMs: 3,
    sampleRateHz: 100
  },
  {
    key: "fnb58",
    label: "FNB58",
    vendorId: 0x2e3c,
    productId: 0x5558,
    startupCommands: [0x81, 0x82, 0x82],
    keepaliveCommand: 0x83,
    keepaliveIntervalMs: 1000,
    sampleRateHz: 100
  },
  {
    key: "fnb48s",
    label: "FNB48S",
    vendorId: 0x2e3c,
    productId: 0x0049,
    startupCommands: [0x81, 0x82, 0x82],
    keepaliveCommand: 0x83,
    keepaliveIntervalMs: 1000,
    sampleRateHz: 100
  }
];

export type DecoderState = {
  energyWs: number;
  capacityAs: number;
  tempEmaC: number | null;
  alpha: number;
  sampleRateHz: number;
};

export function createDecoderState(alpha = 0.9, sampleRateHz = 100): DecoderState {
  return {
    energyWs: 0,
    capacityAs: 0,
    tempEmaC: null,
    alpha,
    sampleRateHz
  };
}

export function crc8(payload: Uint8Array): number {
  let crc = 0x42;

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

export function buildCommandPacket(command: number): Uint8Array {
  const report = new Uint8Array(64);
  report[0] = 0xaa;
  report[1] = command;
  report[63] = crc8(report.slice(1, 63));
  return report;
}

export function findProfile(vendorId: number, productId: number): DeviceProfile | undefined {
  return SUPPORTED_PROFILES.find((profile) => profile.vendorId === vendorId && profile.productId === productId);
}

export function decodeDataReport(
  report: Uint8Array,
  state: DecoderState,
  receivedAtMs = Date.now(),
  validateCrc = true
): Measurement[] {
  if (report.length !== 64) {
    return [];
  }

  if (report[0] !== 0xaa || report[1] !== 0x04) {
    return [];
  }

  if (validateCrc) {
    const expected = crc8(report.slice(1, 63));
    if (expected !== report[63]) {
      throw new Error(`CRC mismatch: expected 0x${expected.toString(16)}, got 0x${report[63].toString(16)}`);
    }
  }

  const intervalMs = 1000 / state.sampleRateHz;
  const startTimestampMs = receivedAtMs - intervalMs * 4;
  const measurements: Measurement[] = [];

  for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
    const offset = 2 + sampleIndex * 15;

    const voltage = readU32(report, offset) / 100000;
    const current = readU32(report, offset + 4) / 100000;
    const dp = readU16(report, offset + 8) / 1000;
    const dn = readU16(report, offset + 10) / 1000;
    const temperatureC = readU16(report, offset + 13) / 10;
    const power = voltage * current;

    state.tempEmaC =
      state.tempEmaC === null ? temperatureC : temperatureC * (1 - state.alpha) + state.tempEmaC * state.alpha;
    state.energyWs += power / state.sampleRateHz;
    state.capacityAs += current / state.sampleRateHz;

    measurements.push({
      timestampMs: startTimestampMs + intervalMs * sampleIndex,
      sampleIndex,
      voltage,
      current,
      power,
      dp,
      dn,
      temperatureC,
      temperatureEmaC: state.tempEmaC,
      energyWs: state.energyWs,
      capacityAs: state.capacityAs
    });
  }

  return measurements;
}

function readU16(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readU32(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0;
}
