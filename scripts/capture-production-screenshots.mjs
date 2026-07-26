import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const DEFAULT_URL = "https://production.d333fud52cy2ho.amplifyapp.com";
const OUTPUT_DIRECTORY = resolve(process.env.COLAPSO_CAPTURE_OUTPUT ?? "docs/media/screenshots");
const DESKTOP = { width: 1440, height: 1100, mobile: false };
const COCKPIT = { width: 1366, height: 768, mobile: false };
const MOBILE = { width: 390, height: 844, mobile: true };
const MEASUREMENT_VIEWPORTS = [
  { width: 1280, height: 720, mobile: false },
  COCKPIT,
  { width: 1440, height: 900, mobile: false },
  { width: 1920, height: 1080, mobile: false },
  { width: 1024, height: 768, mobile: false },
  { width: 768, height: 1024, mobile: false },
  MOBILE,
];
const commandArguments = process.argv.slice(2);
const measureOnly = commandArguments.includes("--measure");
const cockpitOnly = commandArguments.includes("--cockpit-only");
const requestedUrl = commandArguments.find((argument) => !argument.startsWith("--"));
const PREFERENCES = {
  version: 1,
  mute: true,
  reducedMotion: true,
  tutorialCompleted: true,
  lastMode: null,
  audioConsent: false,
};
const GUIDED_ROUTE = [
  ["OBSERVE", 6, 1], ["OBSERVE", 5, 0], ["MOVE", 5, 0],
  ["OBSERVE", 4, 0], ["MOVE", 4, 0], ["OBSERVE", 4, 1],
  ["MOVE", 4, 1], ["OBSERVE", 4, 2], ["OBSERVE", 3, 1],
  ["MOVE", 4, 2], ["OBSERVE", 4, 3], ["MOVE", 4, 3],
  ["MOVE", 3, 3], ["OBSERVE", 3, 4], ["MOVE", 3, 4],
  ["OBSERVE", 3, 5], ["OBSERVE", 2, 4], ["MOVE", 3, 5],
  ["MOVE", 2, 5], ["OBSERVE", 1, 5], ["MOVE", 1, 5],
  ["MOVE", 0, 5], ["MOVE", 0, 6],
];

function edgeExecutable() {
  const candidates = [
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates[0];
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    });
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(() => rejectOpen(new Error("Timed out opening the DevTools WebSocket.")), 10_000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); rejectOpen(new Error("Could not open the DevTools WebSocket.")); }, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { method, resolve: resolveCommand, reject: rejectCommand });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function stripWebpMetadata(buffer) {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Edge returned an invalid WebP screenshot.");
  }
  const chunks = [Buffer.from("WEBP", "ascii")];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > buffer.length) throw new Error(`Edge returned an invalid ${type} WebP chunk.`);
    if (!["ICCP", "EXIF", "XMP "].includes(type)) {
      const chunk = Buffer.from(buffer.subarray(offset, end));
      if (type === "VP8X" && length >= 10) chunk[8] &= ~(0x20 | 0x08 | 0x04);
      chunks.push(chunk);
    }
    offset = end;
  }
  const body = Buffer.concat(chunks);
  const output = Buffer.allocUnsafe(body.length + 8);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(body.length, 4);
  body.copy(output, 8);
  return output;
}

