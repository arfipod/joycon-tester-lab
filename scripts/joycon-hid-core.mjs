import HID from 'node-hid';

export const NINTENDO_VENDOR_ID = 0x057e;
export const JOYCON_LEFT_PRODUCT_ID = 0x2006;
export const JOYCON_RIGHT_PRODUCT_ID = 0x2007;
export const DEFAULT_PACKET_BYTES = 49;
export const DEFAULT_FRAME_INTERVAL_MS = 24;

export const RUMBLE_PROFILES = {
  neutral: [0x00, 0x01, 0x40, 0x40],
  low: [0x40, 0x40, 0x60, 0x41],
  medium: [0x98, 0x30, 0x61, 0x46],
  high: [0x28, 0x88, 0x60, 0x61],
};

const BATTERY_LABELS = ['Empty', 'Critical', 'Low', 'Medium', 'Full'];

let packetCounter = 0;

export function toHex(value, width = 4) {
  return `0x${Number(value).toString(16).padStart(width, '0')}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextPacketCounter() {
  packetCounter = (packetCounter + 1) & 0x0f;
  return packetCounter;
}

export function classifyDevice(device) {
  if (device.vendorId === NINTENDO_VENDOR_ID && device.productId === JOYCON_LEFT_PRODUCT_ID) return 'left';
  if (device.vendorId === NINTENDO_VENDOR_ID && device.productId === JOYCON_RIGHT_PRODUCT_ID) return 'right';

  const product = (device.product ?? '').toLowerCase();
  if (product.includes('joy-con') && (product.includes('(l)') || product.includes('left'))) return 'left';
  if (product.includes('joy-con') && (product.includes('(r)') || product.includes('right'))) return 'right';
  return 'unknown';
}

export function summarizeDevice(device, index = undefined) {
  return {
    ...(index === undefined ? {} : { index }),
    side: classifyDevice(device),
    product: device.product,
    manufacturer: device.manufacturer,
    vendorId: toHex(device.vendorId),
    productId: toHex(device.productId),
    usagePage: device.usagePage === undefined ? null : toHex(device.usagePage),
    usage: device.usage === undefined ? null : toHex(device.usage),
    interface: device.interface,
    release: device.release,
    serialNumber: device.serialNumber || null,
    battery: device.battery ?? null,
    path: device.path,
  };
}

export async function getNintendoDevices() {
  const devices = await HID.devicesAsync();
  return devices.filter((device) => device.vendorId === NINTENDO_VENDOR_ID);
}

export function parseBatteryReport(data) {
  const bytes = Array.from(data ?? []);
  const reportId = bytes[0];
  if (![0x21, 0x23, 0x30, 0x31, 0x32].includes(reportId) || bytes.length < 3) return null;

  const powerInfo = bytes[2];
  const level = (powerInfo >> 5) & 0x07;
  const known = level >= 0 && level <= 4;
  return {
    rawPowerInfo: toHex(powerInfo, 2),
    reportId: toHex(reportId, 2),
    level: known ? level : null,
    label: known ? BATTERY_LABELS[level] : 'Unknown',
    percent: known ? level * 25 : null,
    charging: (powerInfo & 0x10) !== 0,
  };
}

async function readBatterySnapshot(deviceInfo) {
  const device = new HID.HID(deviceInfo.path);
  try {
    writeReport(device, 0x01, buildSubcommandPayload(0x03, [0x30]), DEFAULT_PACKET_BYTES, 'set input report mode', undefined, { quiet: true });
    for (let attempts = 0; attempts < 6; attempts += 1) {
      const report = device.readTimeout(160);
      const battery = parseBatteryReport(report);
      if (battery) return battery;
    }
    return { label: 'Unknown', level: null, percent: null, charging: null, rawPowerInfo: null, reportId: null };
  } catch (error) {
    return { label: 'Unknown', level: null, percent: null, charging: null, rawPowerInfo: null, reportId: null, error: error.message };
  } finally {
    try {
      device.close();
    } catch {
      // Closing can throw if the device was already detached.
    }
  }
}

export async function listJoyCons({ includeBattery = true } = {}) {
  const devices = await getNintendoDevices();
  const enriched = [];
  for (let index = 0; index < devices.length; index += 1) {
    const device = devices[index];
    if (includeBattery) device.battery = await readBatterySnapshot(device);
    enriched.push(summarizeDevice(device, index));
  }
  return enriched;
}

export function selectTargets(devices, options = {}) {
  if (options.path) {
    const match = devices.find((device) => device.path === options.path);
    if (!match) throw new Error(`No Nintendo HID device has path: ${options.path}`);
    return [match];
  }

  const side = options.side ?? 'both';
  if (!['left', 'right', 'both'].includes(side)) {
    throw new Error('side must be left, right, or both.');
  }

  const sides = side === 'both' ? ['left', 'right'] : [side];
  return sides.map((requestedSide) => {
    const match = devices.find((device) => classifyDevice(device) === requestedSide);
    if (!match) throw new Error(`No ${requestedSide} Joy-Con was found.`);
    return match;
  });
}

function packet(reportId, payload, packetBytes) {
  const bytes = new Array(packetBytes).fill(0);
  bytes[0] = reportId;
  bytes.splice(1, payload.length, ...payload);
  return bytes;
}

function buildRumblePayload(profileName) {
  const frame = RUMBLE_PROFILES[profileName] ?? RUMBLE_PROFILES.medium;
  return [nextPacketCounter(), ...frame, ...frame];
}

function buildSubcommandPayload(subcommandId, subcommandData = [], profileName = 'neutral') {
  const frame = RUMBLE_PROFILES[profileName] ?? RUMBLE_PROFILES.neutral;
  return [nextPacketCounter(), ...frame, ...frame, subcommandId, ...subcommandData];
}

function emit(onEvent, type, data) {
  const event = { time: new Date().toISOString(), type, ...data };
  onEvent?.(event);
  return event;
}

function writeReport(device, reportId, payload, packetBytes, label, onEvent, { quiet = false } = {}) {
  const data = packet(reportId, payload, packetBytes);
  const written = device.write(data);
  const event = { label, reportId: toHex(reportId, 2), writtenBytes: written };
  if (!quiet) emit(onEvent, 'write', event);
  return event;
}

async function enableVibration(device, packetBytes, onEvent) {
  writeReport(device, 0x01, buildSubcommandPayload(0x48, [0x01]), packetBytes, 'enable vibration', onEvent);
  await sleep(40);
}

async function sendNeutral(device, packetBytes, onEvent) {
  writeReport(device, 0x10, buildRumblePayload('neutral'), packetBytes, 'neutral', onEvent);
  await sleep(30);
}

async function streamRumble(device, packetBytes, intensity, durationMs, onEvent, options = {}) {
  const startedAt = performance.now();
  let frameCount = 0;
  do {
    writeReport(device, 0x10, buildRumblePayload(intensity), packetBytes, `rumble ${intensity}`, onEvent, { quiet: !options.verbose });
    frameCount += 1;
    await sleep(DEFAULT_FRAME_INTERVAL_MS);
  } while (performance.now() - startedAt < durationMs);
  emit(onEvent, 'stream', { intensity, durationMs, frameCount });
}

async function withOpenDevice(target, onEvent, callback) {
  emit(onEvent, 'open', { device: summarizeDevice(target) });
  const device = new HID.HID(target.path);
  try {
    return await callback(device);
  } finally {
    try {
      device.close();
    } catch {
      // Closing can throw if the device was already detached.
    }
  }
}

function normalizePulseOptions(options = {}) {
  const packetBytes = Number(options.packetBytes ?? DEFAULT_PACKET_BYTES);
  const durationMs = Number(options.duration ?? options.durationMs ?? 500);
  const repeats = Number(options.repeats ?? 1);
  const intensity = options.intensity ?? 'medium';

  if (!RUMBLE_PROFILES[intensity]) throw new Error('intensity must be low, medium, or high.');
  if (!Number.isInteger(packetBytes) || packetBytes < 12) throw new Error('packetBytes must be at least 12.');
  if (!Number.isFinite(durationMs) || durationMs < 20) throw new Error('duration must be at least 20 ms.');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('repeats must be between 1 and 20.');

  return { packetBytes, durationMs, repeats, intensity, verbose: options.verbose === true || options.verbose === 'true' };
}

export async function pulseJoyCons(options = {}, onEvent) {
  const devices = await getNintendoDevices();
  const targets = selectTargets(devices, options);
  const pulseOptions = normalizePulseOptions(options);

  for (const target of targets) {
    await withOpenDevice(target, onEvent, async (device) => {
      await enableVibration(device, pulseOptions.packetBytes, onEvent);

      for (let index = 0; index < pulseOptions.repeats; index += 1) {
        emit(onEvent, 'pulse', {
          side: classifyDevice(target),
          repeat: index + 1,
          repeats: pulseOptions.repeats,
          intensity: pulseOptions.intensity,
          durationMs: pulseOptions.durationMs,
        });
        await streamRumble(device, pulseOptions.packetBytes, pulseOptions.intensity, pulseOptions.durationMs, onEvent, pulseOptions);
        await sendNeutral(device, pulseOptions.packetBytes, onEvent);
        await sleep(180);
      }
    });
  }
}

export async function sweepJoyCons(options = {}, onEvent) {
  const devices = await getNintendoDevices();
  const targets = selectTargets(devices, options);
  const packetBytes = Number(options.packetBytes ?? DEFAULT_PACKET_BYTES);
  if (!Number.isInteger(packetBytes) || packetBytes < 12) throw new Error('packetBytes must be at least 12.');

  for (const target of targets) {
    await withOpenDevice(target, onEvent, async (device) => {
      await enableVibration(device, packetBytes, onEvent);

      for (const intensity of ['low', 'medium', 'high']) {
        emit(onEvent, 'sweep', { side: classifyDevice(target), intensity });
        await streamRumble(device, packetBytes, intensity, 350, onEvent, options);
        await sendNeutral(device, packetBytes, onEvent);
        await sleep(220);
      }
    });
  }
}

export async function neutralJoyCons(options = {}, onEvent) {
  const devices = await getNintendoDevices();
  const targets = selectTargets(devices, options);
  const packetBytes = Number(options.packetBytes ?? DEFAULT_PACKET_BYTES);
  if (!Number.isInteger(packetBytes) || packetBytes < 12) throw new Error('packetBytes must be at least 12.');

  for (const target of targets) {
    await withOpenDevice(target, onEvent, async (device) => {
      await sendNeutral(device, packetBytes, onEvent);
    });
  }
}
