import { Box, Button, Card, CardContent, FormControlLabel, IconButton, Menu, MenuItem, Stack, Switch, TextField, Tooltip as MuiTooltip, Typography } from "@mui/material";
import KeyboardArrowLeftRoundedIcon from "@mui/icons-material/KeyboardArrowLeftRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import GpsFixedRoundedIcon from "@mui/icons-material/GpsFixedRounded";
import { alpha, useTheme } from "@mui/material/styles";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { findTriggerEvents, type TriggerConfig, type TriggerDirection, type TriggerEvent, type TriggerSignal } from "../lib/protocolAnalysis";
import { SIGNALS_BY_KEY, type SignalKey, type SignalUnit } from "../lib/signals";
import type { Measurement } from "../types";

const DEFAULT_VISIBLE_WINDOW_MS = 10_000;
const DRAG_THRESHOLD_PX = 6;
const NAVIGATOR_HEIGHT = 38;
const NAVIGATOR_VIEWBOX_WIDTH = 1000;
const NAVIGATOR_PADDING_X = 0;
const NAVIGATOR_PADDING_Y = 0;
const NAVIGATOR_HANDLE_WIDTH = 14;
const NAVIGATOR_MIN_WINDOW_S = 0.1;
const WAVEFORM_Y_AXIS_WIDTH = 56;
const WAVEFORM_X_AXIS_HEIGHT = 28;
const Y_AXIS_EXPAND_MARGIN = 0.15;
const Y_AXIS_PADDING_RATIO = 0.16;

type WaveformPanelProps = {
  captureSamplesPerSecond: number;
  measurements: Measurement[];
  onClearCapture: () => void;
  onTogglePaused: () => void;
  paused: boolean;
  timelineStartMs: number | null;
  onTriggerDirectionChange: (direction: TriggerDirection) => void;
  onTriggerHoldoffMsChange: (holdoffMs: number) => void;
  onTriggerSignalChange: (signal: TriggerSignal) => void;
  onTriggerThresholdChange: (threshold: number) => void;
  triggerDirection: TriggerDirection;
  triggerHoldoffMs: number;
  triggerSignal: TriggerSignal;
  triggerThreshold: number;
  visibleSignals: SignalKey[];
};

type ChartPoint = { t: number } & Record<SignalKey, number>;
type TriggerAction = "clear" | "jump" | "mark" | "pause";

