# Joy-Con HID Integration Notes

This repository contains a minimal local Node app and reusable HID module for detecting official Nintendo Switch Joy-Con controllers and triggering vibration independently on the left and right controllers.

The working path is **Node + `node-hid`**. It does not rely on WebHID, browser permissions, or the browser device picker.

## What Works

- Detect official Nintendo Joy-Con devices over Bluetooth.
- Identify left and right Joy-Con by official product IDs.
- Trigger left-only, right-only, or both-controller rumble.
- Send a neutral rumble frame to stop vibration.
- Read battery from input reports when the controller exposes a full input report.
- Use the same implementation from a local HTTP API, a browser test UI, or CLI scripts.

## Hardware IDs

```txt
vendorId  0x057e  Nintendo
productId 0x2006  Joy-Con Left
productId 0x2007  Joy-Con Right
```

In `node-hid`, paired Bluetooth Joy-Con appear as Nintendo HID devices. On Windows they may show `product: "Wireless Gamepad"` even though the product IDs identify the side.

## Quick Start

```sh
npm install
npm run dev
```

Open:

```txt
http://localhost:5173
```

The local test app shows:

- Local API status
- Left Joy-Con status and battery if available
- Right Joy-Con status and battery if available
- Controls for `Left`, `Right`, `Both`, `Stop`, and `Refresh`

## Reusable Module

The reusable implementation lives in:

```txt
scripts/joycon-hid-core.mjs
```

Useful exports:

```js
import {
  listJoyCons,
  pulseJoyCons,
  neutralJoyCons,
  classifyDevice,
  parseBatteryReport,
} from './scripts/joycon-hid-core.mjs';
```

### List Devices

```js
const devices = await listJoyCons();
console.log(devices);
```

Example shape:

```json
[
  {
    "index": 0,
    "side": "left",
    "product": "Wireless Gamepad",
    "manufacturer": "Nintendo",
    "vendorId": "0x057e",
    "productId": "0x2006",
    "battery": {
      "label": "Medium",
      "percent": 75,
      "charging": false,
      "rawPowerInfo": "0x80",
      "reportId": "0x30"
    },
    "path": "..."
  }
]
```

Battery may be:

```json
{
  "label": "Unknown",
  "level": null,
  "percent": null,
  "charging": null
}
```

That means the device was visible but did not provide a usable input report during the short read window.

### Pulse One Side

```js
await pulseJoyCons({
  side: 'left',
  intensity: 'high',
  duration: 450,
  repeats: 1,
});
```

### Pulse Both

```js
await pulseJoyCons({
  side: 'both',
  intensity: 'medium',
  duration: 700,
});
```

### Stop Rumble

```js
await neutralJoyCons({ side: 'both' });
```

### Listen To Events

```js
await pulseJoyCons(
  { side: 'right', intensity: 'high', duration: 500 },
  (event) => console.log(event),
);
```

Event examples:

```json
{ "type": "open", "device": { "side": "right", "productId": "0x2007" } }
{ "type": "write", "label": "enable vibration", "reportId": "0x01", "writtenBytes": 49 }
{ "type": "pulse", "side": "right", "intensity": "high", "durationMs": 500 }
{ "type": "stream", "intensity": "high", "durationMs": 500, "frameCount": 16 }
{ "type": "write", "label": "neutral", "reportId": "0x10", "writtenBytes": 49 }
```

## Local HTTP API

The demo server lives in:

```txt
scripts/local-app.mjs
```

It serves the UI from `public/` and exposes a tiny local API.

### `GET /api/joycon/status`

Response:

```json
{
  "ok": true,
  "mode": "node-hid",
  "endpoints": [
    "/api/joycon/devices",
    "/api/joycon/pulse",
    "/api/joycon/neutral"
  ]
}
```

### `GET /api/joycon/devices`

Response:

```json
{
  "ok": true,
  "devices": []
}
```

`devices` uses the same shape as `listJoyCons()`.

### `POST /api/joycon/pulse`

Request:

```json
{
  "side": "left",
  "intensity": "high",
  "duration": 450,
  "repeats": 1
}
```

Allowed values:

```txt
side:      left | right | both
intensity: low | medium | high
duration:  >= 20 ms
repeats:   1..20
```

Response:

```json
{
  "ok": true,
  "events": []
}
```

### `POST /api/joycon/neutral`

Request:

