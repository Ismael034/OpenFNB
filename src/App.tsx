import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AlertTitle,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip as MuiTooltip,
  Toolbar,
  Typography
} from "@mui/material";
import UsbRoundedIcon from "@mui/icons-material/UsbRounded";
import BluetoothRoundedIcon from "@mui/icons-material/BluetoothRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import FileUploadRoundedIcon from "@mui/icons-material/FileUploadRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SystemUpdateAltRoundedIcon from "@mui/icons-material/SystemUpdateAltRounded";
import { MetricCard } from "./components/MetricCard";
import { ProtocolAnalysisPanel } from "./components/ProtocolAnalysisPanel";
import { SessionTable } from "./components/SessionTable";
import { WaveformPanel } from "./components/WaveformPanel";
import { alpha } from "@mui/material/styles";
import { downloadCsv } from "./lib/csv";
import { downloadRecordBundle, importRecordBundle, snapshotRecord } from "./lib/records";
import type { TriggerDirection, TriggerSignal } from "./lib/protocolAnalysis";
import { DEFAULT_VISIBLE_SIGNALS, SIGNAL_DEFINITIONS, SIGNALS_BY_KEY, type SignalKey } from "./lib/signals";
import { useFirmwareUpgrade, type FirmwareUpgradePhase } from "./hooks/useFirmwareUpgrade";
import { useUsbMeter } from "./hooks/useUsbMeter";
import type { Measurement, RecordSlotKey, SavedRecord, SessionStats } from "./types";
import type { AppThemeMode } from "./theme";

const EMPTY_SAMPLE: Measurement = {
  timestampMs: Date.now(),
  sampleIndex: 0,
  voltage: 0,
  current: 0,
  power: 0,
  dp: 0,
  dn: 0,
  temperatureC: 0,
  temperatureEmaC: 0,
  energyWs: 0,
  capacityAs: 0
};

type ActiveSource = "live" | RecordSlotKey;
type PendingConnection = "bluetooth" | "usb" | null;

type AlarmThresholds = {
  vbus: number;
  ibus: number;
  pbus: number;
};

type AlarmKey = keyof AlarmThresholds;

const DEFAULT_CAPTURE_SAMPLES_PER_SECOND = 100;
const DEFAULT_TRIGGER_DIRECTION: TriggerDirection = "rising";
const DEFAULT_TRIGGER_HOLDOFF_MS = 250;
const DEFAULT_TRIGGER_SIGNAL: TriggerSignal = "dp";
const DEFAULT_TRIGGER_THRESHOLD = 0.6;
const DEFAULT_THRESHOLDS: AlarmThresholds = {
  vbus: 24,
  ibus: 7,
  pbus: 168
};
const STORAGE_KEYS = {
  captureRate: "openfnb-capture-rate",
  thresholdIbus: "openfnb-threshold-ibus",
  thresholdPbus: "openfnb-threshold-pbus",
  thresholdVbus: "openfnb-threshold-vbus",
  triggerDirection: "openfnb-trigger-direction",
  triggerHoldoff: "openfnb-trigger-holdoff",
  triggerSignal: "openfnb-trigger-signal",
  triggerThreshold: "openfnb-trigger-threshold",
  visibleSignals: "openfnb-visible-signals"
} as const;
const STATUS_CHIP_MIN_WIDTH = 92;
const CONNECTION_BUTTON_MIN_WIDTH = 128;
const ACTION_BUTTON_FRAME_SX = {
  alignItems: "center",
  display: "inline-flex",
  lineHeight: 0,
  minHeight: 40,
  verticalAlign: "middle"
};
const MOBILE_GRID_SX = {
  m: 0,
  width: "100%"
};

type SettingsDraft = {
  captureSamplesPerSecond: number;
  themeMode: AppThemeMode;
  thresholds: AlarmThresholds;
  visibleSignals: SignalKey[];
  triggerDirection: TriggerDirection;
  triggerHoldoffMs: number;
  triggerSignal: TriggerSignal;
  triggerThreshold: number;
};

type AppProps = {
  defaultThemeMode: AppThemeMode;
  onDefaultThemeModeChange: (mode: AppThemeMode) => void;
  onThemeModeChange: (mode: AppThemeMode) => void;
  themeMode: AppThemeMode;
};

