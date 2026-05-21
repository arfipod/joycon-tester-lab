#!/usr/bin/env node
import { listJoyCons, pulseJoyCons, RUMBLE_PROFILES, sweepJoyCons } from './joycon-hid-core.mjs';

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  const command = positional[0] ?? 'help';
  const positionalOptions = positional.slice(1);
  if (!options.side && ['left', 'right', 'both'].includes(positionalOptions[0])) options.side = positionalOptions[0];
  if (!options.intensity && RUMBLE_PROFILES[positionalOptions[1]]) options.intensity = positionalOptions[1];
  if (!options.duration && positionalOptions[2]) options.duration = positionalOptions[2];
  if (!options.repeats && positionalOptions[3]) options.repeats = positionalOptions[3];

  return { command, options };
}

function printHelp() {
  console.log(`Joy-Con direct HID rumble tester

Commands:
  list
    List visible Nintendo HID devices.

  pulse --side left|right|both [--intensity low|medium|high] [--duration 500]
    Enable vibration and pulse the selected Joy-Con independently.
    Positional form also works: pulse left high 900 2

  sweep --side left|right|both
    Try low, medium, and high profiles on the selected Joy-Con.

Options:
  --packet-bytes 49
    HID output packet length including the report ID. Try 64 if 49 fails.

  --path "..."
    Open an exact HID path from the list command.

  --repeats 1
    Repeat the selected pulse this many times.

Examples:
  npm run joycon:list
  npm run joycon:left
  npm run joycon:right
  npm run joycon:pulse -- left high 800 2
  node scripts/joycon-rumble.mjs pulse --side left --intensity high --duration 800
  node scripts/joycon-rumble.mjs sweep --side both --packet-bytes 64
`);
}

function printEvent(event) {
  if (event.type === 'open') {
    console.log(`Opening ${event.device.side} ${event.device.product} (${event.device.productId})`);
    return;
  }
  if (event.type === 'write') {
    console.log(`${event.label}: report ${event.reportId}, wrote ${event.writtenBytes} bytes`);
    return;
  }
  if (event.type === 'stream') {
    console.log(`streamed ${event.frameCount} ${event.intensity} rumble frames over about ${event.durationMs} ms`);
    return;
  }
  if (event.type === 'pulse') {
    console.log(`Pulse ${event.repeat}/${event.repeats}: ${event.intensity}, ${event.durationMs} ms`);
    return;
  }
  if (event.type === 'sweep') {
    console.log(`Sweep ${event.side}: ${event.intensity}`);
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'help' || options.help) {
    printHelp();
    return;
  }

  if (command === 'list') {
    const devices = await listJoyCons();
    if (devices.length === 0) {
      console.log('No Nintendo HID devices are visible to node-hid.');
      return;
    }
    for (const device of devices) console.log(JSON.stringify(device, null, 2));
    return;
  }

  if (command === 'pulse') {
    await pulseJoyCons(options, printEvent);
    return;
  }

  if (command === 'sweep') {
    await sweepJoyCons(options, printEvent);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