```json
{
  "side": "both"
}
```

Sends a neutral rumble frame to the selected controller(s).

## Frontend Integration Example

```js
async function pulseJoyCon(side) {
  const response = await fetch('/api/joycon/pulse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      side,
      intensity: 'high',
      duration: 450,
      repeats: 1,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Joy-Con pulse failed');
  }
  return data.events;
}

await pulseJoyCon('left');
```

## Protocol Details

The implementation uses the following Joy-Con HID flow.

### Packet Length

The default output packet length is `49` bytes, including the report ID byte at index `0`.

```js
const DEFAULT_PACKET_BYTES = 49;
```

If a platform or adapter requires another size, the low-level functions accept `packetBytes`. `64` is a reasonable value to test when `49` does not work.

### Enable Vibration

Before rumble, send output report `0x01` with subcommand `0x48 0x01`.

Payload layout:

```txt
[report id 0x01]
[packet counter]
[left/right rumble neutral frame, 4 bytes]
[left/right rumble neutral frame, 4 bytes]
[subcommand 0x48]
[subcommand data 0x01]
[zero padding to packet length]
```

### Rumble Stream

Rumble is sent by repeatedly writing output report `0x10`.

Payload layout:

```txt
[report id 0x10]
[packet counter]
[rumble frame, 4 bytes]
[rumble frame, 4 bytes]
[zero padding to packet length]
```

The current implementation writes a rumble frame roughly every `24 ms` for the requested duration.

### Neutral Stop

To stop rumble, send report `0x10` with the neutral rumble frame:

```js
neutral: [0x00, 0x01, 0x40, 0x40]
```

## Rumble Profiles

Current tested profiles:

```js
const RUMBLE_PROFILES = {
  neutral: [0x00, 0x01, 0x40, 0x40],
  low:     [0x40, 0x40, 0x60, 0x41],
  medium:  [0x98, 0x30, 0x61, 0x46],
  high:    [0x28, 0x88, 0x60, 0x61],
};
```

These four bytes are sent to both rumble slots of the selected physical Joy-Con.

## Battery Notes

Battery is parsed from Joy-Con input reports when available.

The relevant byte is `PowerInfo` at offset `0x2` in full input reports such as `0x30`.

Current parser:

```js
const powerInfo = bytes[2];
const level = (powerInfo >> 5) & 0x07;
const charging = (powerInfo & 0x10) !== 0;
```

Labels:

```txt
0 Empty
1 Critical
2 Low
3 Medium
4 Full
```

The percentage shown by this repo is a coarse display value:

```js
percent = level * 25;
```

If battery returns `Unknown`, do not treat that as failure. It usually means the controller is asleep, empty, not yet emitting full reports, or the read timed out.

## CLI

```sh
npm run joycon:list
npm run joycon:left
npm run joycon:right
npm run joycon:both
```

Custom:

```sh
node scripts/joycon-rumble.mjs pulse --side left --intensity high --duration 900 --repeats 2
node scripts/joycon-rumble.mjs pulse --side both --intensity medium --duration 700
```

The CLI and the HTTP server both use `scripts/joycon-hid-core.mjs`.

## Integration Recommendations

- Keep HID access in a local backend process, Electron main process, Tauri command, native helper, or desktop service.
- Let the UI call a small local API rather than using browser WebHID.
- Re-list devices before starting a session and after Bluetooth reconnects.
- Disable per-side buttons when that side is not present.
- Always send a neutral frame after every pulse.
- Add a visible stop control that calls `neutralJoyCons({ side: 'both' })`.
- Treat battery as best-effort telemetry, not a hard dependency.
- Keep pulse durations conservative while testing.

## Known Limitations

- Official Nintendo Joy-Con are the tested target.
- Clone controllers may use different product IDs or rumble encoding.
- Bluetooth sleep, low battery, or OS pairing state can make devices disappear from `node-hid`.
- Only one process should hold the HID path at a time.
- Battery reads can temporarily return `Unknown`.

## Files

```txt
public/index.html          Minimal browser UI
public/main.js             Browser-side API caller
public/styles.css          Minimal UI styling
scripts/local-app.mjs      Static file server + local Joy-Con API
scripts/joycon-hid-core.mjs Reusable HID implementation
scripts/joycon-rumble.mjs  CLI wrapper around the reusable HID implementation
package.json               Scripts and node-hid dependency
```