export default function App({ defaultThemeMode, onDefaultThemeModeChange, onThemeModeChange, themeMode }: AppProps) {
  const {
    bluetoothSupported,
    browserSupported,
    connectWebBluetooth,
    status,
    error,
    measurements,
    latestMeasurement,
    sessionStartMs,
    paused,
    captureSamplesPerSecond,
    connectWebHid,
    disconnect,
    clearHistory,
    hidSupported,
    setCaptureSamplesPerSecond,
    togglePaused
  } = useUsbMeter();
  const { firmwareUpgrade, resetFirmwareUpgrade, startFirmwareUpgrade } = useFirmwareUpgrade();
  const [defaultVisibleSignals, setDefaultVisibleSignals] = useState<SignalKey[]>(() => loadVisibleSignalsDefault());
  const [visibleSignals, setVisibleSignals] = useState<SignalKey[]>(() => loadVisibleSignalsDefault());
  const [signalsAnchorEl, setSignalsAnchorEl] = useState<HTMLElement | null>(null);
  const [connectAnchorEl, setConnectAnchorEl] = useState<HTMLElement | null>(null);
  const [exportAnchorEl, setExportAnchorEl] = useState<HTMLElement | null>(null);
  const [activeSource, setActiveSource] = useState<ActiveSource>("live");
  const [records, setRecords] = useState<Partial<Record<RecordSlotKey, SavedRecord>>>({});
  const [defaultCaptureSamplesPerSecond, setDefaultCaptureSamplesPerSecond] = useState(() => loadCaptureRateDefault());
  const [defaultThresholds, setDefaultThresholds] = useState<AlarmThresholds>(() => loadThresholdDefaults());
  const [thresholds, setThresholds] = useState<AlarmThresholds>(() => loadThresholdDefaults());
  const [recordError, setRecordError] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection>(null);
  const [reconnectDialogOpen, setReconnectDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [defaultTriggerSignal, setDefaultTriggerSignal] = useState<TriggerSignal>(() => loadTriggerSignalDefault());
  const [defaultTriggerDirection, setDefaultTriggerDirection] = useState<TriggerDirection>(() => loadTriggerDirectionDefault());
  const [defaultTriggerThreshold, setDefaultTriggerThreshold] = useState(() => loadTriggerThresholdDefault());
  const [defaultTriggerHoldoffMs, setDefaultTriggerHoldoffMs] = useState(() => loadTriggerHoldoffDefault());
  const [triggerSignal, setTriggerSignal] = useState<TriggerSignal>(() => loadTriggerSignalDefault());
  const [triggerDirection, setTriggerDirection] = useState<TriggerDirection>(() => loadTriggerDirectionDefault());
  const [triggerThreshold, setTriggerThreshold] = useState(() => loadTriggerThresholdDefault());
  const [triggerHoldoffMs, setTriggerHoldoffMs] = useState(() => loadTriggerHoldoffDefault());
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const firmwareInputRef = useRef<HTMLInputElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousAlarmSignatureRef = useRef("");
  const [firmwareDialogOpen, setFirmwareDialogOpen] = useState(false);
  const [firmwareDevice, setFirmwareDevice] = useState<HIDDevice | null>(null);
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);

  const activeMeasurements = useMemo(() => {
    if (activeSource === "live") {
      return measurements;
    }

    return records[activeSource]?.measurements ?? [];
  }, [activeSource, measurements, records]);
  const latestLive = latestMeasurement ?? EMPTY_SAMPLE;
  const latest = activeMeasurements.length > 0 ? activeMeasurements[activeMeasurements.length - 1] : EMPTY_SAMPLE;
  const stats = useMemo(() => buildSessionStats(activeMeasurements), [activeMeasurements]);
  const liveAlarms = useMemo(() => buildAlarms(latestLive, thresholds), [latestLive, thresholds]);
  const signalCards = visibleSignals.map((key) => buildSignalCard(key, latest, stats));
  const signalMenuOpen = Boolean(signalsAnchorEl);
  const connectMenuOpen = Boolean(connectAnchorEl);
  const exportMenuOpen = Boolean(exportAnchorEl);
  const isConnected = status === "live";
  const hasExportableCsv = activeMeasurements.length > 0;
  const exportableRecords = useMemo(
    () => buildExportableRecords(records, activeSource, activeMeasurements),
    [records, activeSource, activeMeasurements]
  );
  const hasExportableRecords = Boolean(exportableRecords.main || exportableRecords.aux);
  const firmwareBusy = isFirmwareUpgradeBusy(firmwareUpgrade.phase);
  const firmwareDialogLocked = Boolean(firmwareDevice) && firmwareUpgrade.phase !== "done" && firmwareUpgrade.phase !== "error";
  const waveformStartMs =
    activeSource === "live" ? sessionStartMs ?? activeMeasurements[0]?.timestampMs ?? null : activeMeasurements[0]?.timestampMs ?? null;

  useEffect(() => {
    const signature = liveAlarms.map((alarm) => alarm.key).join("|");
    if (!signature || signature === previousAlarmSignatureRef.current) {
      previousAlarmSignatureRef.current = signature;
      return;
    }

    previousAlarmSignatureRef.current = signature;
    playAlarmTone(audioContextRef);
  }, [liveAlarms]);

  useEffect(() => {
    if (activeSource === "live") {
      return;
    }

    if (!records[activeSource]) {
      setActiveSource("live");
    }
  }, [activeSource, records]);

  useEffect(() => {
    if (defaultCaptureSamplesPerSecond !== captureSamplesPerSecond) {
      setCaptureSamplesPerSecond(defaultCaptureSamplesPerSecond);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.captureRate, String(defaultCaptureSamplesPerSecond));
    window.localStorage.setItem(STORAGE_KEYS.thresholdVbus, String(defaultThresholds.vbus));
    window.localStorage.setItem(STORAGE_KEYS.thresholdIbus, String(defaultThresholds.ibus));
    window.localStorage.setItem(STORAGE_KEYS.thresholdPbus, String(defaultThresholds.pbus));
    window.localStorage.setItem(STORAGE_KEYS.triggerSignal, defaultTriggerSignal);
    window.localStorage.setItem(STORAGE_KEYS.triggerDirection, defaultTriggerDirection);
    window.localStorage.setItem(STORAGE_KEYS.triggerThreshold, String(defaultTriggerThreshold));
    window.localStorage.setItem(STORAGE_KEYS.triggerHoldoff, String(defaultTriggerHoldoffMs));
    window.localStorage.setItem(STORAGE_KEYS.visibleSignals, JSON.stringify(defaultVisibleSignals));
  }, [
    defaultCaptureSamplesPerSecond,
    defaultThresholds,
    defaultTriggerDirection,
    defaultTriggerHoldoffMs,
    defaultTriggerSignal,
    defaultTriggerThreshold,
    defaultVisibleSignals
  ]);

function openSettings() {
    setSettingsDraft(
      buildSettingsDraft({
        captureSamplesPerSecond: defaultCaptureSamplesPerSecond,
        themeMode: defaultThemeMode,
        thresholds: defaultThresholds,
        triggerDirection: defaultTriggerDirection,
        triggerHoldoffMs: defaultTriggerHoldoffMs,
        triggerSignal: defaultTriggerSignal,
        triggerThreshold: defaultTriggerThreshold,
        visibleSignals: defaultVisibleSignals
      })
    );
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
    setSettingsDraft(null);
  }

  function saveSettings() {
    if (!settingsDraft) {
      closeSettings();
      return;
    }

    onDefaultThemeModeChange(settingsDraft.themeMode);
    onThemeModeChange(settingsDraft.themeMode);
    setDefaultCaptureSamplesPerSecond(settingsDraft.captureSamplesPerSecond);
    setCaptureSamplesPerSecond(settingsDraft.captureSamplesPerSecond);
    setDefaultTriggerSignal(settingsDraft.triggerSignal);
    setTriggerSignal(settingsDraft.triggerSignal);
    setDefaultTriggerDirection(settingsDraft.triggerDirection);
    setTriggerDirection(settingsDraft.triggerDirection);
    setDefaultTriggerThreshold(settingsDraft.triggerThreshold);
    setTriggerThreshold(settingsDraft.triggerThreshold);
    setDefaultTriggerHoldoffMs(settingsDraft.triggerHoldoffMs);
    setTriggerHoldoffMs(settingsDraft.triggerHoldoffMs);
    setDefaultThresholds(settingsDraft.thresholds);
    setThresholds(settingsDraft.thresholds);
    setDefaultVisibleSignals(settingsDraft.visibleSignals);
    setVisibleSignals(settingsDraft.visibleSignals);
    closeSettings();
  }

  const handleConnectClick = async (transport: Exclude<PendingConnection, null>) => {
    if (isConnected) {
      await disconnect();
      return;
    }

    if (measurements.length > 0) {
      setPendingConnection(transport);
      setReconnectDialogOpen(true);
      return;
    }

    if (transport === "bluetooth") {
      await connectWebBluetooth();
      return;
    }

    await connectUsbDevice();
  };

  const openConnectMenu = (event: MouseEvent<HTMLElement>) => {
    setConnectAnchorEl(event.currentTarget);
  };

  const handleConnectMenuSelection = async (transport: Exclude<PendingConnection, null>) => {
    setConnectAnchorEl(null);
    await handleConnectClick(transport);
  };

  const confirmReconnect = async () => {
    setReconnectDialogOpen(false);
    const transport = pendingConnection;
    setPendingConnection(null);
    if (transport === "bluetooth") {
      await connectWebBluetooth();
      return;
    }

    await connectUsbDevice();
  };

  const openFirmwareDialogForDevice = (device: HIDDevice) => {
    resetFirmwareUpgrade();
    setFirmwareDevice(device);
    setFirmwareFile(null);
    setFirmwareDialogOpen(true);
  };

  const closeFirmwareDialog = () => {
    if (firmwareBusy || firmwareDialogLocked) {
      return;
    }

    setFirmwareDevice(null);
    setFirmwareDialogOpen(false);
  };

  const handleFirmwareFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFirmwareFile(file);
    resetFirmwareUpgrade();
    event.target.value = "";
  };

  const startSelectedFirmwareUpgrade = async () => {
    if (!firmwareFile || firmwareBusy) {
      return;
    }

    if (isConnected) {
      await disconnect();
    }

    await startFirmwareUpgrade(firmwareFile, { device: firmwareDevice ?? undefined });
  };

  const connectUsbDevice = async () => {
    const result = await connectWebHid();
    if (result.type === "bootloader") {
      openFirmwareDialogForDevice(result.device);
    }
  };

  return (
    <Box sx={{ backgroundColor: "background.default", minHeight: "100vh", overflowX: "hidden", width: "100%" }}>
      <AppBar
        color="transparent"
        elevation={0}
        position="sticky"
        sx={{ backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <Toolbar sx={{ minHeight: "56px !important", px: { xs: 1.5, sm: 3 } }}>
          <Stack
            alignItems="center"
            direction="row"
            justifyContent="space-between"
            spacing={{ xs: 1, sm: 2 }}
            sx={{ minWidth: 0, width: "100%" }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3">OpenFNB</Typography>
            </Box>
            <Stack alignItems="center" direction="row" spacing={0.5} sx={{ flexShrink: 0, minWidth: { xs: 0, sm: 172 } }}>
              <Chip
                color={status === "error" ? "error" : isConnected ? "success" : "default"}
                label={isConnected ? "Connected" : status === "connecting" ? "Connecting" : "Idle"}
                size="small"
                sx={{ justifyContent: "center", minWidth: STATUS_CHIP_MIN_WIDTH }}
                variant="outlined"
              />
              <MuiTooltip title={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
                <IconButton
                  aria-label={themeMode === "dark" ? "switch to light theme" : "switch to dark theme"}
                  onClick={() => onThemeModeChange(themeMode === "dark" ? "light" : "dark")}
                  size="small"
                >
                  {themeMode === "dark" ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
                </IconButton>
              </MuiTooltip>
              <MuiTooltip title="Settings">
                <IconButton aria-label="open settings" onClick={openSettings} size="small">
                  <SettingsRoundedIcon fontSize="small" />
                </IconButton>
              </MuiTooltip>
            </Stack>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ pb: { xs: 3, sm: 4 }, pt: { xs: 2, sm: 3 }, px: { xs: 1.5, sm: 3 } }}>
        <Stack spacing={{ xs: 2, sm: 3 }} sx={{ minWidth: 0 }}>
          <Grid container spacing={{ xs: 1.5, sm: 2.25 }} sx={MOBILE_GRID_SX}>
            <Grid item xs={12}>
              <Card>
                <CardContent sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Box
                      sx={{
                        alignItems: { xs: "stretch", lg: "center" },
                        display: "flex",
                        flexDirection: { xs: "column", lg: "row" },
                        gap: { xs: 1.25, sm: 2 },
                        justifyContent: "space-between"
                      }}
                    >
                      <Stack
                        alignItems={{ xs: "stretch", md: "center" }}
                        direction={{ xs: "column", md: "row" }}
                        justifyContent="center"
                        spacing={1.25}
                        flexWrap="wrap"
                        sx={{ minHeight: 40 }}
                        useFlexGap
                      >
                        <MuiTooltip title={isConnected ? "Disconnect meter" : "Connect meter"}>
                          <Box component="span" sx={ACTION_BUTTON_FRAME_SX}>
                            {isConnected ? (
                              <Button
                                onClick={() => void disconnect()}
                                startIcon={<UsbRoundedIcon />}
                                sx={{ minWidth: CONNECTION_BUTTON_MIN_WIDTH }}
                                variant="contained"
                              >
                                Disconnect
                              </Button>
                            ) : (
                              <Button
                                disabled={(!hidSupported && !bluetoothSupported) || status === "connecting"}
                                endIcon={<KeyboardArrowDownRoundedIcon />}
                                onClick={openConnectMenu}
                                startIcon={<UsbRoundedIcon />}
                                sx={{ minWidth: CONNECTION_BUTTON_MIN_WIDTH }}
                                variant="contained"
                              >
                                Connect
                              </Button>
                            )}
                          </Box>
                        </MuiTooltip>
                      </Stack>
                      <Stack
                        alignItems="center"
                        direction="row"
                        justifyContent={{ xs: "flex-end", sm: "flex-start" }}
                        spacing={0.5}
                        sx={{ flexWrap: "wrap", minHeight: 40, rowGap: 0.5 }}
                        useFlexGap
                      >
                        <MuiTooltip title="Export">
                          <Box component="span" sx={ACTION_BUTTON_FRAME_SX}>
                            <IconButton
                              aria-label="export data"
                              disabled={!hasExportableCsv && !hasExportableRecords}
                              onClick={(event) => setExportAnchorEl(event.currentTarget)}
                              size="small"
                            >
                              <FileDownloadRoundedIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </MuiTooltip>
                        <MuiTooltip title="Import records">
                          <Box component="span" sx={ACTION_BUTTON_FRAME_SX}>
                            <IconButton aria-label="import records" onClick={() => importInputRef.current?.click()} size="small">
                              <FileUploadRoundedIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </MuiTooltip>
                        <MuiTooltip title="Clear data">
                          <Box component="span" sx={ACTION_BUTTON_FRAME_SX}>
                            <IconButton aria-label="clear data" onClick={clearHistory} size="small">
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </MuiTooltip>
                        <input
                          hidden
                          accept="application/json,.json"
                          onChange={(event) => void handleImport(event, setRecords, setActiveSource, setRecordError)}
                          ref={importInputRef}
                          type="file"
                        />
                        <input
                          hidden
                          accept=".ufn,.unf,application/octet-stream"
                          onChange={handleFirmwareFileChange}
                          ref={firmwareInputRef}
                          type="file"
                        />
                      </Stack>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Menu
            anchorEl={connectAnchorEl}
            disableScrollLock
            onClose={() => setConnectAnchorEl(null)}
            open={connectMenuOpen}
          >
            <MenuItem disabled={!hidSupported || status === "connecting"} onClick={() => void handleConnectMenuSelection("usb")}>
              <UsbRoundedIcon fontSize="small" sx={{ mr: 1 }} />
              USB
            </MenuItem>
            <MenuItem
              disabled={!bluetoothSupported || status === "connecting"}
              onClick={() => void handleConnectMenuSelection("bluetooth")}
            >
              <BluetoothRoundedIcon fontSize="small" sx={{ mr: 1 }} />
              Bluetooth
            </MenuItem>
          </Menu>

          <Menu
            anchorEl={exportAnchorEl}
            disableScrollLock
            onClose={() => setExportAnchorEl(null)}
            open={exportMenuOpen}
            slotProps={{ paper: { sx: { minWidth: 180 } } }}
          >
            <MenuItem
              disabled={!hasExportableCsv}
              onClick={() => {
                downloadCsv(activeMeasurements);
                setExportAnchorEl(null);
              }}
            >
              Export CSV
            </MenuItem>
            <MenuItem
              disabled={!hasExportableRecords}
              onClick={() => {
                downloadRecordBundle(exportableRecords);
                setExportAnchorEl(null);
              }}
            >
              Export records
            </MenuItem>
          </Menu>

          <Menu
            anchorEl={signalsAnchorEl}
            disableScrollLock
            onClose={() => setSignalsAnchorEl(null)}
            open={signalMenuOpen}
            slotProps={{ paper: { sx: { minWidth: 220 } } }}
          >
            {SIGNAL_DEFINITIONS.map((signal) => {
              const selected = visibleSignals.includes(signal.key);
              return (
                <MenuItem
                  key={signal.key}
                  onClick={() => toggleSignal(signal.key, setVisibleSignals)}
                  sx={{ color: selected ? signal.color : undefined }}
                >
                  <Stack alignItems="center" direction="row" justifyContent="space-between" sx={{ width: "100%" }}>
                    <Typography variant="body2">{signal.label}</Typography>
                    {selected ? <CheckRoundedIcon fontSize="small" /> : <Box sx={{ width: 20, height: 20 }} />}
                  </Stack>
                </MenuItem>
              );
            })}
          </Menu>

          <Grid container spacing={{ xs: 1.5, sm: 2.25 }} sx={MOBILE_GRID_SX}>
            <Grid item xs={12}>
              <Box
                sx={{
                  display: "grid",
                  gap: 2.25,
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(auto-fit, minmax(220px, 1fr))"
                  }
                }}
              >
                {signalCards.map((card) => (
                  <Box key={card.label} sx={{ minWidth: 0 }}>
                    <MetricCard
                      accent={card.accent}
                      footnote={card.footnote}
                      label={card.label}
                      unit={card.unit}
                      value={card.value}
                    />
                  </Box>
                ))}
              </Box>
            </Grid>
          </Grid>

          <Grid container alignItems="stretch" spacing={{ xs: 1.5, sm: 2.25 }} sx={MOBILE_GRID_SX}>
            <Grid item lg={9} xs={12}>
              <Stack spacing={2.25} sx={{ height: "100%" }}>
                <WaveformPanel
                  captureSamplesPerSecond={captureSamplesPerSecond}
                  measurements={activeMeasurements}
                  onClearCapture={clearHistory}
                  onTogglePaused={togglePaused}
                  onTriggerDirectionChange={setTriggerDirection}
                  onTriggerHoldoffMsChange={setTriggerHoldoffMs}
                  onTriggerSignalChange={setTriggerSignal}
                  onTriggerThresholdChange={setTriggerThreshold}
                  paused={paused}
                  timelineStartMs={waveformStartMs}
                  triggerDirection={triggerDirection}
                  triggerHoldoffMs={triggerHoldoffMs}
                  triggerSignal={triggerSignal}
                  triggerThreshold={triggerThreshold}
                  visibleSignals={visibleSignals}
                />
                <ProtocolAnalysisPanel measurements={activeMeasurements} />
                <SessionTable measurements={activeMeasurements} />
              </Stack>
            </Grid>
            <Grid item lg={3} xs={12}>
              <Card sx={{ height: "100%" }}>
                <CardContent sx={{ height: "100%" }}>
                  <Typography variant="h3">Session</Typography>
                  <Stack spacing={2} sx={{ mt: 2.5 }}>
                    <StatRow label="Source" value={sourceLabel(activeSource)} />
                    <StatRow label="D+" value={`${latest.dp.toFixed(3)} V`} />
                    <StatRow label="D-" value={`${latest.dn.toFixed(3)} V`} />
                    <StatRow label="NRG" value={`${(latest.energyWs / 3600).toFixed(6)} Wh`} />
                    <StatRow label="CAP" value={`${(latest.capacityAs / 3600).toFixed(6)} Ah`} />
                    <StatRow label="Samples" value={stats.sampleCount.toString()} />
                    <StatRow label="Elapsed" value={`${stats.elapsedSeconds.toFixed(1)} s`} />
                  </Stack>
                  <Divider sx={{ my: 3 }} />
                  <Typography variant="h3">View</Typography>
                  <Stack spacing={1.25} sx={{ mt: 2 }}>
                    <TextField
                      select
                      fullWidth
                      label="Capture/s"
                      onChange={(event) => setCaptureSamplesPerSecond(Number(event.target.value))}
                      SelectProps={{ MenuProps: { disableScrollLock: true } }}
                      size="small"
                      value={captureSamplesPerSecond}
                    >
                      {[1, 2, 5, 10, 20, 50, 100].map((rate) => (
                        <MenuItem key={rate} value={rate}>
                          {rate}
                        </MenuItem>
                      ))}
                    </TextField>
                    <MuiTooltip title="Select signals">
                      <Button
                        endIcon={<KeyboardArrowDownRoundedIcon />}
                        onClick={(event) => setSignalsAnchorEl(event.currentTarget)}
                        sx={{ justifyContent: "space-between" }}
                        variant="outlined"
                      >
                        Visible signals
                      </Button>
                    </MuiTooltip>
                  </Stack>
                  <Divider sx={{ my: 3 }} />
                  <Typography variant="h3">Thresholds</Typography>
                  <Stack spacing={1.25} sx={{ mt: 2 }}>
                    <ThresholdField
                      label="VBUS alarm"
                      onChange={(value) => updateThreshold("vbus", value, setThresholds)}
                      unit="V"
                      value={thresholds.vbus}
                    />
                    <ThresholdField
                      label="IBUS alarm"
                      onChange={(value) => updateThreshold("ibus", value, setThresholds)}
                      unit="A"
                      value={thresholds.ibus}
                    />
                    <ThresholdField
                      label="PBUS alarm"
                      onChange={(value) => updateThreshold("pbus", value, setThresholds)}
                      unit="W"
                      value={thresholds.pbus}
                    />
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Stack>
      </Container>

      <Box
        sx={{
          bottom: 16,
          left: 16,
          maxWidth: 420,
          pointerEvents: "none",
          position: "fixed",
          width: "calc(100vw - 32px)",
          zIndex: (theme) => theme.zIndex.snackbar
        }}
      >
        <Stack spacing={1.25}>
          {!browserSupported && (
            <Alert severity="warning" sx={{ pointerEvents: "auto" }} variant="filled">
              Use a Chromium-based browser on HTTPS or localhost for USB HID or Bluetooth access.
            </Alert>
          )}

          {error && (
            <Alert severity="error" sx={{ pointerEvents: "auto" }} variant="filled">
              <AlertTitle>{error.title}</AlertTitle>
              {error.message}
            </Alert>
          )}

          {recordError && (
            <Alert onClose={() => setRecordError(null)} severity="error" sx={{ pointerEvents: "auto" }} variant="filled">
              <AlertTitle>Record import failed</AlertTitle>
              {recordError}
            </Alert>
          )}

          {liveAlarms.length > 0 && (
            <Alert
              icon={<WarningAmberRoundedIcon />}
              severity="warning"
              sx={{ pointerEvents: "auto" }}
              variant="filled"
            >
              <AlertTitle>Threshold alarm</AlertTitle>
              {liveAlarms.map((alarm) => `${alarm.label} ${alarm.actual} > ${alarm.limit}`).join(" | ")}
            </Alert>
          )}

        </Stack>
      </Box>
      <Dialog
        fullWidth
        maxWidth="xs"
        onClose={() => {
          setReconnectDialogOpen(false);
          setPendingConnection(null);
        }}
        open={reconnectDialogOpen}
      >
        <DialogTitle>Start New Session?</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Connecting will clear the previous capture and start a new session.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReconnectDialogOpen(false)} variant="outlined">
            Cancel
          </Button>
          <Button onClick={() => void confirmReconnect()} variant="contained">
            OK
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        disableEscapeKeyDown={firmwareDialogLocked || firmwareBusy}
        fullWidth
        maxWidth="sm"
        onClose={closeFirmwareDialog}
        open={firmwareDialogOpen}
        PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: "calc(100% - 24px)", sm: "100%" } } }}
      >
        <DialogTitle>Firmware Upgrade</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Stack alignItems={{ xs: "stretch", sm: "center" }} direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <Button
                disabled={firmwareBusy}
                onClick={() => firmwareInputRef.current?.click()}
                startIcon={<FileUploadRoundedIcon />}
                variant="outlined"
              >
                Select file
              </Button>
              <Typography color={firmwareFile ? "text.primary" : "text.secondary"} variant="body2">
                {firmwareFile ? `${firmwareFile.name} (${formatBytes(firmwareFile.size)})` : "No firmware selected"}
              </Typography>
            </Stack>

            <Box>
              <Stack alignItems="center" direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="body2">{firmwareUpgrade.message}</Typography>
                <Typography className="metric-value" color="text.secondary" variant="body2">
                  {firmwareUpgrade.progress}%
                </Typography>
              </Stack>
              <LinearProgress
                sx={{ mt: 1 }}
                value={firmwareUpgrade.progress}
                variant={firmwareUpgrade.phase === "selecting" || firmwareUpgrade.phase === "erasing" ? "indeterminate" : "determinate"}
              />
            </Box>

            {firmwareUpgrade.totalChunks > 0 && (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Chip
                  label={`${firmwareUpgrade.chunksWritten}/${firmwareUpgrade.totalChunks} chunks`}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={`${formatBytes(firmwareUpgrade.bytesWritten)}/${formatBytes(firmwareUpgrade.totalBytes)}`}
                  size="small"
                  variant="outlined"
                />
                {firmwareUpgrade.deviceName && <Chip label={firmwareUpgrade.deviceName} size="small" variant="outlined" />}
              </Stack>
            )}

            {firmwareUpgrade.phase === "error" && firmwareUpgrade.error && (
              <Alert severity="error" variant="filled">
                {firmwareUpgrade.error}
              </Alert>
            )}

            {firmwareUpgrade.phase === "done" && (
              <Alert severity="success" variant="filled">
                Firmware upload completed.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={firmwareBusy || firmwareDialogLocked} onClick={closeFirmwareDialog} variant="outlined">
            Close
          </Button>
          <Button
            disabled={!firmwareFile || firmwareBusy || !hidSupported || firmwareUpgrade.phase === "done"}
            onClick={() => void startSelectedFirmwareUpgrade()}
            startIcon={<SystemUpdateAltRoundedIcon />}
            variant="contained"
          >
            Upgrade
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        fullWidth
        maxWidth="md"
        onClose={closeSettings}
        open={settingsOpen}
        PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: "calc(100% - 24px)", sm: "100%" } } }}
      >
        <DialogTitle>Settings</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={{ xs: 2, sm: 2.5 }} sx={MOBILE_GRID_SX}>
            <Grid item md={6} xs={12}>
              <Typography variant="h3">Appearance</Typography>
              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                <TextField
                  select
                  fullWidth
                  label="Default theme"
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, themeMode: event.target.value as AppThemeMode } : current
                    )
                  }
                  SelectProps={{ MenuProps: { disableScrollLock: true } }}
                  size="small"
                  value={settingsDraft?.themeMode ?? defaultThemeMode}
                >
                  <MenuItem value="dark">Dark</MenuItem>
                  <MenuItem value="light">Light</MenuItem>
                </TextField>
              </Stack>
            </Grid>

            <Grid item md={6} xs={12}>
              <Typography variant="h3">Capture</Typography>
              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                <TextField
                  select
                  fullWidth
                  label="Default capture/s"
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, captureSamplesPerSecond: Number(event.target.value) } : current
                    )
                  }
                  SelectProps={{ MenuProps: { disableScrollLock: true } }}
                  size="small"
                  value={settingsDraft?.captureSamplesPerSecond ?? defaultCaptureSamplesPerSecond}
                >
                  {[1, 2, 5, 10, 20, 50, 100].map((rate) => (
                    <MenuItem key={rate} value={rate}>
                      {rate}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Grid>

            <Grid item md={6} xs={12}>
              <Typography variant="h3">Trigger Defaults</Typography>
              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                <TextField
                  select
                  fullWidth
                  label="Default trigger signal"
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, triggerSignal: event.target.value as TriggerSignal } : current
                    )
                  }
                  SelectProps={{ MenuProps: { disableScrollLock: true } }}
                  size="small"
                  value={settingsDraft?.triggerSignal ?? defaultTriggerSignal}
                >
                  <MenuItem value="dp">D+</MenuItem>
                  <MenuItem value="dn">D-</MenuItem>
                  <MenuItem value="vbus">VBUS</MenuItem>
                  <MenuItem value="ibus">IBUS</MenuItem>
                </TextField>
                <TextField
                  select
                  fullWidth
                  label="Default edge"
                  onChange={(event) =>
                    setSettingsDraft((current) =>
                      current ? { ...current, triggerDirection: event.target.value as TriggerDirection } : current
                    )
                  }
                  SelectProps={{ MenuProps: { disableScrollLock: true } }}
                  size="small"
                  value={settingsDraft?.triggerDirection ?? defaultTriggerDirection}
                >
                  <MenuItem value="rising">Rising</MenuItem>
                  <MenuItem value="falling">Falling</MenuItem>
                </TextField>
                <TextField
                  fullWidth
                  label="Default threshold"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) {
                      setSettingsDraft((current) => (current ? { ...current, triggerThreshold: value } : current));
                    }
                  }}
                  size="small"
                  type="number"
                  value={settingsDraft?.triggerThreshold ?? defaultTriggerThreshold}
                />
                <TextField
                  fullWidth
                  label="Default holdoff ms"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value >= 0) {
                      setSettingsDraft((current) => (current ? { ...current, triggerHoldoffMs: value } : current));
                    }
                  }}
                  size="small"
                  type="number"
                  value={settingsDraft?.triggerHoldoffMs ?? defaultTriggerHoldoffMs}
                />
              </Stack>
            </Grid>

            <Grid item md={6} xs={12}>
              <Typography variant="h3">Default Active Signals</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mt: 1.5, rowGap: 1 }} useFlexGap>
                {SIGNAL_DEFINITIONS.map((signal) => {
                  const selected = settingsDraft?.visibleSignals.includes(signal.key) ?? defaultVisibleSignals.includes(signal.key);

                  return (
                    <Chip
                      key={signal.key}
                      icon={selected ? <CheckRoundedIcon fontSize="small" /> : undefined}
                      label={signal.label}
                      onClick={() =>
                        setSettingsDraft((current) =>
                          current
                            ? {
                                ...current,
                                visibleSignals: toggleSignalSelection(current.visibleSignals, signal.key)
                              }
                            : current
                        )
                      }
                      sx={{
                        backgroundColor: selected ? alpha(signal.color, themeMode === "dark" ? 0.22 : 0.16) : "transparent",
                        borderColor: signal.color,
                        color: selected ? signal.color : "text.secondary",
                        fontWeight: selected ? 600 : 400,
                        "& .MuiChip-icon": {
                          color: signal.color
                        }
                      }}
                      variant="outlined"
                    />
                  );
                })}
              </Stack>
            </Grid>

            <Grid item md={6} xs={12}>
              <Typography variant="h3">Thresholds</Typography>
              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                <ThresholdField
                  label="Default VBUS alarm"
                  onChange={(value) => updateThresholdDraft("vbus", value, setSettingsDraft)}
                  unit="V"
                  value={settingsDraft?.thresholds.vbus ?? defaultThresholds.vbus}
                />
                <ThresholdField
                  label="Default IBUS alarm"
                  onChange={(value) => updateThresholdDraft("ibus", value, setSettingsDraft)}
                  unit="A"
                  value={settingsDraft?.thresholds.ibus ?? defaultThresholds.ibus}
                />
                <ThresholdField
                  label="Default PBUS alarm"
                  onChange={(value) => updateThresholdDraft("pbus", value, setSettingsDraft)}
                  unit="W"
                  value={settingsDraft?.thresholds.pbus ?? defaultThresholds.pbus}
                />
              </Stack>
            </Grid>

          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSettingsDraft(buildDefaultSettingsDraft());
            }}
            variant="outlined"
          >
            Restore defaults
          </Button>
          <Button onClick={saveSettings} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function buildDefaultSettingsDraft(): SettingsDraft {
  return buildSettingsDraft({
    captureSamplesPerSecond: DEFAULT_CAPTURE_SAMPLES_PER_SECOND,
    themeMode: "light",
    thresholds: DEFAULT_THRESHOLDS,
    triggerDirection: DEFAULT_TRIGGER_DIRECTION,
    triggerHoldoffMs: DEFAULT_TRIGGER_HOLDOFF_MS,
    triggerSignal: DEFAULT_TRIGGER_SIGNAL,
    triggerThreshold: DEFAULT_TRIGGER_THRESHOLD,
    visibleSignals: DEFAULT_VISIBLE_SIGNALS
  });
}

