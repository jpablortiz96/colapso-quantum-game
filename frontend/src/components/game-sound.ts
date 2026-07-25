import { Howl, Howler } from "howler";

export type GameSound =
  | "focus"
  | "cta"
  | "select"
  | "observe"
  | "collapse"
  | "move"
  | "path"
  | "wall"
  | "void"
  | "crystal"
  | "battery"
  | "decoherencePulse"
  | "powerX"
  | "powerH"
  | "pulse"
  | "tensionTick"
  | "tensionHigh"
  | "tensionPeak"
  | "resourceWarning"
  | "resourceRisk"
  | "resourceHigh"
  | "resourceMaximum"
  | "rewind"
  | "victory"
  | "defeat"
  | "panel";

type Waveform = "sine" | "triangle" | "square";

type ToneProfile = {
  readonly frequency: number;
  readonly duration: number;
  readonly volume: number;
  readonly waveform?: Waveform;
};

const profiles: Record<GameSound, readonly ToneProfile[]> = {
  focus: [{ frequency: 510, duration: 0.025, volume: 0.035, waveform: "triangle" }],
  cta: [
    { frequency: 440, duration: 0.055, volume: 0.08, waveform: "triangle" },
    { frequency: 660, duration: 0.09, volume: 0.07, waveform: "sine" },
  ],
  select: [
    { frequency: 480, duration: 0.045, volume: 0.065, waveform: "triangle" },
    { frequency: 720, duration: 0.07, volume: 0.045, waveform: "sine" },
  ],
  observe: [
    { frequency: 460, duration: 0.09, volume: 0.075, waveform: "triangle" },
    { frequency: 690, duration: 0.12, volume: 0.08, waveform: "sine" },
  ],
  collapse: [
    { frequency: 250, duration: 0.075, volume: 0.085, waveform: "square" },
    { frequency: 570, duration: 0.1, volume: 0.055, waveform: "triangle" },
  ],
  move: [
    { frequency: 620, duration: 0.06, volume: 0.075, waveform: "triangle" },
    { frequency: 820, duration: 0.075, volume: 0.055, waveform: "sine" },
  ],
  path: [
    { frequency: 660, duration: 0.09, volume: 0.08, waveform: "triangle" },
    { frequency: 990, duration: 0.12, volume: 0.075, waveform: "sine" },
  ],
  wall: [
    { frequency: 170, duration: 0.075, volume: 0.09, waveform: "square" },
    { frequency: 220, duration: 0.055, volume: 0.055, waveform: "triangle" },
  ],
  void: [
    { frequency: 140, duration: 0.13, volume: 0.08, waveform: "sine" },
    { frequency: 285, duration: 0.065, volume: 0.045, waveform: "square" },
  ],
  crystal: [
    { frequency: 880, duration: 0.1, volume: 0.1, waveform: "triangle" },
    { frequency: 1_320, duration: 0.15, volume: 0.075, waveform: "sine" },
  ],
  battery: [
    { frequency: 560, duration: 0.08, volume: 0.075, waveform: "triangle" },
    { frequency: 840, duration: 0.14, volume: 0.09, waveform: "sine" },
  ],
  decoherencePulse: [
    { frequency: 132, duration: 0.14, volume: 0.09, waveform: "square" },
    { frequency: 264, duration: 0.18, volume: 0.075, waveform: "triangle" },
    { frequency: 792, duration: 0.11, volume: 0.055, waveform: "sine" },
  ],
  powerX: [
    { frequency: 360, duration: 0.075, volume: 0.075, waveform: "square" },
    { frequency: 720, duration: 0.12, volume: 0.08, waveform: "triangle" },
  ],
  powerH: [
    { frequency: 510, duration: 0.09, volume: 0.075, waveform: "triangle" },
    { frequency: 1_020, duration: 0.14, volume: 0.08, waveform: "sine" },
  ],
  pulse: [
    { frequency: 420, duration: 0.11, volume: 0.045, waveform: "sine" },
    { frequency: 780, duration: 0.16, volume: 0.035, waveform: "triangle" },
  ],
  tensionTick: [
    { frequency: 392, duration: 0.045, volume: 0.028, waveform: "sine" },
    { frequency: 588, duration: 0.055, volume: 0.02, waveform: "triangle" },
  ],
  tensionHigh: [
    { frequency: 294, duration: 0.075, volume: 0.04, waveform: "sine" },
    { frequency: 440, duration: 0.095, volume: 0.03, waveform: "triangle" },
  ],
  tensionPeak: [
    { frequency: 220, duration: 0.11, volume: 0.055, waveform: "sine" },
    { frequency: 660, duration: 0.13, volume: 0.045, waveform: "triangle" },
  ],
  resourceWarning: [
    { frequency: 520, duration: 0.055, volume: 0.035, waveform: "triangle" },
    { frequency: 390, duration: 0.075, volume: 0.025, waveform: "sine" },
  ],
  resourceRisk: [
    { frequency: 460, duration: 0.07, volume: 0.04, waveform: "triangle" },
    { frequency: 330, duration: 0.09, volume: 0.032, waveform: "sine" },
  ],
  resourceHigh: [
    { frequency: 360, duration: 0.09, volume: 0.048, waveform: "triangle" },
    { frequency: 270, duration: 0.12, volume: 0.038, waveform: "sine" },
  ],
  resourceMaximum: [
    { frequency: 250, duration: 0.12, volume: 0.055, waveform: "square" },
    { frequency: 500, duration: 0.14, volume: 0.04, waveform: "triangle" },
  ],
  rewind: [
    { frequency: 760, duration: 0.08, volume: 0.055, waveform: "triangle" },
    { frequency: 380, duration: 0.14, volume: 0.05, waveform: "sine" },
  ],
  victory: [
    { frequency: 660, duration: 0.09, volume: 0.09, waveform: "triangle" },
    { frequency: 990, duration: 0.13, volume: 0.1, waveform: "triangle" },
    { frequency: 1_320, duration: 0.19, volume: 0.08, waveform: "sine" },
  ],
  defeat: [
    { frequency: 210, duration: 0.14, volume: 0.09, waveform: "square" },
    { frequency: 120, duration: 0.22, volume: 0.07, waveform: "sine" },
  ],
  panel: [{ frequency: 390, duration: 0.045, volume: 0.045, waveform: "triangle" }],
};