export function WaveformPanel({
  captureSamplesPerSecond,
  measurements,
  onClearCapture,
  onTogglePaused,
  paused,
  timelineStartMs,
  onTriggerDirectionChange,
  onTriggerHoldoffMsChange,
  onTriggerSignalChange,
  onTriggerThresholdChange,
  triggerDirection,
  triggerHoldoffMs,
  triggerSignal,
  triggerThreshold,
  visibleSignals
}: WaveformPanelProps) {
  const theme = useTheme();
  const chartBackground = theme.palette.background.paper;
  const gridStroke = alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.14 : 0.18);
  const helperLineStroke = alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.28 : 0.34);
  const axisStroke = alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.18 : 0.24);
  const sampledMeasurements = useMemo(
    () => downsampleMeasurements(measurements, captureSamplesPerSecond),
    [captureSamplesPerSecond, measurements]
  );
  const firstTimestamp = timelineStartMs ?? sampledMeasurements[0]?.timestampMs ?? Date.now();
  const chartData = useMemo<ChartPoint[]>(
    () =>
      sampledMeasurements.map((sample) => {
        const values = Object.fromEntries(
          visibleSignals.map((key) => {
            const signal = SIGNALS_BY_KEY[key];
            return [key, Number(signal.accessor(sample).toFixed(signal.decimals))];
          })
        ) as Partial<Record<SignalKey, number>>;

        return {
          t: (sample.timestampMs - firstTimestamp) / 1000,
          dp: values.dp ?? 0,
          dn: values.dn ?? 0,
          vbus: values.vbus ?? 0,
          ibus: values.ibus ?? 0,
          pbus: values.pbus ?? 0,
          cap: values.cap ?? 0,
          nrg: values.nrg ?? 0
        };
      }),
    [firstTimestamp, sampledMeasurements, visibleSignals]
  );
  const units = useMemo(() => [...new Set(visibleSignals.map((key) => SIGNALS_BY_KEY[key].unit))], [visibleSignals]);
  const [yAxisDomains, setYAxisDomains] = useState<Partial<Record<SignalUnit, [number, number]>>>({});
  const [followTime, setFollowTime] = useState(true);
  const [followWindowMs, setFollowWindowMs] = useState(DEFAULT_VISIBLE_WINDOW_MS);
  const [manualDomain, setManualDomain] = useState<{ start: number; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [triggerEnabled, setTriggerEnabled] = useState(false);
  const [triggerEvents, setTriggerEvents] = useState<TriggerEvent[]>([]);
  const [triggerAction, setTriggerAction] = useState<TriggerAction>("jump");
  const [lastTriggerEvent, setLastTriggerEvent] = useState<TriggerEvent | null>(null);
  const [triggerSingleShot, setTriggerSingleShot] = useState(false);
  const [triggerMenuAnchorEl, setTriggerMenuAnchorEl] = useState<HTMLElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startDomain: { start: number; end: number }; moved: boolean } | null>(null);
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const hoverLineRef = useRef<HTMLDivElement | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverTimeRef = useRef<HTMLSpanElement | null>(null);
  const hoverValueRefs = useRef<Partial<Record<SignalKey, HTMLSpanElement | null>>>({});
  const panAnimationFrameRef = useRef<number | null>(null);
  const pendingPanClientXRef = useRef<number | null>(null);
  const hoverAnimationFrameRef = useRef<number | null>(null);
  const pendingHoverPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const triggerScanIndexRef = useRef(1);
  const triggerLastAtRef = useRef(-Infinity);
  const defaultWindow = useMemo(() => buildDefaultWindow(sampledMeasurements), [sampledMeasurements]);
  const defaultDomain = useMemo(() => domainFromWindow(chartData, defaultWindow), [chartData, defaultWindow]);
  const triggerConfig = useMemo<TriggerConfig>(
    () => ({
      direction: triggerDirection,
      holdoffMs: triggerHoldoffMs,
      signal: triggerSignal,
      threshold: triggerThreshold
    }),
    [triggerDirection, triggerHoldoffMs, triggerSignal, triggerThreshold]
  );
  const visibleDomain = useMemo(() => {
    if (followTime) {
      return buildFollowDomain(chartData, followWindowMs);
    }

    return clampDomainToData(manualDomain ?? defaultDomain, chartData);
  }, [chartData, defaultDomain, followTime, followWindowMs, manualDomain]);
  const effectiveWindow = useMemo(() => domainToWindow(chartData, visibleDomain), [chartData, visibleDomain]);
  const visibleChartData = useMemo(() => sliceWindow(chartData, effectiveWindow, 2), [chartData, effectiveWindow]);
  const visibleTriggerEvents = useMemo(
    () =>
      triggerEvents.filter((event) => {
        const eventSeconds = (event.timestampMs - firstTimestamp) / 1000;
        return event.signal === triggerSignal && eventSeconds >= visibleDomain.start && eventSeconds <= visibleDomain.end;
      }),
    [firstTimestamp, triggerEvents, triggerSignal, visibleDomain.end, visibleDomain.start]
  );
  const visibleTriggerMarkers = useMemo(
    () =>
      visibleTriggerEvents.map((event) => ({
        t: (event.timestampMs - firstTimestamp) / 1000,
        value: event.value
      })),
    [firstTimestamp, visibleTriggerEvents]
  );
  const navigatorSignals = useMemo(() => visibleSignals.slice(0, Math.min(visibleSignals.length, 2)), [visibleSignals]);
  const navigatorInsets = useMemo(
    () => ({
      left: WAVEFORM_Y_AXIS_WIDTH,
      right: units.length > 1 ? WAVEFORM_Y_AXIS_WIDTH : 0
    }),
    [units.length]
  );
  const hasChartData = chartData.length > 0;
  const triggerMenuOpen = Boolean(triggerMenuAnchorEl);

  useEffect(() => {
    setYAxisDomains(buildInitialYAxisDomains(chartData, visibleSignals));
  }, [visibleSignals]);

  useEffect(() => {
    const nextDomains = expandYAxisDomains(yAxisDomains, chartData, visibleSignals);
    if (nextDomains !== yAxisDomains) {
      setYAxisDomains(nextDomains);
    }
  }, [chartData, visibleSignals, yAxisDomains]);

  const hideHoverOverlay = () => {
    if (hoverLineRef.current) {
      hoverLineRef.current.style.display = "none";
    }

    if (hoverTooltipRef.current) {
      hoverTooltipRef.current.style.display = "none";
    }
  };

  const updateHoveredPointFromClientPosition = (clientX: number) => {
    const element = chartViewportRef.current;
    if (!element || visibleChartData.length === 0) {
      return;
    }

    const bounds = element.getBoundingClientRect();
    const plotLeft = WAVEFORM_Y_AXIS_WIDTH;
    const plotRight = units.length > 1 ? WAVEFORM_Y_AXIS_WIDTH : 0;
    const plotWidth = Math.max(1, bounds.width - plotLeft - plotRight);
    const relativeX = (clientX - bounds.left - plotLeft) / plotWidth;
    const ratio = Math.min(1, Math.max(0, relativeX));
    const targetTime = visibleDomain.start + (visibleDomain.end - visibleDomain.start) * ratio;
    const hoveredPoint = visibleChartData[findNearestPointIndex(visibleChartData, targetTime)];
    if (!hoveredPoint) {
      hideHoverOverlay();
      return;
    }

    const hoveredPointRatio = Math.min(
      1,
      Math.max(0, (hoveredPoint.t - visibleDomain.start) / Math.max(0.0001, visibleDomain.end - visibleDomain.start))
    );

    if (hoverLineRef.current) {
      hoverLineRef.current.style.display = "block";
      hoverLineRef.current.style.left = `${(hoveredPointRatio * 100).toFixed(3)}%`;
    }

    if (hoverTooltipRef.current) {
      hoverTooltipRef.current.style.display = "block";
      hoverTooltipRef.current.style.left = "auto";
      hoverTooltipRef.current.style.right = "12px";
      hoverTooltipRef.current.style.top = "12px";
    }

    if (hoverTimeRef.current) {
      hoverTimeRef.current.textContent = `+${hoveredPoint.t.toFixed(2)}s`;
    }

    for (const key of visibleSignals) {
      const signal = SIGNALS_BY_KEY[key];
      const valueNode = hoverValueRefs.current[key];
      if (valueNode) {
        valueNode.textContent = `${Number(hoveredPoint[key]).toFixed(signal.decimals)} ${signal.unit}`;
      }
    }
  };

  const updateViewportDomain = (nextDomain: { start: number; end: number }) => {
    if (!hasChartData) {
      return;
    }

    const clampedDomain = clampDomainToData(nextDomain, chartData);
    const nextWindow = domainToWindow(chartData, clampedDomain);
    const nextFollow = isAtLiveEdge(nextWindow, chartData.length);
    const nextWindowMs = Math.max(100, (clampedDomain.end - clampedDomain.start) * 1000);
    if (nextFollow) {
      setFollowWindowMs(nextWindowMs);
    }
    setFollowTime(nextFollow);
    setManualDomain(nextFollow ? null : clampedDomain);
  };

  const moveWindow = (direction: "left" | "right") => {
    if (!hasChartData) {
      return;
    }

    const nextWindow = shiftWindow(direction, effectiveWindow, chartData.length);
    updateViewportDomain(domainFromWindow(chartData, nextWindow));
  };

  const jumpToTriggerEvent = (event: TriggerEvent) => {
    const windowWidthSeconds = Math.max(0.1, visibleDomain.end - visibleDomain.start);
    const eventSeconds = (event.timestampMs - firstTimestamp) / 1000;
    const nextDomain = {
      start: eventSeconds - windowWidthSeconds * 0.35,
      end: eventSeconds + windowWidthSeconds * 0.65
    };

    setFollowTime(false);
    setManualDomain(clampDomainToData(nextDomain, chartData));
    setLastTriggerEvent(event);
    triggerLastAtRef.current = event.timestampMs;
  };

  const applyTriggerAction = (event: TriggerEvent) => {
    setLastTriggerEvent(event);
    triggerLastAtRef.current = event.timestampMs;

    if (triggerAction === "jump" || triggerAction === "pause") {
      jumpToTriggerEvent(event);
    }

    if (triggerAction === "pause" && !paused) {
      onTogglePaused();
    }

    if (triggerAction === "clear") {
      onClearCapture();
      setTriggerEvents([]);
      setLastTriggerEvent(null);
      setFollowTime(true);
      setManualDomain(null);
      triggerScanIndexRef.current = 1;
      triggerLastAtRef.current = -Infinity;
    }

    if (triggerSingleShot) {
      setTriggerEnabled(false);
    }
  };

  const downloadCurrentView = async () => {
    const element = chartViewportRef.current;
    if (!element) {
      return;
    }

    const svg = element.querySelector("svg.recharts-surface") ?? element.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", `${Math.round(bounds.width)}`);
    clone.setAttribute("height", `${Math.round(bounds.height)}`);
    if (!clone.getAttribute("viewBox")) {
      clone.setAttribute("viewBox", `0 0 ${Math.round(bounds.width)} ${Math.round(bounds.height)}`);
    }

    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("x", "0");
    background.setAttribute("y", "0");
    background.setAttribute("width", "100%");
    background.setAttribute("height", "100%");
    background.setAttribute("fill", chartBackground);
    clone.insertBefore(background, clone.firstChild);

    const source = new XMLSerializer().serializeToString(clone);
    const svgUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));

    try {
      const image = await loadSvgImage(svgUrl);
      const devicePixelRatio = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bounds.width * devicePixelRatio);
      canvas.height = Math.round(bounds.height * devicePixelRatio);

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      context.scale(devicePixelRatio, devicePixelRatio);
      context.fillStyle = chartBackground;
      context.fillRect(0, 0, bounds.width, bounds.height);
      context.drawImage(image, 0, 0, bounds.width, bounds.height);

      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `openfnb-waveform-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      link.click();
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  useEffect(() => {
    const flushPendingPan = () => {
      panAnimationFrameRef.current = null;

      const dragState = dragStateRef.current;
      const element = chartViewportRef.current;
      const clientX = pendingPanClientXRef.current;
      if (!dragState || !element || clientX === null || chartData.length <= 1) {
        return;
      }

      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0) {
        return;
      }

      const deltaX = clientX - dragState.startX;
      updateViewportDomain(panDomain(dragState.startDomain, deltaX / bounds.width));
    };

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || chartData.length <= 1) {
        return;
      }

      const element = chartViewportRef.current;
      if (!element) {
        return;
      }

      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      if (!dragState.moved && Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
        return;
      }

      dragState.moved = true;
      pendingPanClientXRef.current = event.clientX;
      if (panAnimationFrameRef.current !== null) {
        return;
      }

      panAnimationFrameRef.current = window.requestAnimationFrame(flushPendingPan);
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current) {
        return;
      }

      if (panAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(panAnimationFrameRef.current);
        panAnimationFrameRef.current = null;
      }
      pendingPanClientXRef.current = null;
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleMouseUp);
    return () => {
      if (panAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(panAnimationFrameRef.current);
        panAnimationFrameRef.current = null;
      }
      pendingPanClientXRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleMouseUp);
    };
  }, [chartData]);

  useEffect(() => {
    return () => {
      if (hoverAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverAnimationFrameRef.current);
        hoverAnimationFrameRef.current = null;
      }
      pendingHoverPointerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pointer = pendingHoverPointerRef.current;
    if (!pointer || dragStateRef.current || visibleChartData.length === 0) {
      return;
    }

    updateHoveredPointFromClientPosition(pointer.clientX);
  }, [units.length, visibleChartData, visibleDomain.end, visibleDomain.start, visibleSignals]);

  useEffect(() => {
    const element = chartViewportRef.current;
    if (!element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (chartData.length <= 1) {
        return;
      }

      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const relativeX = (event.clientX - bounds.left) / bounds.width;
      const anchorRatio = Number.isFinite(relativeX) ? Math.min(1, Math.max(0, relativeX)) : 0.5;

      if (followTime) {
        setFollowWindowMs((current) => zoomDuration(current, event.deltaY));
        return;
      }

      updateViewportDomain(zoomDomain(visibleDomain, anchorRatio, event.deltaY));
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, [chartData, followTime, visibleDomain]);

  useEffect(() => {
    setTriggerEvents([]);
    setLastTriggerEvent(null);
    triggerScanIndexRef.current = Math.max(1, sampledMeasurements.length - 1);
    triggerLastAtRef.current = -Infinity;
  }, [triggerConfig]);

  useEffect(() => {
    if (!triggerEnabled || sampledMeasurements.length <= 1) {
      return;
    }

    const events = findTriggerEvents(
      sampledMeasurements,
      triggerConfig,
      triggerScanIndexRef.current,
      triggerLastAtRef.current
    );
    triggerScanIndexRef.current = Math.max(1, sampledMeasurements.length - 1);

    const event = events[events.length - 1];
    if (events.length > 0) {
      setTriggerEvents((current) => current.concat(events).slice(-500));
    }

    if (event) {
      applyTriggerAction(event);
    }
  }, [onClearCapture, sampledMeasurements, triggerAction, triggerConfig, triggerEnabled, triggerSingleShot]);

  return (
    <Card sx={{ minHeight: 500 }}>
      <CardContent>
        <Stack
          alignItems={{ xs: "flex-start", lg: "center" }}
          direction={{ xs: "column", lg: "row" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="h3">Live waveform</Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button
              onClick={(event) => setTriggerMenuAnchorEl(event.currentTarget)}
              size="small"
              variant={triggerEnabled ? "contained" : "outlined"}
            >
              Trigger
            </Button>
            <MuiTooltip title={paused ? "Resume capture" : "Pause capture"}>
              <IconButton aria-label={paused ? "resume capture" : "pause capture"} onClick={onTogglePaused} size="small">
                {paused ? <PlayArrowRoundedIcon fontSize="small" /> : <PauseRoundedIcon fontSize="small" />}
              </IconButton>
            </MuiTooltip>
            <MuiTooltip title="Back">
              <IconButton
                aria-label="back"
                onClick={() => {
                  if (chartData.length === 0) {
                    return;
                  }

                  moveWindow("left");
                }}
                size="small"
              >
                <KeyboardArrowLeftRoundedIcon fontSize="small" />
              </IconButton>
            </MuiTooltip>
            <MuiTooltip title="Forward">
              <IconButton
                aria-label="forward"
                onClick={() => {
                  if (chartData.length === 0) {
                    return;
                  }

                  moveWindow("right");
                }}
                size="small"
              >
                <KeyboardArrowRightRoundedIcon fontSize="small" />
              </IconButton>
            </MuiTooltip>
            <MuiTooltip title="Follow latest">
              <IconButton
                aria-label="follow latest"
                onClick={() => {
                  setFollowTime(true);
                  setManualDomain(null);
                }}
                size="small"
              >
                <GpsFixedRoundedIcon fontSize="small" />
              </IconButton>
            </MuiTooltip>
            <MuiTooltip title="Download PNG">
              <Box component="span" sx={{ alignItems: "center", display: "inline-flex", lineHeight: 0, minHeight: 32, verticalAlign: "middle" }}>
                <IconButton aria-label="download waveform png" disabled={!hasChartData} onClick={() => void downloadCurrentView()} size="small">
                  <DownloadRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
            </MuiTooltip>
          </Stack>
        </Stack>
        <Menu
          anchorEl={triggerMenuAnchorEl}
          disableScrollLock
          onClose={() => setTriggerMenuAnchorEl(null)}
          open={triggerMenuOpen}
          slotProps={{ paper: { sx: { p: 1.5, minWidth: 320 } } }}
        >
          <Stack spacing={1.25}>
            <Stack alignItems="center" direction="row" justifyContent="space-between" spacing={1}>
              <Typography variant="body2">Trigger controls</Typography>
              <Button
                onClick={() => {
                  setTriggerEnabled((current) => !current);
                  triggerScanIndexRef.current = Math.max(1, sampledMeasurements.length - 1);
                }}
                size="small"
                variant={triggerEnabled ? "contained" : "outlined"}
              >
                {triggerEnabled ? "Armed" : "Arm"}
              </Button>
            </Stack>
            <TextField
              select
              label="Trigger signal"
              onChange={(event) => onTriggerSignalChange(event.target.value as TriggerSignal)}
              SelectProps={{ MenuProps: { disableScrollLock: true } }}
              size="small"
              value={triggerSignal}
            >
              <MenuItem value="dp">D+</MenuItem>
              <MenuItem value="dn">D-</MenuItem>
              <MenuItem value="vbus">VBUS</MenuItem>
              <MenuItem value="ibus">IBUS</MenuItem>
            </TextField>
            <TextField
              select
              label="Edge"
              onChange={(event) => onTriggerDirectionChange(event.target.value as TriggerDirection)}
              SelectProps={{ MenuProps: { disableScrollLock: true } }}
              size="small"
              value={triggerDirection}
            >
              <MenuItem value="rising">Rising</MenuItem>
              <MenuItem value="falling">Falling</MenuItem>
            </TextField>
            <TextField
              label="Threshold"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  onTriggerThresholdChange(value);
                }
              }}
              size="small"
              type="number"
              value={triggerThreshold}
            />
            <TextField
              label="Holdoff ms"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0) {
                  onTriggerHoldoffMsChange(value);
                }
              }}
              size="small"
              type="number"
              value={triggerHoldoffMs}
            />
            <TextField
              select
              label="Action"
              onChange={(event) => setTriggerAction(event.target.value as TriggerAction)}
              SelectProps={{ MenuProps: { disableScrollLock: true } }}
              size="small"
              value={triggerAction}
            >
              <MenuItem value="jump">Jump to trigger</MenuItem>
              <MenuItem value="mark">Mark only</MenuItem>
              <MenuItem value="pause">Pause capture</MenuItem>
              <MenuItem value="clear">Clear capture</MenuItem>
            </TextField>
            <FormControlLabel
              control={
                <Switch
                  checked={triggerSingleShot}
                  onChange={(event) => setTriggerSingleShot(event.target.checked)}
                  size="small"
                />
              }
              label="Stop after first match"
            />
            <Typography color="text.secondary" sx={{ minWidth: 0 }} variant="body2">
              {lastTriggerEvent
                ? `Last trigger: ${lastTriggerEvent.signal.toUpperCase()} ${lastTriggerEvent.direction} at +${(
                    (lastTriggerEvent.timestampMs - firstTimestamp) /
                    1000
                  ).toFixed(2)}s`
                : "No trigger captured yet."}
            </Typography>
          </Stack>
        </Menu>
        <Box
          ref={chartViewportRef}
          onMouseDown={(event) => {
            if (chartData.length <= 1) {
              return;
            }

            event.preventDefault();
            hideHoverOverlay();
            dragStateRef.current = {
              startX: event.clientX,
              startDomain: visibleDomain,
              moved: false
            };
            setIsDragging(true);
          }}
          onMouseEnter={() => {
            if (visibleChartData.length > 0) {
              hideHoverOverlay();
            }
          }}
          onMouseMove={(event) => {
            if (dragStateRef.current || visibleChartData.length === 0) {
              return;
            }

            pendingHoverPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
            if (hoverAnimationFrameRef.current !== null) {
              return;
            }

            hoverAnimationFrameRef.current = window.requestAnimationFrame(() => {
              hoverAnimationFrameRef.current = null;
              const pointer = pendingHoverPointerRef.current;
              if (pointer === null) {
                return;
              }

              updateHoveredPointFromClientPosition(pointer.clientX);
            });
          }}
          onMouseLeave={() => {
            if (hoverAnimationFrameRef.current !== null) {
              window.cancelAnimationFrame(hoverAnimationFrameRef.current);
              hoverAnimationFrameRef.current = null;
            }
            pendingHoverPointerRef.current = null;
            hideHoverOverlay();
          }}
          onDoubleClick={() => {
            setFollowTime(true);
            setManualDomain(null);
          }}
          sx={{ cursor: isDragging ? "grabbing" : "grab", height: 420, mt: 3, position: "relative", userSelect: "none" }}
        >
          <Box
            sx={{
              bottom: WAVEFORM_X_AXIS_HEIGHT,
              left: WAVEFORM_Y_AXIS_WIDTH,
              pointerEvents: "none",
              position: "absolute",
              right: units.length > 1 ? WAVEFORM_Y_AXIS_WIDTH : 0,
              top: 0,
              zIndex: 2
            }}
          >
            <Box
              ref={hoverLineRef}
              sx={{
                backgroundColor: alpha(theme.palette.text.primary, 0.35),
                display: "none",
                height: "100%",
                left: "0%",
                position: "absolute",
                top: 0,
                transform: "translateX(-0.5px)",
                width: "1px"
              }}
            />
          </Box>
          <Box
            ref={hoverTooltipRef}
            sx={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${axisStroke}`,
              borderRadius: 1.5,
              boxShadow: theme.shadows[4],
              display: "none",
              minWidth: 168,
              pointerEvents: "none",
              position: "absolute",
              px: 1.25,
              py: 1,
              right: 12,
              top: 12,
              zIndex: 3
            }}
          >
            <Typography color="text.secondary" variant="caption">
              <span ref={hoverTimeRef} />
            </Typography>
            {visibleSignals.map((key) => {
              const signal = SIGNALS_BY_KEY[key];
              return (
                <Stack key={`hover-${key}`} alignItems="center" direction="row" justifyContent="space-between" spacing={2}>
                  <Typography variant="caption">{signal.label}</Typography>
                  <Typography
                    className="metric-value"
                    variant="caption"
                  >
                    <span
                      ref={(node) => {
                        hoverValueRefs.current[key] = node;
                      }}
                    />
                  </Typography>
                </Stack>
              );
            })}
          </Box>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleChartData} margin={{ top: 26, right: 18, bottom: 10, left: 8 }}>
              <CartesianGrid horizontal={true} stroke={gridStroke} strokeDasharray="4 4" vertical={true} />
              <XAxis
                allowDataOverflow
                dataKey="t"
                domain={[visibleDomain.start, visibleDomain.end]}
                type="number"
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                axisLine={{ stroke: axisStroke }}
                tickLine={{ stroke: axisStroke }}
                tickFormatter={(value) => `${value.toFixed(1)}s`}
              />
              {units.map((unit, index) => (
                <YAxis
                  key={unit}
                  yAxisId={unit}
                  orientation={index === 0 ? "left" : "right"}
                  hide={index > 1}
                  domain={yAxisDomains[unit] ?? [0, 1]}
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  axisLine={{ stroke: axisStroke }}
                  tickLine={{ stroke: axisStroke }}
                  tickFormatter={(value) => formatAxisValue(value, unit)}
                  width={WAVEFORM_Y_AXIS_WIDTH}
                />
              ))}
              {units.map((unit) => (
                <ReferenceLine
                  key={`helper-zero-${unit}`}
                  ifOverflow="extendDomain"
                  stroke={helperLineStroke}
                  strokeDasharray="2 3"
                  y={0}
                  yAxisId={unit}
                />
              ))}
              {visibleSignals.includes(triggerSignal) ? (
                <ReferenceLine
                  ifOverflow="extendDomain"
                  stroke={SIGNALS_BY_KEY[triggerSignal].color}
                  strokeDasharray="5 4"
                  strokeOpacity={0.65}
                  y={triggerThreshold}
                  yAxisId={SIGNALS_BY_KEY[triggerSignal].unit}
                />
              ) : null}
              {visibleSignals.includes(triggerSignal)
                ? (
                    <Line
                      activeDot={false}
                      data={visibleTriggerMarkers}
                      dataKey="value"
                      dot={{
                        fill: SIGNALS_BY_KEY[triggerSignal].color,
                        r: 4,
                        stroke: theme.palette.background.paper,
                        strokeWidth: 1.5
                      }}
                      isAnimationActive={false}
                      legendType="none"
                      stroke="transparent"
                      xAxisId={0}
                      yAxisId={SIGNALS_BY_KEY[triggerSignal].unit}
                    />
                  )
                : null}
              {visibleSignals.map((key) => {
                const signal = SIGNALS_BY_KEY[key];

                return (
                  <Line
                    key={key}
                    activeDot={false}
                    type="linear"
                    dataKey={key}
                    yAxisId={signal.unit}
                    dot={false}
                    isAnimationActive={false}
                    stroke={signal.color}
                    strokeWidth={1.8}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </Box>
        <Box sx={{ ml: `${navigatorInsets.left}px`, mr: `${navigatorInsets.right}px` }}>
          <NavigatorBar
            chartData={chartData}
            colors={{
              background: theme.palette.background.paper,
              border: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.08 : 0.14),
              fill: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.07 : 0.1),
              handleFill: theme.palette.background.default,
              handleGrip: alpha(theme.palette.text.primary, 0.55),
              handleStroke: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.2 : 0.28),
              stroke: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.18 : 0.24)
            }}
            signalKeys={navigatorSignals}
            visibleDomain={visibleDomain}
            onChangeDomain={updateViewportDomain}
          />
        </Box>
      </CardContent>
    </Card>
  );
}

