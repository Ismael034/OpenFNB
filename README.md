<p align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="OpenFNB icon">
</p>

# OpenFNB

OpenFNB is a web dashboard for FNIRSI USB power meters. It connects from Chrome or Edge using WebHID or Web Bluetooth and shows live measurements, waveform navigation, trigger handling, protocol analysis, and export tools.

![OpenFNB dashboard](docs/openfnb-dashboard.png)

# Why?

You may have noticed that there are already multiple unofficial tools that do a similar thing, so why create another one? Here are my reasons:
- I wanted a simple, easy-to-use interface.
- Something compatible with my phone (Web Bluetooth).
- Easy to set up, with no backend, just pure frontend.
- A full feature set, everything the original tool provides is here, including firmware updates.

## Features

- Live VBUS, IBUS, PBUS, D+, D-, capacity, and energy tracking.
- Interactive waveform with pan, zoom, follow latest, range selection, hover values, and PNG export.
- Trigger detection on D+, D-, VBUS, or IBUS.
- Trigger actions to jump to trigger, mark only, pause capture, or clear capture.
- Protocol analysis for D+/D- charging signatures.
- Threshold alarms for VBUS, IBUS, and PBUS.
- CSV export, compact JSON record export/import, and waveform PNG export.
- Light/dark theme.

## Supported Devices

USB/WebHID:

- FNIRSI C1 (not tested)
- FNIRSI FNB48 (not tested)
- FNIRSI FNB48S (not tested)
- FNIRSI FNB58 (tested)

Bluetooth:

- FNB58-style BLE telemetry (tested)

## Requirements

- Chrome or Edge.
- `https://` or `http://localhost`.
- USB data cable for WebHID, or a Bluetooth-capable meter for BLE.

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

## Use

1. Open the app in Chrome or Edge.
2. Click `Connect`.
3. Choose `USB` or `Bluetooth`.
4. Select the meter from the browser prompt.
