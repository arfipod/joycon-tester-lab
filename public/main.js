const NINTENDO_VENDOR_ID = 0x057e;
const JOYCON_LEFT_PRODUCT_ID = 0x2006;
const JOYCON_RIGHT_PRODUCT_ID = 0x2007;

const els = {
  secureContextStatus: document.getElementById('secureContextStatus'),
  webHidStatus: document.getElementById('webHidStatus'),
  userAgentStatus: document.getElementById('userAgentStatus'),
  connectBtn: document.getElementById('connectBtn'),
  listBtn: document.getElementById('listBtn'),
  forgetBtn: document.getElementById('forgetBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  enableVibrationBtn: document.getElementById('enableVibrationBtn'),
  testLeftBtn: document.getElementById('testLeftBtn'),
  testRightBtn: document.getElementById('testRightBtn'),
  testBothBtn: document.getElementById('testBothBtn'),
  alternateBtn: document.getElementById('alternateBtn'),
  stopBtn: document.getElementById('stopBtn'),
  intervalMs: document.getElementById('intervalMs'),
  pulseMs: document.getElementById('pulseMs'),
  intensity: document.getElementById('intensity'),
  cycleLimit: document.getElementById('cycleLimit'),
  leftDeviceBox: document.getElementById('leftDeviceBox'),
  rightDeviceBox: document.getElementById('rightDeviceBox'),
  log: document.getElementById('log'),
  copyLogBtn: document.getElementById('copyLogBtn'),
  clearLogBtn: document.getElementById('clearLogBtn'),
};

let devices = [];
let leftDevice = null;
let rightDevice = null;
let alternatingTimer = null;
let alternatingCycleCount = 0;
let nextPhase = 'left';
let packetCounter = 0;

const RUMBLE_PROFILES = {
  // Joy-Con rumble bytes are device-specific. These profiles intentionally send the
  // same encoded motor frame to both rumble slots of the selected physical Joy-Con.
  // If your device detects but does not vibrate, capture the log and adjust here first.
  neutral: [0x00, 0x01, 0x40, 0x40],
  low: [0x40, 0x40, 0x60, 0x41],
  medium: [0x98, 0x30, 0x61, 0x46],
  high: [0x28, 0x88, 0x60, 0x61],
};

function toHex(value, width = 4) {
  return `0x${Number(value).toString(16).padStart(width, '0')}`;
}

function now() {
  return new Date().toISOString();
}

function log(message, data) {
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data, null, 2)}`;
  els.log.textContent += `${now()} ${message}${suffix}\n`;
  els.log.scrollTop = els.log.scrollHeight;
  console.log(message, data ?? '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertWebHid() {
  if (!('hid' in navigator)) {
    throw new Error('WebHID is not available. Use Chrome or Edge desktop over HTTPS or localhost.');
  }
  if (!window.isSecureContext) {
    throw new Error('WebHID requires a secure context. Use HTTPS or localhost.');
  }
}

function classifyDevice(device) {
  if (device.vendorId === NINTENDO_VENDOR_ID && device.productId === JOYCON_LEFT_PRODUCT_ID) return 'left';
  if (device.vendorId === NINTENDO_VENDOR_ID && device.productId === JOYCON_RIGHT_PRODUCT_ID) return 'right';

  const name = (device.productName || '').toLowerCase();
  if (name.includes('joy-con') && (name.includes('(l)') || name.includes('left'))) return 'left';
  if (name.includes('joy-con') && (name.includes('(r)') || name.includes('right'))) return 'right';
  return 'unknown';
}

function describeDevice(device) {
  if (!device) return 'Not detected.';
  const collections = device.collections ?? [];
  return JSON.stringify(
    {
      productName: device.productName,
      vendorId: toHex(device.vendorId),
      productId: toHex(device.productId),
      side: classifyDevice(device),
      opened: device.opened,
      collectionCount: collections.length,
      inputReportIds: collectReportIds(collections, 'inputReports'),
      outputReportIds: collectReportIds(collections, 'outputReports'),
      featureReportIds: collectReportIds(collections, 'featureReports'),
    },
    null,
    2,
  );
}

function collectReportIds(collections, reportKey) {
  const ids = new Set();
  const walk = (collection) => {
    for (const report of collection[reportKey] ?? []) ids.add(toHex(report.reportId, 2));
    for (const child of collection.children ?? []) walk(child);
  };
  for (const collection of collections) walk(collection);
  return [...ids];
}

function refreshClassification() {
  leftDevice = null;
  rightDevice = null;

  for (const device of devices) {
    const side = classifyDevice(device);
    if (side === 'left' && !leftDevice) leftDevice = device;
    if (side === 'right' && !rightDevice) rightDevice = device;
  }

  els.leftDeviceBox.textContent = describeDevice(leftDevice);
  els.rightDeviceBox.textContent = describeDevice(rightDevice);

  log('Classification refreshed', {
    totalKnownNintendoDevices: devices.length,
    left: leftDevice ? `${leftDevice.productName} ${toHex(leftDevice.productId)}` : null,
    right: rightDevice ? `${rightDevice.productName} ${toHex(rightDevice.productId)}` : null,
  });
}

async function openDevice(device) {
  if (!device) throw new Error('No device selected.');
  if (!device.opened) await device.open();
  return device;
}

function attachInputLogging(device) {
  if (device.__joyconPocInputLoggingAttached) return;
  device.__joyconPocInputLoggingAttached = true;
  device.addEventListener('inputreport', (event) => {
    const firstBytes = [...new Uint8Array(event.data.buffer)].slice(0, 12).map((byte) => toHex(byte, 2));
    log('Input report', {
      productName: event.device.productName,
      reportId: toHex(event.reportId, 2),
      byteLength: event.data.byteLength,
      firstBytes,
    });
  });
}

async function connectJoyCon() {
  assertWebHid();
  const selected = await navigator.hid.requestDevice({
    filters: [
      { vendorId: NINTENDO_VENDOR_ID, productId: JOYCON_LEFT_PRODUCT_ID },
      { vendorId: NINTENDO_VENDOR_ID, productId: JOYCON_RIGHT_PRODUCT_ID },
    ],
  });

  if (selected.length === 0) {
    log('No devices selected.');
    return;
  }

  for (const device of selected) {
    await openDevice(device);
    attachInputLogging(device);
    upsertDevice(device);
    log('Connected device', summarizeDevice(device));
  }

  refreshClassification();
}

async function listKnownDevices() {
  assertWebHid();
  const known = await navigator.hid.getDevices();
  devices = known.filter((device) => device.vendorId === NINTENDO_VENDOR_ID);

  for (const device of devices) {
    try {
      await openDevice(device);
      attachInputLogging(device);
    } catch (error) {
      log('Known device could not be opened', {
        ...summarizeDevice(device),
        error: error.message,
      });
    }
    log('Known Nintendo HID device', summarizeDevice(device));
  }

  refreshClassification();
}

function upsertDevice(device) {
  const existingIndex = devices.findIndex(
    (candidate) => candidate.vendorId === device.vendorId && candidate.productId === device.productId && candidate.productName === device.productName,
  );
  if (existingIndex >= 0) devices[existingIndex] = device;
  else devices.push(device);
}

function summarizeDevice(device) {
  return {
    productName: device.productName,
    vendorId: toHex(device.vendorId),
    productId: toHex(device.productId),
    side: classifyDevice(device),
    opened: device.opened,
    collectionCount: device.collections?.length ?? 0,
  };
}

function nextPacketCounter() {
  packetCounter = (packetCounter + 1) & 0x0f;
  return packetCounter;
}

function buildRumblePayload(profileName) {
  const frame = RUMBLE_PROFILES[profileName] ?? RUMBLE_PROFILES.medium;
  return new Uint8Array([nextPacketCounter(), ...frame, ...frame]);
}

async function enableVibration(device) {
  await openDevice(device);

  // Report 0x01: subcommand packet. This sequence is the public Chrome WebHID
  // Joy-Con example for enabling vibration, derived from joycon-toolweb.
  const enableVibrationData = [
    nextPacketCounter(),
    ...RUMBLE_PROFILES.neutral,
    ...RUMBLE_PROFILES.neutral,
    0x48,
    0x01,
  ];
  await device.sendReport(0x01, new Uint8Array(enableVibrationData));
  log('Enable vibration command sent', summarizeDevice(device));
}

async function stopRumble(device) {
  if (!device) return;
  try {
    await openDevice(device);
    await device.sendReport(0x10, buildRumblePayload('neutral'));
    log('Neutral rumble packet sent', summarizeDevice(device));
  } catch (error) {
    log('Failed to send neutral rumble packet', { ...summarizeDevice(device), error: error.message });
  }
}

async function pulseDevice(device, side) {
  const pulseMs = clampNumber(Number(els.pulseMs.value), 20, 1000, 120);
  const intensity = els.intensity.value;

  await openDevice(device);
  await enableVibration(device);

  log(`Pulse ${side} start`, { durationMs: pulseMs, intensity, device: summarizeDevice(device) });

  await device.sendReport(0x10, buildRumblePayload(intensity));
  await sleep(pulseMs);
  await device.sendReport(0x10, buildRumblePayload('neutral'));

  log(`Pulse ${side} stop`, { durationMs: pulseMs, intensity });
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function testLeft() {
  if (!leftDevice) throw new Error('Left Joy-Con not detected.');
  await pulseDevice(leftDevice, 'left');
}

async function testRight() {
  if (!rightDevice) throw new Error('Right Joy-Con not detected.');
  await pulseDevice(rightDevice, 'right');
}

async function testBoth() {
  await Promise.allSettled([testLeft(), testRight()]);
}

async function enableBothVibration() {
  const targets = [leftDevice, rightDevice].filter(Boolean);
  if (targets.length === 0) throw new Error('No Joy-Con detected.');
  for (const device of targets) await enableVibration(device);
}

function startAlternating() {
  stopAlternatingOnly();
  alternatingCycleCount = 0;
  nextPhase = 'left';

  const intervalMs = clampNumber(Number(els.intervalMs.value), 100, 5000, 500);
  const cycleLimit = clampNumber(Number(els.cycleLimit.value), 1, 240, 20);

  log('Start alternating requested', { intervalMs, cycleLimit });

  alternatingTimer = window.setInterval(async () => {
    try {
      if (alternatingCycleCount >= cycleLimit) {
        await stopAll('Cycle limit reached');
        return;
      }

      if (nextPhase === 'left') {
        await testLeft();
        nextPhase = 'right';
      } else {
        await testRight();
        nextPhase = 'left';
      }

      alternatingCycleCount += 1;
    } catch (error) {
      log('Alternating loop failed; stopping', { error: error.message });
      await stopAll('Alternating loop failure');
    }
  }, intervalMs);
}

function stopAlternatingOnly() {
  if (alternatingTimer !== null) {
    window.clearInterval(alternatingTimer);
    alternatingTimer = null;
  }
}

async function stopAll(reason = 'Manual stop') {
  stopAlternatingOnly();
  nextPhase = 'left';
  alternatingCycleCount = 0;

  log('Stop all requested', { reason });
  await Promise.allSettled([stopRumble(leftDevice), stopRumble(rightDevice)]);
}

async function disconnectAll() {
  await stopAll('Disconnect all');
  for (const device of devices) {
    try {
      if (device.opened) await device.close();
      log('Closed device', summarizeDevice(device));
    } catch (error) {
      log('Failed to close device', { ...summarizeDevice(device), error: error.message });
    }
  }
  devices = [];
  refreshClassification();
}

async function forgetSelectedPermissions() {
  assertWebHid();
  await stopAll('Forget permissions');
  const known = await navigator.hid.getDevices();
  for (const device of known.filter((candidate) => candidate.vendorId === NINTENDO_VENDOR_ID)) {
    if ('forget' in device) {
      try {
        await device.forget();
        log('Forgot HID permission', summarizeDevice(device));
      } catch (error) {
        log('Failed to forget HID permission', { ...summarizeDevice(device), error: error.message });
      }
    } else {
      log('HID forget() unavailable in this browser', summarizeDevice(device));
    }
  }
  devices = [];
  refreshClassification();
}

function updateEnvironment() {
  els.secureContextStatus.textContent = window.isSecureContext ? 'Yes' : 'No — use HTTPS or localhost';
  els.webHidStatus.textContent = 'hid' in navigator ? 'Available' : 'Unavailable — use Chrome/Edge desktop';
  els.userAgentStatus.textContent = navigator.userAgent;
}

async function copyLog() {
  await navigator.clipboard.writeText(els.log.textContent);
  log('Log copied to clipboard');
}

function wireEvents() {
  els.connectBtn.addEventListener('click', () => connectJoyCon().catch((error) => log('Connect failed', { error: error.message })));
  els.listBtn.addEventListener('click', () => listKnownDevices().catch((error) => log('List failed', { error: error.message })));
  els.forgetBtn.addEventListener('click', () => forgetSelectedPermissions().catch((error) => log('Forget failed', { error: error.message })));
  els.disconnectBtn.addEventListener('click', () => disconnectAll().catch((error) => log('Disconnect failed', { error: error.message })));
  els.enableVibrationBtn.addEventListener('click', () => enableBothVibration().catch((error) => log('Enable vibration failed', { error: error.message })));
  els.testLeftBtn.addEventListener('click', () => testLeft().catch((error) => log('Left test failed', { error: error.message })));
  els.testRightBtn.addEventListener('click', () => testRight().catch((error) => log('Right test failed', { error: error.message })));
  els.testBothBtn.addEventListener('click', () => testBoth().catch((error) => log('Both test failed', { error: error.message })));
  els.alternateBtn.addEventListener('click', startAlternating);
  els.stopBtn.addEventListener('click', () => stopAll().catch((error) => log('Stop failed', { error: error.message })));
  els.copyLogBtn.addEventListener('click', () => copyLog().catch((error) => log('Copy log failed', { error: error.message })));
  els.clearLogBtn.addEventListener('click', () => { els.log.textContent = ''; log('Log cleared'); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAll('Document hidden').catch((error) => log('Visibility stop failed', { error: error.message }));
  });

  window.addEventListener('beforeunload', () => {
    stopAlternatingOnly();
  });

  if ('hid' in navigator) {
    navigator.hid.addEventListener('connect', (event) => {
      log('HID device connected', summarizeDevice(event.device));
    });
    navigator.hid.addEventListener('disconnect', (event) => {
      log('HID device disconnected', summarizeDevice(event.device));
      devices = devices.filter((device) => device !== event.device);
      refreshClassification();
      stopAll('HID disconnect').catch((error) => log('Disconnect stop failed', { error: error.message }));
    });
  }
}

updateEnvironment();
wireEvents();
log('Ready', {
  secureContext: window.isSecureContext,
  webhid: 'hid' in navigator,
  expectedVendorId: toHex(NINTENDO_VENDOR_ID),
  expectedLeftProductId: toHex(JOYCON_LEFT_PRODUCT_ID),
  expectedRightProductId: toHex(JOYCON_RIGHT_PRODUCT_ID),
});
