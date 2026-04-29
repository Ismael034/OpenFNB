import type { Measurement } from "../types";

export type SignalKey = "vbus" | "ibus" | "dp" | "dn" | "pbus" | "cap" | "nrg";
export type SignalUnit = "V" | "A" | "W" | "Ah" | "Wh";

export type SignalDefinition = {
  key: SignalKey;
  label: string;
  shortLabel: string;
  unit: SignalUnit;
  color: string;
  decimals: number;
  accessor: (sample: Measurement) => number;
};

export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    key: "vbus",
    label: "VBUS",
    shortLabel: "VBUS",
    unit: "V",
    color: "#06b6d4",
    decimals: 4,
    accessor: (sample) => sample.voltage
  },
  {
    key: "ibus",
    label: "IBUS",
    shortLabel: "IBUS",
    unit: "A",
    color: "#22c55e",
    decimals: 4,
    accessor: (sample) => sample.current
  },
  {
    key: "dp",
    label: "D+",
    shortLabel: "D+",
    unit: "V",
    color: "#eab308",
    decimals: 3,
    accessor: (sample) => sample.dp
  },
  {
    key: "dn",
    label: "D-",
    shortLabel: "D-",
    unit: "V",
    color: "#8b5cf6",
    decimals: 3,
    accessor: (sample) => sample.dn
  },
  {
    key: "pbus",
    label: "PBUS",
    shortLabel: "PBUS",
    unit: "W",
    color: "#f97316",
    decimals: 4,
    accessor: (sample) => sample.power
  },
  {
    key: "cap",
    label: "CAP",
    shortLabel: "CAP",
    unit: "Ah",
    color: "#ec4899",
    decimals: 6,
    accessor: (sample) => sample.capacityAs / 3600
  },
  {
    key: "nrg",
    label: "NRG",
    shortLabel: "NRG",
    unit: "Wh",
    color: "#ef4444",
    decimals: 6,
    accessor: (sample) => sample.energyWs / 3600
  }
];

export const SIGNALS_BY_KEY: Record<SignalKey, SignalDefinition> = Object.fromEntries(
  SIGNAL_DEFINITIONS.map((signal) => [signal.key, signal])
) as Record<SignalKey, SignalDefinition>;

export const DEFAULT_VISIBLE_SIGNALS: SignalKey[] = ["vbus", "ibus", "pbus", "dp", "dn"];
