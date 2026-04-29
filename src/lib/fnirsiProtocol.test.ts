import { describe, expect, it } from "vitest";
import { buildCommandPacket, createDecoderState, crc8, decodeDataReport } from "./fnirsiProtocol";

describe("fnirsiProtocol", () => {
  it("builds known command packets with expected CRC bytes", () => {
    expect(buildCommandPacket(0x81)[63]).toBe(0x8e);
    expect(buildCommandPacket(0x82)[63]).toBe(0x96);
    expect(buildCommandPacket(0x83)[63]).toBe(0x9e);
  });

  it("decodes a full four-sample data report", () => {
    const packet = new Uint8Array(64);
    packet[0] = 0xaa;
    packet[1] = 0x04;

    const samples = [
      { voltage: 5.12, current: 1.25, dp: 0.62, dn: 0.44, temp: 31.4 },
      { voltage: 5.15, current: 1.28, dp: 0.63, dn: 0.45, temp: 31.5 },
      { voltage: 5.2, current: 1.3, dp: 0.64, dn: 0.46, temp: 31.6 },
      { voltage: 5.21, current: 1.33, dp: 0.65, dn: 0.47, temp: 31.8 }
    ];

    samples.forEach((sample, sampleIndex) => {
      const offset = 2 + sampleIndex * 15;
      writeU32(packet, offset, Math.round(sample.voltage * 100000));
      writeU32(packet, offset + 4, Math.round(sample.current * 100000));
      writeU16(packet, offset + 8, Math.round(sample.dp * 1000));
      writeU16(packet, offset + 10, Math.round(sample.dn * 1000));
      packet[offset + 12] = 0x01;
      writeU16(packet, offset + 13, Math.round(sample.temp * 10));
    });

    packet[63] = crc8(packet.slice(1, 63));
    const decoded = decodeDataReport(packet, createDecoderState(0.9, 100), 10_000, true);

    expect(decoded).toHaveLength(4);
    expect(decoded[0].voltage).toBeCloseTo(5.12, 5);
    expect(decoded[1].current).toBeCloseTo(1.28, 5);
    expect(decoded[2].dp).toBeCloseTo(0.64, 3);
    expect(decoded[3].dn).toBeCloseTo(0.47, 3);
    expect(decoded[3].temperatureEmaC).toBeGreaterThan(31.4);
    expect(decoded[3].power).toBeCloseTo(5.21 * 1.33, 5);
    expect(decoded[3].energyWs).toBeGreaterThan(decoded[0].energyWs);
  });
});

function writeU16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}