type NavigatorBarProps = {
  chartData: Array<{ t: number; [key: string]: number }>;
  colors: {
    background: string;
    border: string;
    fill: string;
    handleFill: string;
    handleGrip: string;
    handleStroke: string;
    stroke: string;
  };
  onChangeDomain: (nextDomain: { start: number; end: number }) => void;
  signalKeys: SignalKey[];
  visibleDomain: { start: number; end: number };
};

function NavigatorBar({ chartData, colors, onChangeDomain, signalKeys, visibleDomain }: NavigatorBarProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStateRef = useRef<
    | {
        mode: "pan" | "resize-start" | "resize-end";
        moved: boolean;
        startPointerTime: number;
        startClientX: number;
        startDomain: { start: number; end: number };
      }
    | null
  >(null);
  const suppressClickRef = useRef(false);
  const totalWidth = NAVIGATOR_VIEWBOX_WIDTH;
  const totalHeight = NAVIGATOR_HEIGHT;
  const plotWidth = totalWidth - NAVIGATOR_PADDING_X * 2;
  const plotHeight = totalHeight - NAVIGATOR_PADDING_Y * 2;
  const minT = chartData[0]?.t ?? 0;
  const maxT = chartData[chartData.length - 1]?.t ?? minT;
  const fullWidth = Math.max(NAVIGATOR_MIN_WINDOW_S, maxT - minT);
  const clampedDomain = clampDomainToData(visibleDomain, chartData);
  const startRatio = Math.min(1, Math.max(0, (clampedDomain.start - minT) / fullWidth));
  const endRatio = Math.min(1, Math.max(startRatio, (clampedDomain.end - minT) / fullWidth));
  const selectionStartX = NAVIGATOR_PADDING_X + startRatio * plotWidth;
  const selectionEndX = NAVIGATOR_PADDING_X + endRatio * plotWidth;
  const selectionWidth = Math.max(NAVIGATOR_MIN_WINDOW_S / fullWidth * plotWidth, selectionEndX - selectionStartX);

  const getPointerTime = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) {
      return minT;
    }

    const bounds = svg.getBoundingClientRect();
    const rawRatio = (clientX - bounds.left) / Math.max(1, bounds.width);
    const plotRatio = Math.min(1, Math.max(0, (rawRatio * totalWidth - NAVIGATOR_PADDING_X) / plotWidth));
    return minT + plotRatio * fullWidth;
  };

  const beginDrag = (mode: "pan" | "resize-start" | "resize-end", event: ReactMouseEvent<SVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      mode,
      moved: false,
      startPointerTime: getPointerTime(event.clientX),
      startClientX: event.clientX,
      startDomain: clampedDomain
    };
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || chartData.length <= 1) {
        return;
      }

      const deltaX = event.clientX - dragState.startClientX;
      if (!dragState.moved && Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
        return;
      }

      dragState.moved = true;
      suppressClickRef.current = true;
      const pointerTime = getPointerTime(event.clientX);
      const deltaTime = pointerTime - dragState.startPointerTime;

      if (dragState.mode === "pan") {
        onChangeDomain({
          start: dragState.startDomain.start + deltaTime,
          end: dragState.startDomain.end + deltaTime
        });
        return;
      }

      if (dragState.mode === "resize-start") {
        onChangeDomain({
          start: Math.min(dragState.startDomain.end - NAVIGATOR_MIN_WINDOW_S, pointerTime),
          end: dragState.startDomain.end
        });
        return;
      }

      onChangeDomain({
        start: dragState.startDomain.start,
        end: Math.max(dragState.startDomain.start + NAVIGATOR_MIN_WINDOW_S, pointerTime)
      });
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleMouseUp);
    };
  }, [chartData.length, fullWidth, onChangeDomain]);

  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (chartData.length <= 1) {
      return;
    }

    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const rawRatio = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const plotRatio = (rawRatio * totalWidth - NAVIGATOR_PADDING_X) / plotWidth;
    onChangeDomain(centerDomainOnRatio(clampedDomain, chartData, plotRatio));
  };

  return (
    <Box
      sx={{
        border: `1px solid ${alpha(colors.border, 0.55)}`
      }}
    >
      <svg
        ref={svgRef}
        height={NAVIGATOR_HEIGHT}
        onClick={handleClick}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", userSelect: "none" }}
        viewBox={`0 0 ${NAVIGATOR_VIEWBOX_WIDTH} ${NAVIGATOR_HEIGHT}`}
      >
        <rect fill={colors.background} height={NAVIGATOR_HEIGHT} width={NAVIGATOR_VIEWBOX_WIDTH} x={0} y={0} />
        {signalKeys.map((key) => (
          <path
            key={`navigator-path-${key}`}
            d={buildNavigatorPath(chartData, key, plotWidth, plotHeight)}
            fill="none"
            stroke={SIGNALS_BY_KEY[key].color}
            strokeOpacity={0.8}
            strokeWidth={1.5}
            transform={`translate(${NAVIGATOR_PADDING_X}, ${NAVIGATOR_PADDING_Y})`}
          />
        ))}
        <rect
          fill={colors.fill}
          height={plotHeight}
          onMouseDown={(event) => beginDrag("pan", event)}
          stroke={colors.stroke}
          strokeWidth={1}
          style={{ cursor: "grab" }}
          width={selectionWidth}
          x={selectionStartX}
          y={NAVIGATOR_PADDING_Y}
        />
        <rect
          fill="transparent"
          height={plotHeight}
          onMouseDown={(event) => beginDrag("resize-start", event)}
          style={{ cursor: "col-resize" }}
          width={Math.max(20, NAVIGATOR_HANDLE_WIDTH * 1.6)}
          x={selectionStartX - Math.max(10, NAVIGATOR_HANDLE_WIDTH * 0.8)}
          y={NAVIGATOR_PADDING_Y}
        />
        <rect
          fill="transparent"
          height={plotHeight}
          onMouseDown={(event) => beginDrag("resize-end", event)}
          style={{ cursor: "col-resize" }}
          width={Math.max(20, NAVIGATOR_HANDLE_WIDTH * 1.6)}
          x={selectionEndX - Math.max(10, NAVIGATOR_HANDLE_WIDTH * 0.8)}
          y={NAVIGATOR_PADDING_Y}
        />
        <NavigatorHandle
          colors={colors}
          onMouseDown={(event) => beginDrag("resize-start", event)}
          x={Math.max(0, selectionStartX - NAVIGATOR_HANDLE_WIDTH / 2)}
          y={NAVIGATOR_PADDING_Y}
        />
        <NavigatorHandle
          colors={colors}
          onMouseDown={(event) => beginDrag("resize-end", event)}
          x={Math.min(totalWidth - NAVIGATOR_HANDLE_WIDTH, selectionEndX - NAVIGATOR_HANDLE_WIDTH / 2)}
          y={NAVIGATOR_PADDING_Y}
        />
      </svg>
    </Box>
  );
}

