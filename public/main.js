const els = {
  apiStatus: document.getElementById('apiStatus'),
  leftStatus: document.getElementById('leftStatus'),
  rightStatus: document.getElementById('rightStatus'),
  durationMs: document.getElementById('durationMs'),
  intensity: document.getElementById('intensity'),
  refreshBtn: document.getElementById('refreshBtn'),
  leftBtn: document.getElementById('leftBtn'),
  rightBtn: document.getElementById('rightBtn'),
  bothBtn: document.getElementById('bothBtn'),
  stopBtn: document.getElementById('stopBtn'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  log: document.getElementById('log'),
};

let localApiReady = false;
let lastDevices = [];

function now() {
  return new Date().toLocaleTimeString();
}

function log(message, data) {
  const details = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  els.log.textContent += `${now()} ${message}${details}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function setControlsEnabled(enabled) {
  if (!enabled) {
    for (const button of [els.leftBtn, els.rightBtn, els.bothBtn, els.refreshBtn, els.stopBtn]) {
      button.disabled = true;
    }
    return;
  }

  const hasLeft = lastDevices.some((device) => device.side === 'left');
  const hasRight = lastDevices.some((device) => device.side === 'right');
  els.leftBtn.disabled = !hasLeft;
  els.rightBtn.disabled = !hasRight;
  els.bothBtn.disabled = !(hasLeft && hasRight);
  els.stopBtn.disabled = !(hasLeft || hasRight);
  els.refreshBtn.disabled = false;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function summarizeDevice(device) {
  if (!device) return 'Not detected';
  const battery = device.battery ? (device.battery.percent === null ? device.battery.label : `${device.battery.label} (${device.battery.percent}%)`) : '';
  const charging = device.battery?.charging ? ', charging' : '';
  return `${device.productId} ${device.product}${battery ? ` - ${battery}${charging}` : ''}`;
}

function renderDevices(devices) {
  lastDevices = devices;
  const left = devices.find((device) => device.side === 'left');
  const right = devices.find((device) => device.side === 'right');

  els.leftStatus.textContent = summarizeDevice(left);
  els.rightStatus.textContent = summarizeDevice(right);

  localApiReady = true;
  els.apiStatus.textContent = left || right ? 'Ready' : 'API ready, no Joy-Con detected';
  setControlsEnabled(true);

  log('Devices refreshed', {
    count: devices.length,
    left: left?.productId ?? null,
    right: right?.productId ?? null,
    leftBattery: left?.battery ?? null,
    rightBattery: right?.battery ?? null,
  });
}

function summarizeEvents(events) {
  return events
    .filter((event) => ['open', 'pulse', 'stream', 'write'].includes(event.type))
    .map((event) => {
      if (event.type === 'open') return `${event.device.side} opened`;
      if (event.type === 'pulse') return `${event.side} ${event.intensity} ${event.durationMs}ms`;
      if (event.type === 'stream') return `${event.frameCount} frames`;
      if (event.type === 'write') return `${event.label} ${event.writtenBytes} bytes`;
      return event.type;
    });
}

async function refreshDevices() {
  try {
    await api('/api/joycon/status');
    const data = await api('/api/joycon/devices');
    renderDevices(data.devices);
  } catch (error) {
    localApiReady = false;
    lastDevices = [];
    els.apiStatus.textContent = 'Unavailable - run npm run dev';
    els.leftStatus.textContent = 'Unknown';
    els.rightStatus.textContent = 'Unknown';
    setControlsEnabled(false);
    log('Local HID API unavailable', { error: error.message });
  }
}

function pulseBody(side) {
  return {
    side,
    intensity: els.intensity.value,
    duration: clampNumber(Number(els.durationMs.value), 20, 3000, 450),
    repeats: 1,
  };
}

async function pulse(side) {
  setControlsEnabled(false);
  try {
    const data = await api('/api/joycon/pulse', { method: 'POST', body: pulseBody(side) });
    log(`Pulse ${side} complete`, summarizeEvents(data.events ?? []));
  } finally {
    await refreshDevices();
  }
}

async function stop() {
  const data = await api('/api/joycon/neutral', { method: 'POST', body: { side: 'both' } });
  log('Stop complete', summarizeEvents(data.events ?? []));
}

function wireEvents() {
  els.refreshBtn.addEventListener('click', () => refreshDevices());
  els.leftBtn.addEventListener('click', () => pulse('left').catch((error) => log('Left pulse failed', { error: error.message })));
  els.rightBtn.addEventListener('click', () => pulse('right').catch((error) => log('Right pulse failed', { error: error.message })));
  els.bothBtn.addEventListener('click', () => pulse('both').catch((error) => log('Both pulse failed', { error: error.message })));
  els.stopBtn.addEventListener('click', () => stop().catch((error) => log('Stop failed', { error: error.message })));
  els.clearLogBtn.addEventListener('click', () => {
    els.log.textContent = '';
    log('Log cleared');
  });
}

setControlsEnabled(false);
wireEvents();
refreshDevices();
