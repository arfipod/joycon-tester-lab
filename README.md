# Joy-Con WebHID Haptics POC

Experimental browser proof of concept for testing whether official Nintendo Switch Joy-Con L/R controllers can be detected and pulsed from Chrome or Edge through WebHID.

## What this tests

- Whether WebHID is available in the browser.
- Whether official Nintendo Joy-Con controllers are visible to the browser.
- Whether left/right can be identified using known official Nintendo IDs:
  - `vendorId 0x057e`: Nintendo
  - `productId 0x2006`: Joy-Con Left
  - `productId 0x2007`: Joy-Con Right
- Whether vibration can be enabled and triggered through HID output reports.
- Whether a basic left/right alternating pulse loop is stable enough for further investigation.

## What this does not guarantee

- It does not guarantee support in all browsers.
- It does not guarantee support in all operating systems.
- It does not guarantee support for clone Joy-Con controllers.

## Recommended environment

Use:

- Chrome or Edge desktop.
- HTTPS deployment or localhost.
- Official Nintendo Switch Joy-Con controllers, paired separately over Bluetooth.

Avoid testing first with clone controllers. If a clone fails, it is unclear whether the failure is caused by the browser, OS, WebHID, HID output reports, or the clone's protocol.

## Local run

```sh
npm install
npm run build
npm run preview
```

Then open:

```txt
http://localhost:4173
```

For quick static serving without building:

```sh
npx serve public -l 5173
```

Then open:

```txt
http://localhost:5173
```

`localhost` is considered a secure context by browsers, which is required for WebHID.

## Vercel deployment

This is a static project. Vercel should run:

```sh
npm run build
```

The configured output directory is:

```txt
dist
```

The project includes `vercel.json` with:

```json
{
  "outputDirectory": "dist"
}
```

After deployment, open the Vercel HTTPS URL in Chrome or Edge desktop.

## Test procedure

1. Pair the left and right Joy-Con with your computer through Bluetooth settings.
2. Open the POC in Chrome or Edge.
3. Confirm the page says:
   - Secure context: yes
   - WebHID: available
4. Click **Connect official Joy-Con**.
5. Select one or both Joy-Con in the browser picker.
6. If only one appears, repeat the connect action for the other controller.
7. Confirm the device boxes show:
   - Left: `vendorId 0x057e`, `productId 0x2006`
   - Right: `vendorId 0x057e`, `productId 0x2007`
8. Click **Enable vibration**.
9. Put both Joy-Con on a table.
10. Click **Test Left**.
11. Click **Test Right**.
12. Click **Start alternating**.
13. Click **Stop** and verify that vibration stops immediately.

## Troubleshooting

### WebHID unavailable

Use Chrome or Edge desktop. Safari and Firefox should not be treated as target browsers for this POC.

### Page is not a secure context

Use HTTPS or localhost. Do not open `index.html` directly via `file://`.

### Joy-Con do not appear

Try:

- Re-pairing the Joy-Con in OS Bluetooth settings.
- Turning Bluetooth off/on.
- Pressing the small sync button on each Joy-Con.
- Testing with only one Joy-Con connected first.
- Opening `chrome://device-log` to inspect HID-related events.

### Detection works but vibration does not

Copy the log and inspect:

- `productName`
- `vendorId`
- `productId`
- output report IDs
- error messages from `sendReport()`

The rumble packets are isolated in `public/main.js`:

```js
RUMBLE_PROFILES
buildRumblePayload()
enableVibration()
pulseDevice()
```

Adjust those first if the controller detects correctly but does not vibrate.

### Linux permission issue

On Linux, HID devices may require a udev rule for vendor `057e`. Chrome's WebHID documentation notes that some Linux systems map HID devices with read-only permissions by default.

## Files

```txt
public/index.html
public/styles.css
public/main.js
scripts/build.mjs
vercel.json
package.json
README.md
```

## Safety notes

- Keep controllers away from fragile surfaces during tests.