function NavigatorHandle({
  colors,
  onMouseDown,
  x,
  y
}: {
  colors: NavigatorBarProps["colors"];
  onMouseDown: (event: ReactMouseEvent<SVGElement>) => void;
  x: number;
  y: number;
}) {
  const gripHeight = NAVIGATOR_HEIGHT - NAVIGATOR_PADDING_Y * 2 - 18;
  const gripY = y + 9;
  const gripX = x + NAVIGATOR_HANDLE_WIDTH / 2 - 2;

  return (
    <g onMouseDown={onMouseDown} style={{ cursor: "col-resize" }}>
      <rect
        fill={colors.handleFill}
        height={NAVIGATOR_HEIGHT - NAVIGATOR_PADDING_Y * 2}
        stroke={colors.handleStroke}
        strokeWidth={1}
        width={NAVIGATOR_HANDLE_WIDTH}
        x={x}
        y={y}
      />
      <rect fill={colors.handleGrip} height={gripHeight} rx={1.25} width={1.5} x={gripX} y={gripY} />
      <rect fill={colors.handleGrip} height={gripHeight} rx={1.25} width={1.5} x={gripX + 3} y={gripY} />
    </g>
  );
}

function buildNavigatorPath(
  chartData: Array<{ t: number; [key: string]: number }>,
  key: SignalKey,
  width: number,
  height: number
) {
  if (chartData.length === 0 || width <= 0 || height <= 0) {
    return "";
  }

  const values = chartData.map((point) => point[key]).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return "";
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const startT = chartData[0]?.t ?? 0;
  const endT = chartData[chartData.length - 1]?.t ?? startT;
  const timeRange = Math.max(0.001, endT - startT);
  const step = Math.max(1, Math.ceil(chartData.length / 240));
  const sampledPoints = chartData.filter((_, index) => index % step === 0);

  if (sampledPoints[sampledPoints.length - 1] !== chartData[chartData.length - 1]) {
    sampledPoints.push(chartData[chartData.length - 1]);
  }

  return sampledPoints
    .map((point, index) => {
      const x = ((point.t - startT) / timeRange) * width;
      const normalizedValue = range <= 0.000001 ? 0.5 : (point[key] - minValue) / range;
      const y = height - normalizedValue * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to render waveform PNG."));
    image.src = url;
  });
}

