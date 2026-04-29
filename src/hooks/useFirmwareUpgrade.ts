import { useCallback, useState } from "react";
import {
  buildFirmwareRestartPacket,
  buildStartUpdatePacket,
  createFirmwareTransferPlan,
  extractFirmwareVersionCode,
  FNB58_BOOTLOADER_PROFILE,
} from "../lib/firmwareUpgrade";

export type FirmwareUpgradePhase = "idle" | "reading" | "selecting" | "erasing" | "uploading" | "done" | "error";

export type FirmwareUpgradeState = {
  bytesWritten: number;
  chunksWritten: number;
  deviceName: string | null;
  error: string | null;
  fileName: string | null;
  message: string;
  phase: FirmwareUpgradePhase;
  progress: number;
  totalBytes: number;
  totalChunks: number;
};

type FirmwareUpgradeOptions = {
  device?: HIDDevice;
};

type UseFirmwareUpgradeResult = {
  firmwareUpgrade: FirmwareUpgradeState;
  hidSupported: boolean;
  resetFirmwareUpgrade: () => void;
  startFirmwareUpgrade: (file: File, options?: FirmwareUpgradeOptions) => Promise<void>;
};

const ERASE_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 30_000;
const RESTART_SETTLE_MS = 2_000;

const IDLE_STATE: FirmwareUpgradeState = {
  bytesWritten: 0,
  chunksWritten: 0,
  deviceName: null,
  error: null,
  fileName: null,
  message: "Select a firmware file to begin.",
  phase: "idle",
  progress: 0,
  totalBytes: 0,
  totalChunks: 0
};

