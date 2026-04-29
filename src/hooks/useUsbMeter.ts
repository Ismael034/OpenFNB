import { startTransition, useCallback, useMemo, useRef, useState } from "react";
import type { ConnectionState, Measurement } from "../types";
import { buildCommandPacket, createDecoderState, decodeDataReport, findProfile, SUPPORTED_PROFILES } from "../lib/fnirsiProtocol";

export type UsbMeterError = {
  title: string;
  message: string;
};

type ActiveSession = {
  disconnect: () => Promise<void>;
};

type BluetoothMeasurement = Pick<Measurement, "current" | "dn" | "dp" | "power" | "temperatureC" | "voltage">;
type BluetoothTelemetryState = BluetoothMeasurement & {
  hasWaveformSamples: boolean;
};

type UseUsbMeterResult = {
  bluetoothSupported: boolean;
  browserSupported: boolean;
  connectWebBluetooth: () => Promise<void>;
  connectWebHid: () => Promise<void>;
  clearHistory: () => void;
  status: ConnectionState;
  error: UsbMeterError | null;
  measurements: Measurement[];
  latestMeasurement: Measurement | null;
  sessionStartMs: number | null;
  paused: boolean;
  captureSamplesPerSecond: number;
  disconnect: () => Promise<void>;
  hidSupported: boolean;
  setCaptureSamplesPerSecond: (samplesPerSecond: number) => void;
  togglePaused: () => void;
};

const BLE_NOTIFY_CHARACTERISTIC = "0000ffe4-0000-1000-8000-00805f9b34fb";
const BLE_WRITE_CHARACTERISTIC = "0000ffe9-0000-1000-8000-00805f9b34fb";
const BLE_NOTIFY_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb";
const BLE_WRITE_SERVICE = "0000ffe5-0000-1000-8000-00805f9b34fb";
const BLE_OPTIONAL_SERVICES = [BLE_NOTIFY_SERVICE, BLE_WRITE_SERVICE];
const BLE_SAMPLE_RATE_HZ = 150;
const BLE_VALUE_SCALE = 10_000;
const BLE_MAX_VOLTAGE = 150;
const BLE_MAX_CURRENT = 100;
const BLE_MAX_POWER = 1000;
const BLE_CMD_INIT = 0x81;
const BLE_CMD_START_CAPTURE = 0x82;
const BLE_CMD_STOP_CAPTURE = 0x84;
const BLE_CMD_REQUEST_STATUS = 0x85;
const BLE_CMD_LIVE_POWER = 0x04;
const BLE_CMD_TEMPERATURE = 0x05;
const BLE_CMD_DP_DN = 0x06;
const BLE_CMD_WAVEFORM_SAMPLE = 0x07;