function isFirmwareUpgradeBusy(phase: FirmwareUpgradePhase) {
  return phase === "reading" || phase === "selecting" || phase === "erasing" || phase === "uploading";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildSettingsDraft(settings: SettingsDraft): SettingsDraft {
  return {
    ...settings,
    thresholds: { ...settings.thresholds },
    visibleSignals: [...settings.visibleSignals]
  };
}

function loadCaptureRateDefault() {
  if (typeof window === "undefined") {
    return DEFAULT_CAPTURE_SAMPLES_PER_SECOND;
  }

  return loadNumberDefault(STORAGE_KEYS.captureRate, DEFAULT_CAPTURE_SAMPLES_PER_SECOND, (value) => value > 0);
}

function loadTriggerSignalDefault(): TriggerSignal {
  const saved = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEYS.triggerSignal);
  return saved === "dn" || saved === "vbus" || saved === "ibus" ? saved : DEFAULT_TRIGGER_SIGNAL;
}

function loadTriggerDirectionDefault(): TriggerDirection {
  const saved = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEYS.triggerDirection);
  return saved === "falling" ? "falling" : DEFAULT_TRIGGER_DIRECTION;
}

function loadTriggerThresholdDefault() {
  if (typeof window === "undefined") {
    return DEFAULT_TRIGGER_THRESHOLD;
  }

  return loadNumberDefault(STORAGE_KEYS.triggerThreshold, DEFAULT_TRIGGER_THRESHOLD);
}

