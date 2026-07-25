export const PRODUCTION_PREFERENCES_VERSION = 1 as const;
export const PRODUCTION_PREFERENCES_KEY = "colapso:preferences";
export const LEGACY_TUTORIAL_PREFERENCE_KEY = "colapso:tutorial-completed";
export const PREFERENCE_STORAGE_STATUS_EVENT = "colapso:preference-storage-status";
export const PREFERENCES_CHANGED_EVENT = "colapso:preferences-changed";

export type PreferredGameMode = "QUANTUM_MISSION" | "EXPLORER" | "GUIDED";

export interface ProductionPreferences {
  readonly version: typeof PRODUCTION_PREFERENCES_VERSION;
  readonly mute: boolean;
  readonly reducedMotion: boolean | null;
  readonly tutorialCompleted: boolean;
  readonly lastMode: PreferredGameMode | null;
  readonly audioConsent: boolean;
}

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const allowedKeys = new Set([
  "version",
  "mute",
  "reducedMotion",
  "tutorialCompleted",
  "lastMode",
  "audioConsent",
]);
const allowedModes = new Set<PreferredGameMode>(["QUANTUM_MISSION", "EXPLORER", "GUIDED"]);
const defaults: ProductionPreferences = Object.freeze({
  version: PRODUCTION_PREFERENCES_VERSION,
  mute: false,
  reducedMotion: null,
  tutorialCompleted: false,
  lastMode: null,
  audioConsent: false,
});

let storageAvailable = true;

function defaultPreferences(): ProductionPreferences {
  return { ...defaults };
}

function resolveStorage(storage?: PreferenceStorage): PreferenceStorage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function publishStorageStatus(available: boolean): void {
  if (storageAvailable === available) return;
  storageAvailable = available;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PREFERENCE_STORAGE_STATUS_EVENT, { detail: { available } }));
  }
}

function publishPreferencesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProductionPreferences(raw: string): ProductionPreferences | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
    if (value.version !== PRODUCTION_PREFERENCES_VERSION) return null;
    if (typeof value.mute !== "boolean" || typeof value.tutorialCompleted !== "boolean" || typeof value.audioConsent !== "boolean") return null;
    if (value.reducedMotion !== null && typeof value.reducedMotion !== "boolean") return null;
    if (value.lastMode !== null && (typeof value.lastMode !== "string" || !allowedModes.has(value.lastMode as PreferredGameMode))) return null;
    return {
      version: PRODUCTION_PREFERENCES_VERSION,
      mute: value.mute,
      reducedMotion: value.reducedMotion,
      tutorialCompleted: value.tutorialCompleted,
      lastMode: value.lastMode as PreferredGameMode | null,
      audioConsent: value.audioConsent,
    };
  } catch {
    return null;
  }
}

export function readProductionPreferences(storage?: PreferenceStorage): ProductionPreferences {
  const target = resolveStorage(storage);
  if (target === null) {
    if (typeof window !== "undefined") publishStorageStatus(false);
    return defaultPreferences();
  }

  try {
    const raw = target.getItem(PRODUCTION_PREFERENCES_KEY);
    const parsed = raw === null ? null : parseProductionPreferences(raw);
    if (raw !== null && parsed === null) target.removeItem(PRODUCTION_PREFERENCES_KEY);

    let preferences = parsed ?? defaultPreferences();
    const legacyTutorial = target.getItem(LEGACY_TUTORIAL_PREFERENCE_KEY);
    if (legacyTutorial !== null) {
      target.removeItem(LEGACY_TUTORIAL_PREFERENCE_KEY);
      if (legacyTutorial === "true") {
        preferences = { ...preferences, tutorialCompleted: true };
        target.setItem(PRODUCTION_PREFERENCES_KEY, JSON.stringify(preferences));
      }
    }
    publishStorageStatus(true);
    return preferences;
  } catch {
    publishStorageStatus(false);
    return defaultPreferences();
  }
}

export function writeProductionPreferences(
  update: Partial<Omit<ProductionPreferences, "version">>,
  storage?: PreferenceStorage,
): ProductionPreferences {
  const target = resolveStorage(storage);
  const current = readProductionPreferences(storage);
  const next: ProductionPreferences = { ...current, ...update, version: PRODUCTION_PREFERENCES_VERSION };
  if (target === null) return next;
  try {
    target.setItem(PRODUCTION_PREFERENCES_KEY, JSON.stringify(next));
    target.removeItem(LEGACY_TUTORIAL_PREFERENCE_KEY);
    publishStorageStatus(true);
    publishPreferencesChanged();
  } catch {
    publishStorageStatus(false);
  }
  return next;
}

export function resetProductionPreferences(storage?: PreferenceStorage): ProductionPreferences {
  const target = resolveStorage(storage);
  if (target === null) return defaultPreferences();
  try {
    target.removeItem(PRODUCTION_PREFERENCES_KEY);
    target.removeItem(LEGACY_TUTORIAL_PREFERENCE_KEY);
    publishStorageStatus(true);
    publishPreferencesChanged();
  } catch {
    publishStorageStatus(false);
  }
  return defaultPreferences();
}

export function isProductionStorageAvailable(storage?: PreferenceStorage): boolean {
  const target = resolveStorage(storage);
  if (target === null) return typeof window === "undefined" ? true : false;
  try {
    target.getItem(PRODUCTION_PREFERENCES_KEY);
    publishStorageStatus(true);
    return true;
  } catch {
    publishStorageStatus(false);
    return false;
  }
}

export function lastKnownStorageAvailability(): boolean {
  return storageAvailable;
}
