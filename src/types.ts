export type ConnectionState = "idle" | "connecting" | "live" | "error";

export type DeviceProfile = {
  key: string;
  label: string;
  vendorId: number;
  productId: number;
  startupCommands: number[];
  keepaliveCommand: number;
  keepaliveIntervalMs: number;
  sampleRateHz: number;
};

export type Measurement = {
  timestampMs: number;
  sampleIndex: number;
  voltage: number;
  current: number;
  power: number;
  dp: number;
  dn: number;
  temperatureC: number;
  temperatureEmaC: number;
  energyWs: number;
  capacityAs: number;
};

export type RecordSlotKey = "main" | "aux";

export type SavedRecord = {
  slot: RecordSlotKey;
  label: string;
  capturedAtMs: number;
  measurements: Measurement[];
};

export type SessionStats = {
  elapsedSeconds: number;
  sampleCount: number;
  peakVoltage: number;
  peakCurrent: number;
  peakPower: number;
  avgPower: number;
};