function loadTriggerHoldoffDefault() {
  if (typeof window === "undefined") {
    return DEFAULT_TRIGGER_HOLDOFF_MS;
  }

  return loadNumberDefault(STORAGE_KEYS.triggerHoldoff, DEFAULT_TRIGGER_HOLDOFF_MS, (value) => value >= 0);
}

function loadThresholdDefaults(): AlarmThresholds {
  if (typeof window === "undefined") {
    return DEFAULT_THRESHOLDS;
  }

  return {
    vbus: loadNumberDefault(STORAGE_KEYS.thresholdVbus, DEFAULT_THRESHOLDS.vbus),
    ibus: loadNumberDefault(STORAGE_KEYS.thresholdIbus, DEFAULT_THRESHOLDS.ibus),
    pbus: loadNumberDefault(STORAGE_KEYS.thresholdPbus, DEFAULT_THRESHOLDS.pbus)
  };
}

function loadNumberDefault(key: string, fallback: number, isValid: (value: number) => boolean = () => true) {
  const saved = window.localStorage.getItem(key);
  if (saved === null) {
    return fallback;
  }

  const value = Number(saved);
  return Number.isFinite(value) && isValid(value) ? value : fallback;
}

function loadVisibleSignalsDefault(): SignalKey[] {
  if (typeof window === "undefined") {
    return DEFAULT_VISIBLE_SIGNALS;
  }

  const saved = window.localStorage.getItem(STORAGE_KEYS.visibleSignals);
  if (!saved) {
    return DEFAULT_VISIBLE_SIGNALS;
  }

  try {
    const parsed = JSON.parse(saved) as string[];
    const next = parsed.filter((value): value is SignalKey => SIGNAL_DEFINITIONS.some((signal) => signal.key === value));
    return next.length > 0 ? next : DEFAULT_VISIBLE_SIGNALS;
  } catch {
    return DEFAULT_VISIBLE_SIGNALS;
  }
}

