import { Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import { analyzeProtocolSession } from "../lib/protocolAnalysis";
import type { Measurement } from "../types";

type ProtocolAnalysisPanelProps = {
  measurements: Measurement[];
};

export function ProtocolAnalysisPanel({ measurements }: ProtocolAnalysisPanelProps) {
  const summary = analyzeProtocolSession(measurements);

  return (
    <Card>
      <CardContent>
        <Typography variant="h3">Protocol analysis</Typography>
        {!summary ? (
          <Typography color="text.secondary" sx={{ mt: 2 }} variant="body2">
            Capture data to inspect D+/D- charging signatures and protocol transitions.
          </Typography>
        ) : summary.availability === "unavailable" ? (
          <Stack spacing={1.5} sx={{ mt: 2.25 }}>
            <Chip label={summary.current.label} size="small" variant="outlined" />
            <Typography color="text.secondary" variant="body2">
              {summary.message}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 2.25 }}>
            <Stack alignItems={{ xs: "flex-start", md: "center" }} direction={{ xs: "column", md: "row" }} spacing={1}>
              <Chip label={`Current: ${summary.current.label}`} size="small" variant="outlined" />
              {summary.dominant ? <Chip label={`Session: ${summary.dominant.label}`} size="small" variant="outlined" /> : null}
            </Stack>

            <Typography color="text.secondary" variant="body2">
              {summary.current.detail}
            </Typography>

            <Divider />

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Metric label="D+ avg" value={`${summary.dpAverage.toFixed(3)} V`} />
              <Metric label="D- avg" value={`${summary.dnAverage.toFixed(3)} V`} />
              <Metric label="Shorted share" value={`${(summary.shortedShare * 100).toFixed(0)}%`} />
            </Stack>

            <Divider />

            <Stack spacing={1}>
              <Typography color="text.secondary" variant="body2">
                Recent protocol transitions
              </Typography>
              {summary.transitions.map((transition, index) => (
                <Stack
                  key={`${transition.label}-${transition.atSeconds}-${index}`}
                  alignItems="center"
                  direction="row"
                  justifyContent="space-between"
                  spacing={2}
                >
                  <Typography variant="body2">{transition.label}</Typography>
                  <Typography className="metric-value" color="text.secondary" variant="body2">
                    +{transition.atSeconds.toFixed(2)} s
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography className="metric-value" variant="body2">
        {value}
      </Typography>
    </Stack>
  );
}