const sounds = new Map<GameSound, readonly Howl[]>();

const minimumIntervals: Partial<Record<GameSound, number>> = {
  focus: 70,
  tensionTick: 1_600,
  tensionHigh: 1_100,
  tensionPeak: 1_500,
  decoherencePulse: 1_500,
  resourceWarning: 900,
  resourceRisk: 900,
  resourceHigh: 900,
  resourceMaximum: 1_200,
};

export function isGameSoundTestEnvironment(userAgent: string): boolean {
  return userAgent.toLowerCase().includes("jsdom");
}

export class GameSoundState {
  private muted = false;
  private unlocked = false;
  private readonly lastPlayedAt = new Map<GameSound, number>();

  unlock(unavailable = false): boolean {
    if (this.unlocked || unavailable) return false;
    this.unlocked = true;
    return true;
  }

  setMuted(nextMuted: boolean): void {
    this.muted = nextMuted;
  }

  shouldPlay(name: GameSound, now: number, unavailable = false): boolean {
    if (!this.unlocked || this.muted || unavailable) return false;
    const minimumInterval = minimumIntervals[name] ?? 28;
    if (now - (this.lastPlayedAt.get(name) ?? Number.NEGATIVE_INFINITY) < minimumInterval) return false;
    this.lastPlayedAt.set(name, now);
    return true;
  }
}

const soundState = new GameSoundState();

function isJSDOM(): boolean {
  return typeof navigator !== "undefined" && isGameSoundTestEnvironment(navigator.userAgent);
}

function sampleFor(profile: ToneProfile, phase: number): number {
  const sine = Math.sin(phase);
  switch (profile.waveform) {
    case "square":
      return Math.sign(sine) * 0.55;
    case "triangle":
      return (2 / Math.PI) * Math.asin(sine);
    default:
      return sine;
  }
}

function toneDataUri(profile: ToneProfile): string {
  const sampleRate = 12_000;
  const samples = Math.max(1, Math.round(sampleRate * profile.duration));
  const byteLength = samples * 2;
  const bytes = new Uint8Array(44 + byteLength);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + byteLength, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, byteLength, true);

  for (let sample = 0; sample < samples; sample += 1) {
    const attack = Math.min(1, sample / Math.max(1, sampleRate * 0.006));
    const release = 1 - sample / samples;
    const amplitude = Math.round(
      sampleFor(profile, (2 * Math.PI * profile.frequency * sample) / sampleRate)
      * 4_700
      * attack
      * release,
    );
    view.setInt16(44 + sample * 2, amplitude, true);
  }

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${window.btoa(binary)}`;
}

function soundsFor(name: GameSound): readonly Howl[] {
  const cached = sounds.get(name);
  if (cached !== undefined) return cached;

  const layers = profiles[name].map((profile) => new Howl({
    src: [toneDataUri(profile)],
    volume: profile.volume,
    preload: true,
    pool: 6,
    onloaderror: () => undefined,
    onplayerror: () => undefined,
  }));
  sounds.set(name, layers);
  return layers;
}

export function unlockGameSound(): void {
  if (typeof window === "undefined" || !soundState.unlock(isJSDOM())) return;

  try {
    soundsFor("focus");
    const context = (Howler as unknown as { readonly ctx?: AudioContext }).ctx;
    if (context?.state === "suspended") void context.resume().catch(() => undefined);
  } catch {
    // Audio remains a progressive enhancement when a browser blocks an audio context.
  }
}

export function setGameSoundMuted(nextMuted: boolean): void {
  soundState.setMuted(nextMuted);
  if (typeof window === "undefined") return;
  try {
    Howler.mute(nextMuted);
  } catch {
    // Sound is progressive enhancement; a blocked audio context must not affect play.
  }
}

export function playGameSound(name: GameSound): void {
  if (typeof window === "undefined") return;
  unlockGameSound();

  const now = typeof performance === "undefined" ? 0 : performance.now();
  if (!soundState.shouldPlay(name, now, isJSDOM())) return;

  try {
    for (const sound of soundsFor(name)) sound.play();
  } catch {
    // Local data-URI tones are optional and never block interaction.
  }
}

export function releaseGameSounds(): void {
  for (const layers of sounds.values()) {
    for (const sound of layers) sound.unload();
  }
  sounds.clear();
  try {
    Howler.stop();
  } catch {
    // Audio cleanup remains best-effort during page shutdown.
  }
}