export function useUsbMeter(): UseUsbMeterResult {
  const hidSupported = typeof navigator !== "undefined" && typeof navigator.hid !== "undefined";
  const bluetoothSupported = typeof navigator !== "undefined" && typeof navigator.bluetooth !== "undefined";
  const browserSupported = hidSupported || bluetoothSupported;
  const [status, setStatus] = useState<ConnectionState>("idle");
  const [error, setError] = useState<UsbMeterError | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [captureSamplesPerSecond, setCaptureSamplesPerSecondState] = useState(20);
  const sessionRef = useRef<ActiveSession | null>(null);
  const decoderStateRef = useRef(createDecoderState());
  const pendingMeasurementsRef = useRef<Measurement[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const flushDelayMsRef = useRef(50);
  const pausedRef = useRef(false);
  const lastReportAtRef = useRef(0);
  const lastRecoveryAtRef = useRef(0);
  const sampleIndexRef = useRef(0);
  const bluetoothTelemetryRef = useRef(createBluetoothTelemetryState());
  const bluetoothCaptureStartedRef = useRef(false);
  const bluetoothFrameBufferRef = useRef(new Uint8Array());

  const flushPendingMeasurements = useCallback(() => {
    flushTimerRef.current = null;
    if (pendingMeasurementsRef.current.length === 0) {
      return;
    }

    const next = pendingMeasurementsRef.current;
    pendingMeasurementsRef.current = [];

    startTransition(() => {
      setMeasurements((current) => current.concat(next));
    });
  }, []);

  const pushMeasurements = useCallback(
    (next: Measurement[]) => {
      if (next.length === 0) {
        return;
      }

      setSessionStartMs((current) => current ?? next[0].timestampMs);
      pendingMeasurementsRef.current.push(...next);
      if (flushTimerRef.current !== null) {
        return;
      }

      flushTimerRef.current = window.setTimeout(() => {
        flushPendingMeasurements();
      }, flushDelayMsRef.current);
    },
    [flushPendingMeasurements]
  );

  const ingestMeasurements = useCallback(
    (next: Measurement[]) => {
      if (pausedRef.current || next.length === 0) {
        return;
      }

      pushMeasurements(next);
    },
    [pushMeasurements]
  );

  const resetSession = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingMeasurementsRef.current = [];
    decoderStateRef.current = createDecoderState();
    flushDelayMsRef.current = 50;
    bluetoothTelemetryRef.current = createBluetoothTelemetryState();
    bluetoothCaptureStartedRef.current = false;
    bluetoothFrameBufferRef.current = new Uint8Array();
    lastReportAtRef.current = 0;
    lastRecoveryAtRef.current = 0;
    sampleIndexRef.current = 0;
    setMeasurements([]);
    setSessionStartMs(null);
    setError(null);
  }, []);

  const resetStreamState = useCallback((sampleRateHz: number) => {
    decoderStateRef.current = createDecoderState(0.9, sampleRateHz);
    flushDelayMsRef.current = Math.max(16, Math.min(50, Math.round((1000 / sampleRateHz) * 2)));
    bluetoothTelemetryRef.current = createBluetoothTelemetryState();
    bluetoothCaptureStartedRef.current = false;
    bluetoothFrameBufferRef.current = new Uint8Array();
    sampleIndexRef.current = 0;
    lastReportAtRef.current = Date.now();
    lastRecoveryAtRef.current = 0;
  }, []);

  const setCaptureSamplesPerSecond = useCallback((samplesPerSecond: number) => {
    setCaptureSamplesPerSecondState(samplesPerSecond);
  }, []);

  const togglePaused = useCallback(() => {
    setPaused((current) => {
      const next = !current;
      pausedRef.current = next;
      return next;
    });
  }, []);

  const disconnect = useCallback(async () => {
    const active = sessionRef.current;
    sessionRef.current = null;

    if (active) {
      await active.disconnect();
    }

    setStatus("idle");
    setError(null);
    pausedRef.current = false;
    setPaused(false);
  }, []);

  const connectWebHid = useCallback(async () => {
    if (!hidSupported) {
      setStatus("error");
      setError({
        title: "WebHID unavailable",
        message: "Use Chrome or Edge on HTTPS or localhost to access HID devices from the browser."
      });
      return;
    }
    await disconnect();
    resetSession();
    setStatus("connecting");

    try {
      const selectedDevices = await navigator.hid!.requestDevice({
        filters: SUPPORTED_PROFILES.map(({ vendorId, productId }) => ({ vendorId, productId }))
      });
      const hidDevice = selectedDevices[0];

      if (!hidDevice) {
        setStatus("idle");
        return;
      }

      const profile = findProfile(hidDevice.vendorId, hidDevice.productId);
      if (!profile) {
        throw new Error(
          `Unsupported device: ${hidDevice.vendorId.toString(16)}:${hidDevice.productId.toString(16)}`
        );
      }

      await hidDevice.open();
      resetStreamState(profile.sampleRateHz);

      const sendCommand = async (command: number) => {
        await hidDevice.sendReport(0, packetToArrayBuffer(buildCommandPacket(command)));
      };

      const refreshStream = async () => {
        for (const command of profile.startupCommands) {
          await sendCommand(command);
        }
        await sendCommand(profile.keepaliveCommand);
      };

      const onDisconnected = (event: Event) => {
        const hidEvent = event as HIDConnectionEvent;
        if (hidEvent.device !== hidDevice) {
          return;
        }

        sessionRef.current = null;
        setStatus("error");
        setError({
          title: "Device disconnected",
          message: "The USB meter was unplugged or stopped responding. Reconnect it and start a new session."
        });
      };

      const onInputReport = (event: HIDInputReportEvent) => {
        if (event.device !== hidDevice) {
          return;
        }

        const packet = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);

        try {
          lastReportAtRef.current = Date.now();
          const next = decodeDataReport(packet, decoderStateRef.current, Date.now(), true).map((sample) => ({
            ...sample,
            sampleIndex: sampleIndexRef.current++
          }));
          ingestMeasurements(next);
        } catch (packetError) {
          setError({
            title: "Packet decode error",
            message:
              packetError instanceof Error
                ? packetError.message
                : "The meter sent a report that could not be decoded."
          });
        }
      };

      navigator.hid!.addEventListener("disconnect", onDisconnected);
      hidDevice.addEventListener("inputreport", onInputReport);

      await refreshStream();

      const keepalive = window.setInterval(() => {
        sendCommand(profile.keepaliveCommand).catch((keepaliveError) => {
          setError({
            title: "Keepalive failed",
            message:
              keepaliveError instanceof Error
                ? keepaliveError.message
                : "The browser could not send a keepalive packet to the meter."
          });
        });
      }, Math.min(profile.keepaliveIntervalMs, 250));

      const watchdog = window.setInterval(() => {
        const now = Date.now();
        if (now - lastReportAtRef.current < 1500 || now - lastRecoveryAtRef.current < 1000) {
          return;
        }

        lastRecoveryAtRef.current = now;
        refreshStream().catch((recoveryError) => {
          setError({
            title: "Stream recovery failed",
            message:
              recoveryError instanceof Error
                ? recoveryError.message
                : "The browser could not restart the live stream on the meter."
          });
        });
      }, 500);

      sessionRef.current = {
        disconnect: async () => {
          window.clearInterval(keepalive);
          window.clearInterval(watchdog);
          navigator.hid!.removeEventListener("disconnect", onDisconnected);
          hidDevice.removeEventListener("inputreport", onInputReport);
          if (hidDevice.opened) {
            await hidDevice.close();
          }
        }
      };

      setStatus("live");
    } catch (connectError) {
      if (connectError instanceof DOMException && connectError.name === "NotFoundError") {
        setStatus("idle");
        setError(null);
        return;
      }

      setStatus("error");
      setError(normalizeConnectError(connectError));
    }
  }, [disconnect, hidSupported, ingestMeasurements, resetSession, resetStreamState]);

  const connectWebBluetooth = useCallback(async () => {
    if (!bluetoothSupported) {
      setStatus("error");
      setError({
        title: "Web Bluetooth unavailable",
        message: "Use a Chromium-based browser with Bluetooth enabled on HTTPS or localhost."
      });
      return;
    }

    await disconnect();
    resetSession();
    setStatus("connecting");

    try {
      const bluetoothDevice = await navigator.bluetooth!.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_OPTIONAL_SERVICES
      });

      if (!bluetoothDevice.gatt) {
        throw new Error("The selected Bluetooth device does not expose a GATT server.");
      }

      const server = await bluetoothDevice.gatt.connect();
      resetStreamState(BLE_SAMPLE_RATE_HZ);

      const [notifyService, writeService] = await Promise.all([
        server.getPrimaryService(BLE_NOTIFY_SERVICE),
        server.getPrimaryService(BLE_WRITE_SERVICE)
      ]);
      const [notifyCharacteristic, writeCharacteristic] = await Promise.all([
        notifyService.getCharacteristic(BLE_NOTIFY_CHARACTERISTIC),
        writeService.getCharacteristic(BLE_WRITE_CHARACTERISTIC)
      ]);

      const writeCommand = async (command: Uint8Array) => {
        const payload = packetToArrayBuffer(command);
        if (typeof writeCharacteristic.writeValueWithoutResponse === "function") {
          await writeCharacteristic.writeValueWithoutResponse(payload);
          return;
        }

        await writeCharacteristic.writeValue(payload);
      };

      const startBluetoothCapture = async () => {
        if (bluetoothCaptureStartedRef.current) {
          return;
        }

        bluetoothCaptureStartedRef.current = true;
        await writeCommand(buildBluetoothCommand(BLE_CMD_REQUEST_STATUS));
        await writeCommand(buildBluetoothCommand(BLE_CMD_START_CAPTURE));
      };

      const onDisconnected = () => {
        sessionRef.current = null;
        setStatus("error");
        setError({
          title: "Bluetooth device disconnected",
          message: "The FNB58 Bluetooth link was lost. Reconnect it and start a new session."
        });
      };

      const onValueChanged = (event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const value = target.value;
        if (!value) {
          return;
        }

        const packet = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        const timestampMs = Date.now();
        const decodedReports = decodeDataReport(packet, decoderStateRef.current, timestampMs, false);
        if (decodedReports.length > 0) {
          lastReportAtRef.current = timestampMs;
          ingestMeasurements(decodedReports.map((sample) => ({ ...sample, sampleIndex: sampleIndexRef.current++ })));
          return;
        }

        const frames = extractBluetoothFrames(packet, bluetoothFrameBufferRef);
        for (const frame of frames) {
          if ((frame.command === 0x01 || frame.command === 0x02) && (frame.payload[0] === 0x86 || frame.payload[0] === 0x87)) {
            void startBluetoothCapture().catch((startupError) => {
              setError({
                title: "Bluetooth startup failed",
                message:
                  startupError instanceof Error
                    ? startupError.message
                    : "The browser could not start live Bluetooth capture."
              });
            });
          }
        }

        const parsed = parseBluetoothMeasurements(frames, bluetoothTelemetryRef.current);
        if (parsed.length === 0) {
          return;
        }

        const state = decoderStateRef.current;
        const intervalMs = 1000 / state.sampleRateHz;
        const firstTimestampMs = timestampMs - intervalMs * (parsed.length - 1);
        lastReportAtRef.current = timestampMs;

        ingestMeasurements(
          parsed.map((sample, index) => {
            state.tempEmaC =
              state.tempEmaC === null
                ? sample.temperatureC
                : sample.temperatureC * (1 - state.alpha) + state.tempEmaC * state.alpha;
            state.energyWs += sample.power / state.sampleRateHz;
            state.capacityAs += sample.current / state.sampleRateHz;

            return {
              timestampMs: firstTimestampMs + intervalMs * index,
              sampleIndex: sampleIndexRef.current++,
              voltage: sample.voltage,
              current: sample.current,
              power: sample.power,
              dp: sample.dp,
              dn: sample.dn,
              temperatureC: sample.temperatureC,
              temperatureEmaC: state.tempEmaC,
              energyWs: state.energyWs,
              capacityAs: state.capacityAs
            };
          })
        );
      };

      bluetoothDevice.addEventListener("gattserverdisconnected", onDisconnected);
      notifyCharacteristic.addEventListener("characteristicvaluechanged", onValueChanged);
      await notifyCharacteristic.startNotifications();

      await writeCommand(buildBluetoothCommand(BLE_CMD_INIT));

      const startupFallback = window.setTimeout(() => {
        void startBluetoothCapture().catch((startupError) => {
          setError({
            title: "Bluetooth startup failed",
            message:
              startupError instanceof Error ? startupError.message : "The browser could not start live Bluetooth capture."
          });
        });
      }, 250);

      sessionRef.current = {
        disconnect: async () => {
          window.clearTimeout(startupFallback);
          if (bluetoothCaptureStartedRef.current) {
            try {
              await writeCommand(buildBluetoothCommand(BLE_CMD_STOP_CAPTURE));
            } catch {
              // Ignore shutdown command failures when the device is already gone.
            }
          }

          notifyCharacteristic.removeEventListener("characteristicvaluechanged", onValueChanged);
          bluetoothDevice.removeEventListener("gattserverdisconnected", onDisconnected);
          try {
            await notifyCharacteristic.stopNotifications();
          } catch {
            // Ignore stop failures during shutdown.
          }

          if (server.connected) {
            server.disconnect();
          }
        }
      };

      setStatus("live");
    } catch (connectError) {
      if (connectError instanceof DOMException && connectError.name === "NotFoundError") {
        setStatus("idle");
        setError(null);
        return;
      }

      setStatus("error");
      setError(normalizeBluetoothError(connectError));
    }
  }, [bluetoothSupported, disconnect, ingestMeasurements, resetSession, resetStreamState]);

  const latestMeasurement = useMemo(
    () => (measurements.length > 0 ? measurements[measurements.length - 1] : null),
    [measurements]
  );

  const clearHistory = useCallback(() => {
    resetSession();
  }, [resetSession]);

  return {
    bluetoothSupported,
    browserSupported,
    connectWebBluetooth,
    connectWebHid,
    clearHistory,
    status,
    error,
    measurements,
    latestMeasurement,
    sessionStartMs,
    paused,
    captureSamplesPerSecond,
    disconnect,
    hidSupported,
    setCaptureSamplesPerSecond,
    togglePaused
  };
}

