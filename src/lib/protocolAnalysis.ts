import type { Measurement } from "../types";

export type TriggerSignal = "dp" | "dn" | "vbus" | "ibus";
export type TriggerDirection = "rising" | "falling";

export type TriggerConfig = {
  direction: TriggerDirection;
  holdoffMs: number;
  signal: TriggerSignal;
  threshold: number;
};

export type TriggerEvent = {
  direction: TriggerDirection;
  index: number;
  previousValue: number;
  signal: TriggerSignal;
  threshold: number;
  timestampMs: number;
  value: number;
};

export type ProtocolDetection = {
  confidence: "high" | "medium" | "low";
  detail: string;
  label: string;
};

export type ProtocolTransition = {
  atSeconds: number;
  label: string;
};

export type ProtocolSessionSummary = {
  availability: "available" | "unavailable";
  current: ProtocolDetection;
  dominant: ProtocolDetection | null;
  dpAverage: number;
  dnAverage: number;
  message?: string;
  shortedShare: number;
  transitions: ProtocolTransition[];
};

export function findTriggerEvents(
  measurements: Measurement[],
  config: TriggerConfig,
  fromIndex = 1,
  lastTriggerAtMs = -Infinity
): TriggerEvent[] {
  const matches: TriggerEvent[] = [];

  for (let index = Math.max(1, fromIndex); index < measurements.length; index += 1) {
    const previous = measurements[index - 1];
    const current = measurements[index];
    const previousValue = getTriggerValue(previous, config.signal);
    const currentValue = getTriggerValue(current, config.signal);
    const crossed =
      config.direction === "rising"
        ? previousValue < config.threshold && currentValue >= config.threshold
        : previousValue > config.threshold && currentValue <= config.threshold;

    if (!crossed || current.timestampMs - lastTriggerAtMs < config.holdoffMs) {
      continue;
    }

    matches.push({
      direction: config.direction,
      index,
      previousValue,
      signal: config.signal,
      threshold: config.threshold,
      timestampMs: current.timestampMs,
      value: currentValue
    });
    lastTriggerAtMs = current.timestampMs;
  }

  return matches;
}

export function analyzeProtocolSession(measurements: Measurement[]): ProtocolSessionSummary | null {
  if (measurements.length === 0) {
    return null;
  }

  if (isProtocolSignalUnavailable(measurements)) {
    return {
      availability: "unavailable",
      current: {
        confidence: "low",
        detail: "The current session does not include usable D+/D- telemetry for protocol classification.",
        label: "Protocol signal unavailable"
      },
      dominant: null,
      dpAverage: 0,
      dnAverage: 0,
      message: "D+/D- data is unavailable in this session, so protocol analysis cannot identify charging signatures.",
      shortedShare: 0,
      transitions: []
    };
  }

  const smoothedDetections = smoothProtocolDetections(measurements.map((measurement) => classifyProtocolSample(measurement)));
  const current = smoothedDetections[smoothedDetections.length - 1];
  const counts = new Map<string, { count: number; detection: ProtocolDetection }>();
  const transitions: ProtocolTransition[] = [];
  const firstTimestamp = measurements[0].timestampMs;
  let previousLabel = "";
  let shortedCount = 0;
  let dpSum = 0;
  let dnSum = 0;

  for (let index = 0; index < measurements.length; index += 1) {
    const measurement = measurements[index];
    const detection = smoothedDetections[index];
    const existing = counts.get(detection.label);
    counts.set(detection.label, {
      count: (existing?.count ?? 0) + 1,
      detection
    });

    if (Math.abs(measurement.dp - measurement.dn) <= 0.08 && measurement.dp > 0.2) {
      shortedCount += 1;
    }

    dpSum += measurement.dp;
    dnSum += measurement.dn;

    if (detection.label !== previousLabel) {
      transitions.push({
        atSeconds: (measurement.timestampMs - firstTimestamp) / 1000,
        label: detection.label
      });
      previousLabel = detection.label;
    }
  }

  const dominant = [...counts.values()]
    .sort((left, right) => right.count - left.count)
    .map((entry) => entry.detection)[0] ?? null;

  return {
    availability: "available",
    current,
    dominant,
    dpAverage: dpSum / measurements.length,
    dnAverage: dnSum / measurements.length,
    shortedShare: shortedCount / measurements.length,
    transitions: transitions.slice(-6)
  };
}