export function useFirmwareUpgrade(): UseFirmwareUpgradeResult {
  const hidSupported = typeof navigator !== "undefined" && typeof navigator.hid !== "undefined";
  const [firmwareUpgrade, setFirmwareUpgrade] = useState<FirmwareUpgradeState>(IDLE_STATE);

  const resetFirmwareUpgrade = useCallback(() => {
    setFirmwareUpgrade(IDLE_STATE);
  }, []);

  const startFirmwareUpgrade = useCallback(
    async (file: File, options: FirmwareUpgradeOptions = {}) => {
      if (!hidSupported) {
        setFirmwareUpgrade({
          ...IDLE_STATE,
          error: "Use Chrome or Edge on HTTPS or localhost to access WebHID devices.",
          message: "WebHID is unavailable.",
          phase: "error"
        });
        return;
      }

      setFirmwareUpgrade({
        ...IDLE_STATE,
        fileName: file.name,
        message: "Reading firmware file...",
        phase: "reading"
      });

      let device: HIDDevice | null = null;

      try {
        const firmware = new Uint8Array(await file.arrayBuffer());
        if (firmware.byteLength === 0) {
          throw new Error("The selected firmware file is empty.");
        }

        const transfer = createFirmwareTransferPlan(firmware);
        const chunks = transfer.chunks;
        setFirmwareUpgrade((current) => ({
          ...current,
          message: options.device ? "Opening bootloader device..." : `Select the ${FNB58_BOOTLOADER_PROFILE.label} device.`,
          phase: options.device ? "erasing" : "selecting",
          totalBytes: firmware.byteLength,
          totalChunks: chunks.length
        }));

        if (options.device) {
          device = options.device;
        } else {
          const selectedDevices = await navigator.hid!.requestDevice({
            filters: [
              {
                vendorId: FNB58_BOOTLOADER_PROFILE.vendorId,
                productId: FNB58_BOOTLOADER_PROFILE.productId
              }
            ]
          });
          device = selectedDevices[0] ?? null;
        }

        if (!device) {
          setFirmwareUpgrade(IDLE_STATE);
          return;
        }

        if (!device.opened) {
          await device.open();
        }

        setFirmwareUpgrade((current) => ({
          ...current,
          deviceName: device?.productName || FNB58_BOOTLOADER_PROFILE.label,
          message: "Erasing flash...",
          phase: "erasing"
        }));

        await writePacketAndWait(
          device,
          buildStartUpdatePacket(extractFirmwareVersionCode(file.name), firmware.byteLength),
          ERASE_TIMEOUT_MS
        );

        for (const chunk of chunks) {
          setFirmwareUpgrade((current) => ({
            ...current,
            bytesWritten: chunk.offset,
            chunksWritten: chunk.index,
            message: `Writing chunk ${chunk.index + 1} of ${chunks.length}...`,
            phase: "uploading",
            progress: Math.round((chunk.offset / firmware.byteLength) * 100)
          }));

          await writePacketAndWait(device, chunk.packet, WRITE_TIMEOUT_MS);

          const bytesWritten = Math.min(chunk.offset + chunk.data.byteLength, firmware.byteLength);
          setFirmwareUpgrade((current) => ({
            ...current,
            bytesWritten,
            chunksWritten: chunk.index + 1,
            message: `Wrote chunk ${chunk.index + 1} of ${chunks.length}.`,
            progress: Math.round((bytesWritten / firmware.byteLength) * 100)
          }));
        }

        setFirmwareUpgrade((current) => ({
          ...current,
          message: "Restarting meter..."
        }));
        try {
          await sendPacket(device, buildFirmwareRestartPacket(chunks.length, transfer.restartPayload));
          await waitForRestartSettle(device, RESTART_SETTLE_MS);
        } catch {
          // Some bootloaders detach immediately when accepting the restart command.
        }

        setFirmwareUpgrade((current) => ({
          ...current,
          bytesWritten: firmware.byteLength,
          chunksWritten: chunks.length,
          message: "Firmware upload complete. The meter is restarting.",
          phase: "done",
          progress: 100
        }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          setFirmwareUpgrade(IDLE_STATE);
          return;
        }

        setFirmwareUpgrade((current) => ({
          ...current,
          error: normalizeFirmwareError(error),
          message: "Firmware upload failed.",
          phase: "error"
        }));
      } finally {
        if (device?.opened) {
          try {
            await device.close();
          } catch {
            // The device may have rebooted or detached after a completed transfer.
          }
        }
      }
    },
    [hidSupported]
  );

  return {
    firmwareUpgrade,
    hidSupported,
    resetFirmwareUpgrade,
    startFirmwareUpgrade
  };
}

async function writePacketAndWait(device: HIDDevice, packet: Uint8Array<ArrayBufferLike>, timeoutMs: number): Promise<Uint8Array> {
  const response = createInputReportWaiter(device, timeoutMs);

  try {
    await sendBootloaderReport(device, packet);
    return await response.promise;
  } catch (error) {
    response.cancel();
    throw error;
  }
}

async function sendPacket(device: HIDDevice, packet: Uint8Array<ArrayBufferLike>): Promise<void> {
  await sendBootloaderReport(device, packet);
}

async function sendBootloaderReport(device: HIDDevice, packet: Uint8Array<ArrayBufferLike>): Promise<void> {
  await device.sendReport(0, packetToArrayBuffer(packet));
}

function waitForRestartSettle(device: HIDDevice, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      navigator.hid?.removeEventListener("disconnect", onDisconnected);
      resolve();
    };

    const timeout = window.setTimeout(finish, timeoutMs);
    const onDisconnected = (event: Event) => {
      const hidEvent = event as HIDConnectionEvent;
      if (hidEvent.device === device) {
        finish();
      }
    };

    navigator.hid?.addEventListener("disconnect", onDisconnected);
  });
}

function createInputReportWaiter(
  device: HIDDevice,
  timeoutMs: number
): { cancel: () => void; promise: Promise<Uint8Array> } {
  let cleanup = () => {};

  const promise = new Promise<Uint8Array>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for bootloader response after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    const onInputReport = (event: HIDInputReportEvent) => {
      if (event.device !== device) {
        return;
      }

      const response = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      cleanup();
      resolve(response.slice());
    };

    cleanup = () => {
      window.clearTimeout(timeout);
      device.removeEventListener("inputreport", onInputReport);
    };

    device.addEventListener("inputreport", onInputReport);
  });

  return { cancel: cleanup, promise };
}

function packetToArrayBuffer(packet: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  const buffer = new ArrayBuffer(packet.byteLength);
  new Uint8Array(buffer).set(packet);
  return buffer;
}

function normalizeFirmwareError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "SecurityError") {
      return "The browser blocked WebHID access. Open the app on HTTPS or localhost and try again.";
    }

    if (error.name === "NetworkError") {
      return "The browser found the bootloader but could not open it. Unplug and reconnect the meter in bootloader mode, then retry.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "The browser could not complete the firmware upload.";
}
