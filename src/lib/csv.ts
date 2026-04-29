import type { Measurement } from "../types";

export function downloadCsv(measurements: Measurement[]): void {
  if (measurements.length === 0) {
    return;
  }

  const header = [
    "timestamp_ms",
    "sample_index",
    "voltage_v",
    "current_a",
    "power_w",
    "dp_v",
    "dn_v",
    "temperature_c",
    "temperature_ema_c",
    "energy_ws",
    "capacity_as"
  ];

  const rows = measurements.map((sample) =>
    [
      sample.timestampMs.toFixed(0),
      sample.sampleIndex,
      sample.voltage.toFixed(5),
      sample.current.toFixed(5),
      sample.power.toFixed(5),
      sample.dp.toFixed(3),
      sample.dn.toFixed(3),
      sample.temperatureC.toFixed(1),
      sample.temperatureEmaC.toFixed(2),
      sample.energyWs.toFixed(6),
      sample.capacityAs.toFixed(6)
    ].join(",")
  );

  const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `openfnb-${new Date().toISOString().replace(/:/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