function packetToArrayBuffer(packet: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(packet.byteLength);
  new Uint8Array(buffer).set(packet);
  return buffer;
}

function buildBluetoothCommand(command: number, payload = new Uint8Array()): Uint8Array {
  const packet = new Uint8Array(payload.length + 4);
  packet[0] = 0xaa;
  packet[1] = command;
  packet[2] = payload.length;
  packet.set(payload, 3);
  packet[packet.length - 1] = crc16XmodemLow(packet.subarray(0, packet.length - 1));
  return packet;
}

function createBluetoothTelemetryState(): BluetoothTelemetryState {
  return {
    voltage: 0,
    current: 0,
    power: 0,
    dp: 0,
    dn: 0,
    temperatureC: 0,
    hasWaveformSamples: false
  };
}

function parseBluetoothMeasurements(
  frames: Array<{ command: number; payload: Uint8Array }>,
  telemetry: BluetoothTelemetryState
): BluetoothMeasurement[] {
  const measurements: BluetoothMeasurement[] = [];

  for (const frame of frames) {
    const payload = frame.payload;

    if (frame.command === BLE_CMD_LIVE_POWER && payload.length >= 12) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const voltage = view.getInt32(0, true) / BLE_VALUE_SCALE;
      const current = view.getInt32(4, true) / BLE_VALUE_SCALE;
      const power = view.getInt32(8, true) / BLE_VALUE_SCALE;

      if (!isReasonablePowerTelemetry(voltage, current, power)) {
        continue;
      }

      telemetry.voltage = voltage;
      telemetry.current = current;
      telemetry.power = power;
      if (telemetry.hasWaveformSamples) {
        continue;
      }

      measurements.push({ ...telemetry });
      continue;
    }

    if (frame.command === BLE_CMD_WAVEFORM_SAMPLE && payload.length >= 4) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const voltage = view.getUint16(0, true) / 1000;
      const current = view.getUint16(2, true) / 1000;
      const power = voltage * current;

      if (!isReasonablePowerTelemetry(voltage, current, power)) {
        continue;
      }

      telemetry.voltage = voltage;
      telemetry.current = current;
      telemetry.power = power;
      telemetry.hasWaveformSamples = true;
      measurements.push({ ...telemetry });
      continue;
    }

    if (frame.command === BLE_CMD_DP_DN && payload.length >= 4) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const dp = view.getUint16(0, true) / 1000;
      const dn = view.getUint16(2, true) / 1000;

      if (dp >= 0 && dp <= 5 && dn >= 0 && dn <= 5) {
        telemetry.dp = dp;
        telemetry.dn = dn;
      }
      continue;
    }

    if (frame.command === BLE_CMD_TEMPERATURE && payload.length >= 7) {
      const sign = payload[4] > 0 ? 1 : -1;
      const temperatureC = (sign * readU16Le(payload, 5)) / 10;

      if (temperatureC >= -40 && temperatureC <= 150) {
        telemetry.temperatureC = temperatureC;
      }
    }
  }

  return measurements;
}

