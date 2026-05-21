# Joy-Con WebHID Haptics POC

Experimental browser proof of concept for testing whether official Nintendo Switch Joy-Con L/R controllers can be detected and pulsed from Chrome or Edge through WebHID.

This project is intentionally isolated from Open Bistimulation. It is not medical software, not a therapy tool, and not intended for clinical use. It only tests browser/hardware behavior.

## What this tests

- Whether WebHID is available in the browser.
- Whether official Nintendo Joy-Con controllers can be detected.
- Whether the left and right Joy-Con can be classified independently.
- Whether experimental rumble output reports can trigger haptic feedback.
- Whether alternating left/right pulses are stable enough to consider later integration.

## Expected official Joy-Con IDs

The POC prioritizes the documented Nintendo HID identifiers:

| Device | Vendor ID | Product ID |
|---|---:|---:|
| Nintendo | `0x057e` | - |
| Joy-Con Left | `0x057e` | `0x2006` |
| Joy-Con Right | `0x057e` | `0x2007` |

If your Joy-Con appear with different IDs, copy the log and inspect it before assuming failure.

## Browser requirements

Use a desktop Chromium browser:

- Google Chrome desktop
- Microsoft Edge desktop

WebHID is not universally available. Safari and Firefox are not expected to work for this POC.

The page must run in a secure context. `localhost` and HTTPS deployments such as Vercel are valid secure contexts.

## Local run

```sh
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Build

```sh
npm run build
```

The static output is generated in:

```text
dist/
```

## Deploy to Vercel

This project is static. Vercel should use:

```text
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

`vercel.json` already sets the output directory to `dist` and adds a `Permissions-Policy` header for HID.

## Pairing procedure

1. Disconnect both Joy-Con from the Nintendo Switch.
2. Put each Joy-Con in pairing mode.
3. Pair them with your PC over Bluetooth.
4. Open this page in Chrome or Edge desktop.
5. Click **Connect Joy-Con**.
6. Select the Joy-Con devices from the browser permission dialog.
7. Check the visible log.
8. Run **Test Left** and **Test Right**.
9. Run **Start alternating** for 30-60 seconds.
10. Press **Stop** and confirm vibration stops immediately.

## Success criteria

The POC is considered useful only if all of these are true:

- Both Joy-Con appear in the log.
- Left is classified as `left`.
- Right is classified as `right`.
- `Test Left` only affects the left Joy-Con.
- `Test Right` only affects the right Joy-Con.
- Alternating mode runs for at least 60 seconds without obvious dropouts.
- Stop cuts active haptic output immediately.
- Disconnecting a Joy-Con does not crash the page.

## Known limitations

- This is experimental browser hardware code.
- Joy-Con HD Rumble output reports are device-specific.
- Browser, OS and Bluetooth adapter behavior may differ.
- Generic Gamepad API rumble is intentionally not used here because it does not provide reliable physical left/right Joy-Con separation.
- The current rumble payload is a conservative experimental implementation and may need adjustment after inspecting real logs.

## Troubleshooting

### WebHID unavailable

Use Chrome or Edge desktop. Confirm the page is loaded from `localhost` or HTTPS.

### Joy-Con do not appear

- Re-pair the Joy-Con with the operating system.
- Ensure they are disconnected from the Nintendo Switch.
- Restart Bluetooth.
- Reload the page and click **Connect Joy-Con** again.

### Joy-Con appear but are not classified

Copy the log. Check `productName`, `vendorId`, and `productId`.

### Detection works but rumble does not

This means WebHID access is working, but the output report payload probably needs adjustment. Keep the log and test on the same browser/OS while iterating the rumble packet implementation.

### Vibration gets stuck

Press **Stop**, then **Disconnect all**. The page also tries to stop output when the tab becomes hidden or devices disconnect.

## Safety note

Use short pulses and low intensity first. Stop immediately if the controller behaves unexpectedly, disconnects repeatedly, heats up, or continues vibrating after pressing stop.

## License

MIT.