function buildExportableRecords(
  records: Partial<Record<RecordSlotKey, SavedRecord>>,
  activeSource: ActiveSource,
  activeMeasurements: Measurement[]
): Partial<Record<RecordSlotKey, SavedRecord>> {
  const nextRecords: Partial<Record<RecordSlotKey, SavedRecord>> = { ...records };
  if (activeMeasurements.length === 0) {
    return nextRecords;
  }

  if (activeSource === "aux") {
    nextRecords.aux = snapshotRecord("aux", activeMeasurements);
    return nextRecords;
  }

  nextRecords.main = snapshotRecord("main", activeMeasurements);
  return nextRecords;
}

function updateThresholdDraft(
  key: AlarmKey,
  value: string,
  setSettingsDraft: React.Dispatch<React.SetStateAction<SettingsDraft | null>>
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return;
  }

  setSettingsDraft((current) =>
    current
      ? {
          ...current,
          thresholds: {
            ...current.thresholds,
            [key]: parsed
          }
        }
      : current
  );
}

function toggleSignalSelection(selected: SignalKey[], key: SignalKey) {
  if (selected.includes(key)) {
    return selected.length === 1 ? selected : selected.filter((item) => item !== key);
  }

  return [...selected, key];
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack alignItems="center" direction="row" justifyContent="space-between" spacing={2}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography className="metric-value" sx={{ textAlign: "right" }} variant="body2">
        {value}
      </Typography>
    </Stack>
  );
}