function formatAxisValue(value: number, unit: SignalUnit): string {
  if (unit === "Ah" || unit === "Wh") {
    return `${value.toFixed(2)}${unit}`;
  }

  return `${value.toFixed(2)}${unit}`;
}

function buildInitialYAxisDomains(chartData: ChartPoint[], visibleSignals: SignalKey[]): Partial<Record<SignalUnit, [number, number]>> {
  const domains: Partial<Record<SignalUnit, [number, number]>> = {};

  for (const signalKey of visibleSignals) {
    const signal = SIGNALS_BY_KEY[signalKey];
    const values = chartData.map((point) => point[signalKey]).filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      continue;
    }

    const currentDomain = domains[signal.unit];
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    domains[signal.unit] = currentDomain
      ? [Math.min(currentDomain[0], minValue), Math.max(currentDomain[1], maxValue)]
      : [minValue, maxValue];
  }

  for (const unit of Object.keys(domains) as SignalUnit[]) {
    const domain = domains[unit];
    if (!domain) {
      continue;
    }

    const [minValue, maxValue] = domain;
    const range = maxValue - minValue;
    const padding =
      range <= 0.000001
        ? Math.max(Math.abs(maxValue) * Y_AXIS_PADDING_RATIO, minimumYAxisPadding(unit))
        : range * Y_AXIS_PADDING_RATIO;
    domains[unit] = [minValue - padding, maxValue + padding];
  }

  return domains;
}