function extractBluetoothFrames(
  packet: Uint8Array,
  carryRef?: { current: Uint8Array }
): Array<{ command: number; payload: Uint8Array }> {
  const source =
    carryRef && carryRef.current.length > 0 ? concatUint8Arrays(carryRef.current, packet) : packet;
  const frames: Array<{ command: number; payload: Uint8Array }> = [];
  let offset = 0;
  let carryFrom = source.length;

  while (offset <= source.length - 4) {
    if (source[offset] !== 0xaa) {
      offset += 1;
      continue;
    }

    const payloadLength = source[offset + 2];
    const frameLength = payloadLength + 4;
    const endOffset = offset + frameLength;
    if (endOffset > source.length) {
      carryFrom = offset;
      break;
    }

    const frame = source.subarray(offset, endOffset);
    if (crc16XmodemLow(frame.subarray(0, frame.length - 1)) !== frame[frame.length - 1]) {
      offset += 1;
      continue;
    }

    frames.push({
      command: frame[1],
      payload: frame.subarray(3, frame.length - 1)
    });
    offset = endOffset;
  }

  if (carryRef) {
    carryRef.current = compactBluetoothCarry(source, carryFrom);
  }

  return frames;
}

function concatUint8Arrays(first: Uint8Array, second: Uint8Array): Uint8Array {
  const next = new Uint8Array(first.length + second.length);
  next.set(first, 0);
  next.set(second, first.length);
  return next;
}