function ThresholdField({
  label,
  value,
  unit,
  onChange
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      fullWidth
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Typography color="text.secondary" variant="caption">
              {unit}
            </Typography>
          </InputAdornment>
        )
      }}
      label={label}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      type="number"
      value={value}
    />
  );
}

function toggleSignal(key: SignalKey, setSelected: React.Dispatch<React.SetStateAction<SignalKey[]>>) {
  setSelected((current) => toggleSignalSelection(current, key));
}

async function handleImport(
  event: ChangeEvent<HTMLInputElement>,
  setRecords: React.Dispatch<React.SetStateAction<Partial<Record<RecordSlotKey, SavedRecord>>>>,
  setActiveSource: React.Dispatch<React.SetStateAction<ActiveSource>>,
  setRecordError: React.Dispatch<React.SetStateAction<string | null>>
) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const imported = await importRecordBundle(file);
    setRecords(imported);
    setActiveSource(imported.main ? "main" : imported.aux ? "aux" : "live");
    setRecordError(null);
  } catch (error) {
    setRecordError(error instanceof Error ? error.message : "The selected file could not be parsed.");
  } finally {
    event.target.value = "";
  }
}

function sourceLabel(source: ActiveSource): string {
  switch (source) {
    case "main":
      return "Main record";
    case "aux":
      return "Aux record";
    default:
      return "Live";
  }
}