function expandYAxisDomains(
  currentDomains: Partial<Record<SignalUnit, [number, number]>>,
  chartData: ChartPoint[],
  visibleSignals: SignalKey[]
): Partial<Record<SignalUnit, [number, number]>> {
  const measuredDomains = buildInitialYAxisDomains(chartData, visibleSignals);
  let changed = false;
  const nextDomains: Partial<Record<SignalUnit, [number, number]>> = { ...currentDomains };

  for (const unit of Object.keys(measuredDomains) as SignalUnit[]) {
    const measured = measuredDomains[unit];
    if (!measured) {
      continue;
    }

    const current = currentDomains[unit];
    if (!current) {
      nextDomains[unit] = measured;
      changed = true;
      continue;
    }

    const currentRange = Math.max(0.000001, current[1] - current[0]);
    const lowerLimit = current[0] - currentRange * Y_AXIS_EXPAND_MARGIN;
    const upperLimit = current[1] + currentRange * Y_AXIS_EXPAND_MARGIN;
    if (measured[0] < lowerLimit || measured[1] > upperLimit) {
      nextDomains[unit] = [Math.min(current[0], measured[0]), Math.max(current[1], measured[1])];
      changed = true;
    }
  }

  return changed ? nextDomains : currentDomains;
}

function minimumYAxisPadding(unit: SignalUnit) {
  if (unit === "V") {
    return 0.1;
  }

  if (unit === "A") {
    return 0.05;
  }

  if (unit === "W") {
    return 0.5;
  }

  return 0.001;
}