export function classifyProtocolSample(measurement: Measurement): ProtocolDetection {
  const { dp, dn } = measurement;
  const delta = Math.abs(dp - dn);
  const mean = (dp + dn) / 2;

  if (isNear(dp, 2.0, 0.2) && isNear(dn, 2.0, 0.2)) {
    return {
      confidence: "medium",
      detail: "Bias levels resemble the classic Apple 500 mA divider signature.",
      label: "Apple 500 mA"
    };
  }

  if (isNear(dp, 2.0, 0.2) && isNear(dn, 2.7, 0.2)) {
    return {
      confidence: "medium",
      detail: "Bias levels resemble the Apple 1 A charging signature.",
      label: "Apple 1 A"
    };
  }

  if (isNear(dp, 2.7, 0.2) && isNear(dn, 2.0, 0.2)) {
    return {
      confidence: "medium",
      detail: "Bias levels resemble the Apple 2.1 A charging signature.",
      label: "Apple 2.1 A"
    };
  }

  if (isNear(dp, 2.7, 0.2) && isNear(dn, 2.7, 0.2)) {
    return {
      confidence: "medium",
      detail: "Bias levels resemble the Apple 2.4 A charging signature.",
      label: "Apple 2.4 A"
    };
  }

  if (delta <= 0.08 && mean >= 0.3 && mean <= 3.0) {
    return {
      confidence: "high",
      detail: "D+ and D- are nearly tied, which matches a dedicated charging port style short.",
      label: "DCP / shorted D+/D-"
    };
  }

  if (dp > 0.25 && dn > 0.25 && delta > 0.12) {
    return {
      confidence: "low",
      detail: "Both data lines are active but not shorted, which usually means data traffic or negotiation.",
      label: "Active data / negotiation"
    };
  }

  if (dp < 0.2 && dn < 0.2) {
    return {
      confidence: "low",
      detail: "Both data lines are close to 0 V, which usually means idle, floating, or unsupported signaling.",
      label: "Idle / floating"
    };
  }

  return {
    confidence: "low",
    detail: "The observed D+/D- levels do not map cleanly to a common USB charging signature.",
    label: "Unknown signature"
  };
}

function getTriggerValue(sample: Measurement, signal: TriggerSignal) {
  switch (signal) {
    case "dp":
      return sample.dp;
    case "dn":
      return sample.dn;
    case "vbus":
      return sample.voltage;
    case "ibus":
      return sample.current;
  }
}

function isNear(value: number, target: number, tolerance: number) {
  return Math.abs(value - target) <= tolerance;
}

function isProtocolSignalUnavailable(measurements: Measurement[]) {
  let hasExactZeroOnly = true;
  let hasLivePower = false;

  for (const measurement of measurements) {
    if (measurement.dp !== 0 || measurement.dn !== 0) {
      hasExactZeroOnly = false;
      break;
    }

    if (Math.abs(measurement.voltage) > 0.1 || Math.abs(measurement.current) > 0.01) {
      hasLivePower = true;
    }
  }

  return hasExactZeroOnly && hasLivePower;
}

function smoothProtocolDetections(detections: ProtocolDetection[]) {
  if (detections.length < 3) {
    return detections;
  }

  const smoothed = detections.slice();
  for (let index = 1; index < detections.length - 1; index += 1) {
    const previous = smoothed[index - 1];
    const current = smoothed[index];
    const next = detections[index + 1];

    if (previous.label === next.label && current.label !== previous.label) {
      smoothed[index] = previous;
    }
  }

  return smoothed;
}