function updateThreshold(
  key: AlarmKey,
  rawValue: string,
  setThresholds: React.Dispatch<React.SetStateAction<AlarmThresholds>>
) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }

  setThresholds((current) => ({
    ...current,
    [key]: parsed
  }));
}

function buildAlarms(measurement: Measurement, thresholds: AlarmThresholds) {
  const alarms: Array<{ key: AlarmKey; label: string; actual: string; limit: string }> = [];

  if (measurement.voltage > thresholds.vbus) {
    alarms.push({
      key: "vbus",
      label: "VBUS",
      actual: `${measurement.voltage.toFixed(2)}V`,
      limit: `${thresholds.vbus.toFixed(2)}V`
    });
  }

  if (measurement.current > thresholds.ibus) {
    alarms.push({
      key: "ibus",
      label: "IBUS",
      actual: `${measurement.current.toFixed(2)}A`,
      limit: `${thresholds.ibus.toFixed(2)}A`
    });
  }

  if (measurement.power > thresholds.pbus) {
    alarms.push({
      key: "pbus",
      label: "PBUS",
      actual: `${measurement.power.toFixed(2)}W`,
      limit: `${thresholds.pbus.toFixed(2)}W`
    });
  }

  return alarms;
}

function buildSignalCard(key: SignalKey, latest: Measurement, stats: SessionStats) {
  const signal = SIGNALS_BY_KEY[key];
  const value = signal.accessor(latest);

  return {
    label: signal.label,
    unit: signal.unit,
    accent: signal.color,
    value: value.toFixed(signal.decimals),
    footnote: buildSignalFootnote(key, stats, latest)
  };
}

