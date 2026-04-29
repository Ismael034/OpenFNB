import { describe, expect, it } from "vitest";
import {
  buildFirmwareDataPacket,
  buildFirmwarePacket,
  buildFirmwareRestartPacket,
  buildStartUpdatePacket,
  createFirmwareChunks,
  createFirmwareTransferPlan,
  crc8Dfu,
  extractFirmwareVersionCode,
  FALLBACK_FIRMWARE_VERSION_CODE,
  FIRMWARE_PACKET_PAYLOAD_SIZE,
  FIRMWARE_PACKET_SIZE
} from "./firmwareUpgrade";

describe("firmwareUpgrade", () => {
  it("uses the bootloader CRC-8 variant", () => {
    const packet = buildFirmwarePacket(0x28, 6, new Uint8Array([0x44, 0x00, 0x34, 0x12, 0x00, 0x00]));

    expect(packet).toHaveLength(FIRMWARE_PACKET_SIZE);
    expect(packet[63]).toBe(crc8Dfu(packet.subarray(0, 63)));
    expect(packet[63]).toBe(0x4e);
  });

  it("builds the start update packet with version and image size", () => {
    const packet = buildStartUpdatePacket(111, 0x1234);

    expect(Array.from(packet.subarray(0, 11))).toEqual([
      0x28,
      0x06,
      0x00,
      0x00,
      0x00,
      0x6f,
      0x00,
      0x34,
      0x12,
      0x00,
      0x00
    ]);
  });

  it("extracts decimal firmware versions from file names", () => {
    expect(extractFirmwareVersionCode("FNB58_V1.11.ufn")).toBe(111);
    expect(extractFirmwareVersionCode("FNB58 firmware 1.11.ufn")).toBe(111);
    expect(extractFirmwareVersionCode("FNIRSI FNB-58 V1.2.unf")).toBe(120);
    expect(extractFirmwareVersionCode("release-v0.07.ufn")).toBe(7);
    expect(extractFirmwareVersionCode("firmware.ufn")).toBe(FALLBACK_FIRMWARE_VERSION_CODE);
  });

  it("builds one-based wrapped chunk addresses", () => {
    const first = buildFirmwareDataPacket(0, new Uint8Array([1, 2, 3]));
    const wrapped = buildFirmwareDataPacket(49, new Uint8Array([4, 5, 6]));
    const next = buildFirmwareDataPacket(50, new Uint8Array([7, 8, 9]));

    expect(Array.from(first.subarray(0, 5))).toEqual([0x2b, 0x3a, 0x01, 0x00, 0x01]);
    expect(Array.from(wrapped.subarray(0, 5))).toEqual([0x2b, 0x3a, 0x00, 0x00, 0x32]);
    expect(Array.from(next.subarray(0, 5))).toEqual([0x2b, 0x3a, 0x01, 0x00, 0x33]);
  });

  it("builds the captured restart packet", () => {
    const packet = buildFirmwareRestartPacket(6713);

    expect(toHex(packet)).toBe(
      "2b060e1a3a28dd59b62c450000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000054"
    );
  });

  it("keeps the restart trailer out of normal firmware data packets", () => {
    const trailer = new Uint8Array([0x28, 0xdd, 0x59, 0xb6, 0x2c, 0x45]);
    const firmware = new Uint8Array(FIRMWARE_PACKET_PAYLOAD_SIZE + trailer.byteLength);
    firmware.fill(0xaa, 0, FIRMWARE_PACKET_PAYLOAD_SIZE);
    firmware.set(trailer, FIRMWARE_PACKET_PAYLOAD_SIZE);

    const transfer = createFirmwareTransferPlan(firmware);

    expect(transfer.uploadBytes).toHaveLength(FIRMWARE_PACKET_PAYLOAD_SIZE);
    expect(transfer.chunks).toHaveLength(1);
    expect(Array.from(transfer.restartPayload)).toEqual(Array.from(trailer));
    expect(toHex(buildFirmwareRestartPacket(transfer.chunks.length, transfer.restartPayload)).startsWith("2b06020002")).toBe(true);
  });

  it("splits firmware into 58-byte packets", () => {
    const firmware = new Uint8Array(FIRMWARE_PACKET_PAYLOAD_SIZE * 2 + 3).map((_, index) => index);
    const chunks = createFirmwareChunks(firmware);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].offset).toBe(0);
    expect(chunks[1].offset).toBe(FIRMWARE_PACKET_PAYLOAD_SIZE);
    expect(chunks[2].data).toHaveLength(3);
  });
});

function toHex(bytes: Uint8Array<ArrayBufferLike>) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
