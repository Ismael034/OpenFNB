import { Box, Card, CardContent, Stack, Typography } from "@mui/material";

type MetricCardProps = {
  label: string;
  value: string;
  unit: string;
  accent: string;
  footnote: string;
};

export function MetricCard({ label, value, unit, accent, footnote }: MetricCardProps) {
  return (
    <Card sx={{ height: "100%", minWidth: 0 }}>
      <CardContent
        sx={{
          height: "100%",
          p: 2,
          "&:last-child": {
            pb: 2
          }
        }}
      >
        <Stack alignItems="flex-start" spacing={1.5} justifyContent="space-between" sx={{ height: "100%" }}>
          <Typography
            color="text.secondary"
            sx={{ textAlign: "left", textTransform: "uppercase", letterSpacing: 0.6 }}
            variant="caption"
          >
            {label}
          </Typography>
          <Box
            className="metric-value"
            sx={{
              alignItems: "baseline",
              color: accent,
              display: "flex",
              fontSize: { xs: 24, sm: 28 },
              fontWeight: 600,
              lineHeight: 1.1,
              minWidth: 0,
              overflowWrap: "anywhere",
              textAlign: "left"
            }}
          >
            <Box component="span">{value}</Box>
            <Typography component="span" sx={{ color: "text.secondary", ml: 1, fontSize: 14, lineHeight: 1 }}>
              {unit}
            </Typography>
          </Box>
          <Typography color="text.secondary" sx={{ textAlign: "left" }} variant="caption">
            {footnote}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