function buildSignalFootnote(key: SignalKey, stats: SessionStats, latest: Measurement): string {
  switch (key) {
    case "vbus":
      return `Peak ${stats.peakVoltage.toFixed(3)} V`;
    case "ibus":
      return `Peak ${stats.peakCurrent.toFixed(3)} A`;
    case "pbus":
      return `Average ${stats.avgPower.toFixed(3)} W`;
    case "dp":
      return `Latest ${latest.dp.toFixed(3)} V`;
    case "dn":
      return `Latest ${latest.dn.toFixed(3)} V`;
    case "cap":
      return `${stats.sampleCount} samples`;
    case "nrg":
      return `${stats.elapsedSeconds.toFixed(1)} s elapsed`;
  }
}

function buildSessionStats(measurements: Measurement[]): SessionStats {
  if (measurements.length === 0) {
    return {
      elapsedSeconds: 0,
      sampleCount: 0,
      peakVoltage: 0,
      peakCurrent: 0,
      peakPower: 0,
      avgPower: 0
    };
  }

  const first = measurements[0];
  const last = measurements[measurements.length - 1];
  const peakVoltage = Math.max(...measurements.map((item) => item.voltage));
  const peakCurrent = Math.max(...measurements.map((item) => item.current));
  const peakPower = Math.max(...measurements.map((item) => item.power));
  const avgPower = measurements.reduce((sum, item) => sum + item.power, 0) / measurements.length;

  return {
    elapsedSeconds: (last.timestampMs - first.timestampMs) / 1000,
    sampleCount: measurements.length,
    peakVoltage,
    peakCurrent,
    peakPower,
    avgPower
  };
}

function playAlarmTone(audioContextRef: React.MutableRefObject<AudioContext | null>) {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return;
  }

  const context = audioContextRef.current ?? new AudioCtx();
  audioContextRef.current = context;

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 1046;
  gainNode.gain.setValueAtTime(0.0001, context.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}
