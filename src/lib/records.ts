import type { Measurement, RecordSlotKey, SavedRecord } from "../types";

type CompactSavedRecordBundle = {
  v: 2;
  t: string;
  r: Partial<Record<RecordSlotKey, CompactSavedRecord>>;
};

type CompactSavedRecord = {
  s: RecordSlotKey;
  l: string;
  c: number;
  m: CompactMeasurement[];
};

type CompactMeasurement = [
  timestampMs: number,
  sampleIndex: number,
  voltage: number,
  current: number,
  power: number,
  dp: number,
  dn: number,
  temperatureC: number,
  temperatureEmaC: number,
  energyWs: number,
  capacityAs: number
];

export function snapshotRecord(slot: RecordSlotKey, measurements: Measurement[]): SavedRecord {
  return {
    slot,
    label: slot === "main" ? "Main record" : "Auxiliary record",
    capturedAtMs: Date.now(),
    measurements: measurements.map((sample) => ({ ...sample }))
  };
}

export function downloadRecordBundle(records: Partial<Record<RecordSlotKey, SavedRecord>>): void {
  const bundle: CompactSavedRecordBundle = {
    v: 2,
    t: new Date().toISOString(),
    r: compactRecords(records)
  };

  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `openfnb-records-${new Date().toISOString().replace(/:/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importRecordBundle(file: File): Promise<Partial<Record<RecordSlotKey, SavedRecord>>> {
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;

  if (!isCompactBundle(parsed)) {
    throw new Error("Unsupported record bundle format.");
  }

  return {
    main: expandCompactRecord(parsed.r.main, "main") ?? undefined,
    aux: expandCompactRecord(parsed.r.aux, "aux") ?? undefined
  };
}

function compactRecords(records: Partial<Record<RecordSlotKey, SavedRecord>>): Partial<Record<RecordSlotKey, CompactSavedRecord>> {
  return {
    main: compactRecord(records.main),
    aux: compactRecord(records.aux)
  };
}

function compactRecord(record: SavedRecord | undefined): CompactSavedRecord | undefined {
  if (!record) {
    return undefined;
  }

  return {
    s: record.slot,
    l: record.label,
    c: record.capturedAtMs,
    m: record.measurements.map(compactMeasurement)
  };
}

function compactMeasurement(sample: Measurement): CompactMeasurement {
  return [
    sample.timestampMs,
    sample.sampleIndex,
    sample.voltage,
    sample.current,
    sample.power,
    sample.dp,
    sample.dn,
    sample.temperatureC,
    sample.temperatureEmaC,
    sample.energyWs,
    sample.capacityAs
  ];
}

function expandCompactRecord(input: CompactSavedRecord | undefined, expectedSlot: RecordSlotKey): SavedRecord | null {
  if (!input || input.s !== expectedSlot || !Array.isArray(input.m)) {
    return null;
  }

  const measurements = input.m.map(expandCompactMeasurement).filter((sample): sample is Measurement => sample !== null);

  return {
    slot: expectedSlot,
    label: input.l || (expectedSlot === "main" ? "Main record" : "Auxiliary record"),
    capturedAtMs: Number(input.c) || Date.now(),
    measurements
  };
}

function expandCompactMeasurement(row: unknown): Measurement | null {
  if (!Array.isArray(row) || row.length !== 11 || row.some((value) => typeof value !== "number")) {
    return null;
  }

  const [
    timestampMs,
    sampleIndex,
    voltage,
    current,
    power,
    dp,
    dn,
    temperatureC,
    temperatureEmaC,
    energyWs,
    capacityAs
  ] = row;

  return {
    timestampMs,
    sampleIndex,
    voltage,
    current,
    power,
    dp,
    dn,
    temperatureC,
    temperatureEmaC,
    energyWs,
    capacityAs
  };
}

function isCompactBundle(value: unknown): value is CompactSavedRecordBundle {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CompactSavedRecordBundle>;
  return candidate.v === 2 && typeof candidate.r === "object" && candidate.r !== null;
}
