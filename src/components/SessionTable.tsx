import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import type { Measurement } from "../types";

type SessionTableProps = {
  measurements: Measurement[];
};

export function SessionTable({ measurements }: SessionTableProps) {
  const rows = [...measurements].slice(-12).reverse();

  return (
    <Card sx={{ minWidth: 0 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
        <Typography variant="h3">Recent samples</Typography>
        <TableContainer sx={{ maxWidth: "100%", mt: 2, overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell align="right">V</TableCell>
                <TableCell align="right">A</TableCell>
                <TableCell align="right">W</TableCell>
                <TableCell align="right">D+</TableCell>
                <TableCell align="right">D-</TableCell>
                <TableCell align="right">Temp</TableCell>
                <TableCell align="right">NRG</TableCell>
                <TableCell align="right">CAP</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow hover key={`${row.timestampMs}-${row.sampleIndex}`}>
                  <TableCell className="metric-value">{formatSampleTime(row.timestampMs)}</TableCell>
                  <TableCell align="right" className="metric-value">
                    {row.voltage.toFixed(4)}
                  </TableCell>
                  <TableCell align="right" className="metric-value">
                    {row.current.toFixed(4)}
                  </TableCell>
                  <TableCell align="right" className="metric-value">
                    {row.power.toFixed(4)}
                  </TableCell>
                  <TableCell align="right" className="metric-value">
                    {row.dp.toFixed(3)}
                  </TableCell>
                  <TableCell align="right" className="metric-value">
                    {row.dn.toFixed(3)}
                  </TableCell>
                  <TableCell align="right" className="metric-value">
                    {row.temperatureEmaC.toFixed(1)}°C
                  </TableCell>
                  <TableCell align="right" className="metric-value">
                    {(row.energyWs / 3600).toFixed(6)}
                  </TableCell>
                  <TableCell align="right" className="metric-value">
                    {(row.capacityAs / 3600).toFixed(6)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

function formatSampleTime(timestampMs: number) {
  const date = new Date(timestampMs);
  return `${date.toLocaleTimeString("en-GB", { hour12: false })}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}