async function waitForPage(port) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Edge did not expose a debuggable page.${lastError ? ` ${lastError.message}` : ""}`);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed.");
  }
  return result.result?.value;
}

async function waitFor(client, expression, description, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function setViewport(client, viewport) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
}

async function navigate(client, url, viewport = DESKTOP) {
  await setViewport(client, viewport);
  await client.send("Page.navigate", { url });
  await waitFor(client, "document.readyState === 'complete'", "the production page to load", 30_000);
  await waitFor(client, "document.querySelector('#root')?.childElementCount > 0", "the React application to render");
}

async function resetExperience(client, url, viewport = DESKTOP) {
  await navigate(client, url, viewport);
  await evaluate(client, `localStorage.setItem("colapso:preferences", ${JSON.stringify(JSON.stringify(PREFERENCES))}); location.reload(); true`);
  await waitFor(client, "document.readyState === 'complete' && document.querySelector('#root')?.childElementCount > 0", "the clean production experience to render", 30_000);
  await waitFor(client, "document.body.innerText.includes('Observa antes de que el universo decida por ti.')", "the COLAPSO hero");
}

async function clickButton(client, label) {
  const encoded = JSON.stringify(label);
  const clicked = await evaluate(client, `(() => {
    const label = ${encoded};
    const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
    const buttons = [...document.querySelectorAll('button')].filter((button) => button.getClientRects().length > 0 && !button.disabled);
    const button = buttons.find((candidate) => candidate.getAttribute('aria-label') === label)
      ?? buttons.find((candidate) => normalize(candidate.innerText) === label)
      ?? buttons.find((candidate) => normalize(candidate.innerText).includes(label));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not find enabled button: ${label}`);
  await delay(80);
}

async function clickSelector(client, selector) {
  const encoded = JSON.stringify(selector);
  const clicked = await evaluate(client, `(() => {
    const element = document.querySelector(${encoded});
    if (!(element instanceof HTMLElement) || element.getClientRects().length === 0 || element.matches(':disabled')) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click selector: ${selector}`);
  await delay(80);
}

async function startMode(client, modeLabel) {
  await clickButton(client, "COMENZAR A JUGAR");
  await waitFor(client, "document.body.innerText.includes('¿Cómo quieres entrar al campo?')", "the mode selection dialog");
  await clickButton(client, modeLabel);
  await clickButton(client, "Comenzar experiencia");
  await waitFor(client, "document.body.innerText.includes('Consola del Observador')", `${modeLabel} gameplay`);
}

async function capture(client, filename, viewport = DESKTOP) {
  await evaluate(client, "window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); true");
  await delay(180);
  const result = await client.send("Page.captureScreenshot", {
    format: "webp",
    quality: 90,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (typeof result.data !== "string") throw new Error(`No screenshot data returned for ${filename}.`);
  const output = join(OUTPUT_DIRECTORY, filename);
  await mkdir(dirname(output), { recursive: true });
  const screenshot = stripWebpMetadata(Buffer.from(result.data, "base64"));
  await writeFile(output, screenshot);
  console.log(`captured ${filename} (${viewport.width}x${viewport.height})`);
}

async function measureGameplay(client, viewport) {
  await resetExperience(client, requestedUrl ?? DEFAULT_URL, viewport);
  await startMode(client, "MODO EXPLORADOR");
  await evaluate(client, "window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); true");
  await delay(120);
  return evaluate(client, `(() => {
    const rectangle = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right), bottom: Math.round(rect.bottom) };
    };
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const board = document.querySelector('.mission-board');
    const consoleElement = document.querySelector('.observer-console');
    const primaryAction = document.querySelector('.observer-console .action-button--primary');
    const cells = [...document.querySelectorAll('.mission-cell')];
    const inViewport = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= -1 && rect.left >= -1 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1;
    };
    const boardRect = board?.getBoundingClientRect();
    const consoleRect = consoleElement?.getBoundingClientRect();
    const pageScrollHeight = Math.max(scrollingElement.scrollHeight, document.body.scrollHeight);
    const pageScroll = pageScrollHeight > innerHeight + 1;
    const consoleScroll = consoleElement instanceof HTMLElement && consoleElement.scrollHeight > consoleElement.clientHeight + 1;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageScrollHeight,
      pageScroll,
      pageOverflowY: getComputedStyle(scrollingElement).overflowY,
      board: rectangle(board),
      console: rectangle(consoleElement),
      cells: cells.length,
      visibleCells: cells.filter(inViewport).length,
      allCellsVisible: cells.length === 49 && cells.every(inViewport),
      completeBoardVisible: boardRect !== undefined && boardRect.top >= -1 && boardRect.bottom <= innerHeight + 1,
      primaryAction: rectangle(primaryAction),
      primaryActionVisible: primaryAction instanceof HTMLElement && inViewport(primaryAction),
      consoleScroll,
      internalAndPageScroll: pageScroll && consoleScroll,
      consoleFullyVisible: consoleRect !== undefined && consoleRect.top >= -1 && consoleRect.bottom <= innerHeight + 1,
    };
  })()`);
}

async function guidedAction(client, action, index) {
  const [kind, row, col] = action;
  await clickSelector(client, `[data-testid="cell-${row}-${col}"]`);
  const label = kind === "OBSERVE" ? "Observar casilla" : "Mover aquí";
  await waitFor(client, `document.querySelector('.action-button--primary')?.innerText.includes(${JSON.stringify(label)})`, `${label} at guided step ${index + 1}`);
  await clickSelector(client, ".action-button--primary");
  if (index < GUIDED_ROUTE.length - 1) {
    await waitFor(client, `document.body.innerText.includes('PASO ${index + 2} DE ${GUIDED_ROUTE.length}')`, `guided step ${index + 2}`);
  } else {
    await waitFor(client, "document.body.innerText.includes('Llegaste a la salida')", "the completed guided result");
  }
}

async function main() {
  const url = new URL(requestedUrl ?? DEFAULT_URL).href;
  const edge = edgeExecutable();
  const profile = await mkdtemp(join(tmpdir(), "colapso-capture-"));
  const port = 10_000 + Math.floor(Math.random() * 40_000);
  const browser = spawn(edge, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,1100",
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  let client;
  try {
    const target = await waitForPage(port);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    if (measureOnly) {
      const measurements = [];
      for (const viewport of MEASUREMENT_VIEWPORTS) measurements.push(await measureGameplay(client, viewport));
      console.log(JSON.stringify(measurements, null, 2));
      return;
    }

    if (!cockpitOnly) {
      await resetExperience(client, url);
      await capture(client, "01-hero.webp");

      await clickButton(client, "Procedencia cuántica");
      await waitFor(client, "document.body.innerText.includes('Cómo nació este universo')", "the quantum provenance modal");
      await capture(client, "02-quantum-provenance.webp");
    }

    await resetExperience(client, url, COCKPIT);
    await startMode(client, "MODO EXPLORADOR");
    await clickSelector(client, ".quantum-pulse button");
    await waitFor(client, "document.querySelector('.quantum-pulse--active') !== null", "the explorer quantum pulse recommendation");
    await capture(client, "03-explorer-mode.webp", COCKPIT);

    await resetExperience(client, url, COCKPIT);
    await startMode(client, "RUTA GUIADA");
    await waitFor(client, `document.body.innerText.includes('PASO 1 DE ${GUIDED_ROUTE.length}')`, "guided journey step 1");
    await capture(client, "05-guided-journey.webp", COCKPIT);

    for (let index = 0; index < GUIDED_ROUTE.length; index += 1) {
      await guidedAction(client, GUIDED_ROUTE[index], index);
      if (index === 2) {
        await waitFor(client, "document.querySelector('[data-decoherence-pressure=\"maximum\"]') !== null", "the maximum decoherence alert");
        await capture(client, "04-decoherence-alert.webp", COCKPIT);
        if (cockpitOnly) break;
      }
    }

    if (!cockpitOnly) {
      await setViewport(client, DESKTOP);
      await capture(client, "06-final-result.webp");
    }

    await resetExperience(client, url, MOBILE);
    await capture(client, "07-mobile.webp", MOBILE);
  } finally {
    try { await client?.send("Browser.close"); } catch {}
    client?.close();
    browser.kill();
    await delay(300);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