function downsampleMeasurements(measurements: Measurement[], captureSamplesPerSecond: number) {
  if (measurements.length <= 2) {
    return measurements;
  }

  const minIntervalMs = 1000 / captureSamplesPerSecond;
  const sampled: Measurement[] = [];
  let lastTimestampMs: number | null = null;

  for (const measurement of measurements) {
    if (lastTimestampMs === null || measurement.timestampMs - lastTimestampMs >= minIntervalMs - 0.001) {
      sampled.push(measurement);
      lastTimestampMs = measurement.timestampMs;
    }
  }

  const lastMeasurement = measurements[measurements.length - 1];
  if (sampled[sampled.length - 1] !== lastMeasurement) {
    sampled.push(lastMeasurement);
  }

  return sampled;
}

function buildDefaultWindow(measurements: Measurement[]) {
  if (measurements.length === 0) {
    return {
      startIndex: 0,
      endIndex: 0
    };
  }

  const endIndex = measurements.length - 1;
  const minTimestampMs = measurements[endIndex].timestampMs - DEFAULT_VISIBLE_WINDOW_MS;
  let startIndex = 0;

  while (startIndex < endIndex && measurements[startIndex].timestampMs < minTimestampMs) {
    startIndex += 1;
  }

  return {
    startIndex,
    endIndex
  };
}