function compactBluetoothCarry(source: Uint8Array, carryFrom: number): Uint8Array {
  if (carryFrom < source.length) {
    return source.subarray(carryFrom).slice(-64);
  }

  const tailStart = Math.max(0, source.length - 3);
  for (let offset = tailStart; offset < source.length; offset += 1) {
    if (source[offset] === 0xaa) {
      return source.subarray(offset).slice();
    }
  }

  return new Uint8Array();
}

function isReasonablePowerTelemetry(voltage: number, current: number, power: number) {
  if (
    !Number.isFinite(voltage) ||
    !Number.isFinite(current) ||
    !Number.isFinite(power) ||
    voltage < 0 ||
    voltage > BLE_MAX_VOLTAGE ||
    Math.abs(current) > BLE_MAX_CURRENT ||
    Math.abs(power) > BLE_MAX_POWER
  ) {
    return false;
  }

  const expectedPower = voltage * current;
  const powerDelta = Math.abs(expectedPower - power);
  const powerTolerance = Math.max(0.5, Math.abs(expectedPower) * 0.25);
  return powerDelta <= powerTolerance;
}

function readU16Le(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function crc16XmodemLow(buffer: Uint8Array): number {
  let crc = 0;

  for (const byte of buffer) {
    for (let bit = 0; bit < 8; bit += 1) {
      const inputBit = ((byte >> (7 - bit)) & 1) === 1;
      const crcTopBit = ((crc >> 15) & 1) === 1;
      crc = (crc << 1) & 0xffff;
      if (inputBit !== crcTopBit) {
        crc ^= 0x1021;
      }
    }
  }

  return crc & 0xff;
}

function normalizeConnectError(error: unknown): UsbMeterError {
  if (error instanceof DOMException) {
    if (error.name === "SecurityError") {
      return {
        title: "Browser blocked access",
        message: "Open the app on HTTPS or localhost, then try the connection again."
      };
    }

    if (error.name === "NetworkError") {
      return {
        title: "Device open failed",
        message: "The browser found the meter but could not open it. Unplug and reconnect the meter, then retry."
      };
    }
  }

  if (error instanceof Error) {
    return {
      title: "Connection failed",
      message: error.message
    };
  }

  return {
    title: "Connection failed",
    message: "The browser could not start a session with the selected USB meter."
  };
}

function normalizeBluetoothError(error: unknown): UsbMeterError {
  if (error instanceof DOMException) {
    if (error.name === "SecurityError") {
      return {
        title: "Bluetooth blocked",
        message: "Open the app on HTTPS or localhost and allow Bluetooth access, then try again."
      };
    }

    if (error.name === "NetworkError") {
      return {
        title: "Bluetooth connection failed",
        message: "The browser found the meter but could not open its Bluetooth link."
      };
    }
  }

  if (error instanceof Error) {
    return {
      title: "Bluetooth connection failed",
      message: error.message
    };
  }

  return {
    title: "Bluetooth connection failed",
    message: "The browser could not start a Bluetooth session with the selected meter."
  };
}
