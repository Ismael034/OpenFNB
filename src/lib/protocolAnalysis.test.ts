import { describe, expect, it } from "vitest";
import type { Measurement } from "../types";
import { analyzeProtocolSession, classifyProtocolSample, findTriggerEvents } from "./protocolAnalysis";

function buildMeasurement(overrides: Partial<Measurement>): Measurement {
  return {
    timestampMs: 0,
    sampleIndex: 0,
    voltage: 5,
    current: 1,
    power: 5,
    dp: 0,
    dn: 0,
    temperatureC: 25,
    temperatureEmaC: 25,
    energyWs: 0,
    capacityAs: 0,
    ...overrides
  };
}

describe("protocolAnalysis", () => {
  it("classifies common Apple divider signatures", () => {
    expect(classifyProtocolSample(buildMeasurement({ dp: 2.7, dn: 2.7 })).label).toBe("Apple 2.4 A");
    expect(classifyProtocolSample(buildMeasurement({ dp: 2.0, dn: 2.7 })).label).toBe("Apple 1 A");
    expect(classifyProtocolSample(buildMeasurement({ dp: 2.7, dn: 2.0 })).label).toBe("Apple 2.1 A");
  });

  it("detects trigger crossings with holdoff", () => {
    const measurements = [
      buildMeasurement({ timestampMs: 0, dp: 0.2 }),
      buildMeasurement({ timestampMs: 50, sampleIndex: 1, dp: 0.7 }),
      buildMeasurement({ timestampMs: 100, sampleIndex: 2, dp: 0.4 }),
      buildMeasurement({ timestampMs: 250, sampleIndex: 3, dp: 0.9 })
    ];

    const events = findTriggerEvents(measurements, {
      direction: "rising",
      holdoffMs: 100,
      signal: "dp",
      threshold: 0.6
    });
    const event = events[events.length - 1];

    expect(event?.index).toBe(3);
    expect(event?.value).toBeCloseTo(0.9, 3);
  });

  it("builds session summaries and transitions", () => {
    const summary = analyzeProtocolSession([
      buildMeasurement({ timestampMs: 0, dp: 0.02, dn: 0.02 }),
      buildMeasurement({ timestampMs: 1000, sampleIndex: 1, dp: 2.7, dn: 2.7 }),
      buildMeasurement({ timestampMs: 2000, sampleIndex: 2, dp: 2.7, dn: 2.7 })
    ]);

    expect(summary?.availability).toBe("available");
    expect(summary?.current.label).toBe("Apple 2.4 A");
    expect(summary?.dominant?.label).toBe("Apple 2.4 A");
    expect(summary?.transitions.length).toBe(2);
  });

  it("marks sessions without D+/D- telemetry as unavailable", () => {
    const summary = analyzeProtocolSession([
      buildMeasurement({ timestampMs: 0, voltage: 5.1, current: 0.4, dp: 0, dn: 0 }),
      buildMeasurement({ timestampMs: 1000, sampleIndex: 1, voltage: 5.1, current: 0.5, dp: 0, dn: 0 })
    ]);

    expect(summary?.availability).toBe("unavailable");
    expect(summary?.current.label).toBe("Protocol signal unavailable");
    expect(summary?.transitions).toEqual([]);
  });

  it("smooths one-sample classification blips in session summaries", () => {
    const summary = analyzeProtocolSession([
      buildMeasurement({ timestampMs: 0, dp: 2.7, dn: 2.7 }),
      buildMeasurement({ timestampMs: 1000, sampleIndex: 1, dp: 2.0, dn: 2.7 }),
      buildMeasurement({ timestampMs: 2000, sampleIndex: 2, dp: 2.7, dn: 2.7 })
    ]);

    expect(summary?.availability).toBe("available");
    expect(summary?.current.label).toBe("Apple 2.4 A");
    expect(summary?.dominant?.label).toBe("Apple 2.4 A");
    expect(summary?.transitions).toHaveLength(1);
  });
});