function buildFollowDomain(chartData: Array<{ t: number }>, windowMs: number) {
  if (chartData.length === 0) {
    return { start: 0, end: windowMs / 1000 };
  }

  const latest = chartData[chartData.length - 1]?.t ?? 0;
  const widthSeconds = Math.max(0.1, windowMs / 1000);
  const end = Math.max(widthSeconds, latest);
  return {
    start: Math.max(0, end - widthSeconds),
    end
  };
}

function shiftWindow(
  direction: "left" | "right",
  current: { startIndex: number; endIndex: number },
  length: number
) {
  const width = Math.max(2, current.endIndex - current.startIndex + 1);
  const step = Math.max(10, Math.floor(width / 3));
  const delta = direction === "left" ? -step : step;
  const nextStart = Math.min(Math.max(0, current.startIndex + delta), Math.max(0, length - width));
  const nextEnd = Math.min(length - 1, nextStart + width - 1);
  return { startIndex: nextStart, endIndex: nextEnd };
}

function zoomDomain(current: { start: number; end: number }, anchorRatio: number, deltaY: number) {
  const currentWidth = Math.max(0.1, current.end - current.start);
  const scale = deltaY < 0 ? 0.8 : 1.25;
  const nextWidth = Math.max(0.1, currentWidth * scale);
  const anchorTime = current.start + currentWidth * anchorRatio;
  const nextStart = Math.max(0, anchorTime - nextWidth * anchorRatio);

  return {
    start: nextStart,
    end: nextStart + nextWidth
  };
}

function zoomDuration(currentMs: number, deltaY: number) {
  const scale = deltaY < 0 ? 0.8 : 1.25;
  return Math.min(300_000, Math.max(500, Math.round(currentMs * scale)));
}

function panDomain(current: { start: number; end: number }, deltaRatio: number) {
  const width = Math.max(0.1, current.end - current.start);
  const delta = width * deltaRatio;
  const nextStart = Math.max(0, current.start - delta);

  return {
    start: nextStart,
    end: nextStart + width
  };
}

function domainToWindow(chartData: Array<{ t: number }>, domain: { start: number; end: number }) {
  if (chartData.length === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const startIndex = findFirstIndexAtOrAfter(chartData, domain.start);
  const endIndex = findLastIndexAtOrBefore(chartData, domain.end);

  return {
    startIndex,
    endIndex: Math.max(startIndex, Math.min(chartData.length - 1, endIndex))
  };
}

function sliceWindow<T>(items: T[], windowRange: { startIndex: number; endIndex: number }, padding = 0) {
  if (items.length === 0) {
    return items;
  }

  const startIndex = Math.max(0, windowRange.startIndex - padding);
  const endIndex = Math.min(items.length, windowRange.endIndex + padding + 1);
  return items.slice(startIndex, endIndex);
}

function findNearestPointIndex(chartData: Array<{ t: number }>, target: number) {
  if (chartData.length <= 1) {
    return 0;
  }

  const nextIndex = findFirstIndexAtOrAfter(chartData, target);
  const previousIndex = Math.max(0, nextIndex - 1);
  const nextPoint = chartData[nextIndex];
  const previousPoint = chartData[previousIndex];

  if (!nextPoint) {
    return previousIndex;
  }

  return Math.abs(nextPoint.t - target) < Math.abs(target - previousPoint.t) ? nextIndex : previousIndex;
}

function domainFromWindow(chartData: Array<{ t: number }>, windowRange: { startIndex: number; endIndex: number }) {
  if (chartData.length === 0) {
    return { start: 0, end: DEFAULT_VISIBLE_WINDOW_MS / 1000 };
  }

  const start = chartData[windowRange.startIndex]?.t ?? 0;
  const end = chartData[windowRange.endIndex]?.t ?? start + 0.1;

  return {
    start,
    end: end > start ? end : start + 0.1
  };
}

function clampDomainToData(chartDataDomain: { start: number; end: number }, chartData: Array<{ t: number }>) {
  if (chartData.length === 0) {
    return { start: 0, end: DEFAULT_VISIBLE_WINDOW_MS / 1000 };
  }

  const minT = chartData[0]?.t ?? 0;
  const maxT = chartData[chartData.length - 1]?.t ?? minT;
  const dataWidth = maxT - minT;

  if (dataWidth <= 0.1) {
    return {
      start: Math.max(0, minT),
      end: Math.max(minT + 0.1, maxT)
    };
  }

  const width = Math.min(Math.max(0.1, chartDataDomain.end - chartDataDomain.start), dataWidth);
  const nextStart = Math.min(Math.max(minT, chartDataDomain.start), maxT - width);

  return {
    start: nextStart,
    end: nextStart + width
  };
}

function centerDomainOnRatio(current: { start: number; end: number }, chartData: Array<{ t: number }>, ratio: number) {
  if (chartData.length === 0) {
    return { start: 0, end: DEFAULT_VISIBLE_WINDOW_MS / 1000 };
  }

  const minT = chartData[0]?.t ?? 0;
  const maxT = chartData[chartData.length - 1]?.t ?? minT;
  const fullWidth = maxT - minT;
  const visibleWidth = Math.min(Math.max(0.1, current.end - current.start), Math.max(0.1, fullWidth));
  const targetTime = minT + fullWidth * Math.min(1, Math.max(0, ratio));
  const centeredStart = targetTime - visibleWidth / 2;

  return clampDomainToData(
    {
      start: centeredStart,
      end: centeredStart + visibleWidth
    },
    chartData
  );
}

function isAtLiveEdge(window: { startIndex: number; endIndex: number }, length: number) {
  return window.endIndex >= Math.max(0, length - 2);
}

function findFirstIndexAtOrAfter(chartData: Array<{ t: number }>, target: number) {
  let low = 0;
  let high = chartData.length - 1;
  let result = chartData.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (chartData[mid].t >= target) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

function findLastIndexAtOrBefore(chartData: Array<{ t: number }>, target: number) {
  let low = 0;
  let high = chartData.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (chartData[mid].t <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}
