import { useEffect, useState } from "react";
import {
  isProductionStorageAvailable,
  PREFERENCES_CHANGED_EVENT,
  PREFERENCE_STORAGE_STATUS_EVENT,
  readProductionPreferences,
} from "../production/preferences";
import { releaseGameSounds, setGameSoundMuted } from "./game-sound";

function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function ProductionRuntime() {
  const [online, setOnline] = useState(browserIsOnline);
  const [storageAvailable, setStorageAvailable] = useState(() => isProductionStorageAvailable());

  useEffect(() => {
    const root = document.documentElement;
    const motionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    const syncNetwork = () => setOnline(browserIsOnline());
    const syncStorage = () => setStorageAvailable(isProductionStorageAvailable());
    const syncVisibility = () => {
      root.dataset.pageHidden = document.hidden ? "true" : "false";
      setGameSoundMuted(readProductionPreferences().mute || document.hidden);
    };
    const syncMotion = () => {
      const preference = readProductionPreferences().reducedMotion;
      root.dataset.reducedMotion = preference === true || (preference === null && motionQuery?.matches === true)
        ? "reduce"
        : "no-preference";
    };
    const syncPreferences = () => {
      syncStorage();
      syncMotion();
      syncVisibility();
    };
    const constrainedDevice = (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 4)
      || ((navigator as Navigator & { readonly deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    root.dataset.performanceProfile = constrainedDevice ? "constrained" : "standard";

    syncNetwork();
    syncStorage();
    syncVisibility();
    syncMotion();
    window.addEventListener("online", syncNetwork);
    window.addEventListener("offline", syncNetwork);
    window.addEventListener("pagehide", releaseGameSounds);
    window.addEventListener("storage", syncStorage);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, syncPreferences);
    window.addEventListener(PREFERENCE_STORAGE_STATUS_EVENT, syncStorage);
    document.addEventListener("visibilitychange", syncVisibility);
    motionQuery?.addEventListener("change", syncMotion);

    return () => {
      window.removeEventListener("online", syncNetwork);
      window.removeEventListener("offline", syncNetwork);
      window.removeEventListener("pagehide", releaseGameSounds);
      window.removeEventListener("storage", syncStorage);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, syncPreferences);
      window.removeEventListener(PREFERENCE_STORAGE_STATUS_EVENT, syncStorage);
      document.removeEventListener("visibilitychange", syncVisibility);
      motionQuery?.removeEventListener("change", syncMotion);
      delete root.dataset.pageHidden;
      delete root.dataset.reducedMotion;
      delete root.dataset.performanceProfile;
    };
  }, []);

  if (online && storageAvailable) return null;

  return <section aria-atomic="true" aria-label="Estado de la experiencia" aria-live="polite" className="production-status" role="status">
    {!online && <p><strong>Sin conexión.</strong> Puedes continuar con los recursos ya cargados; vuelve a conectarte y reintenta si un módulo no abre.</p>}
    {!storageAvailable && <p><strong>Almacenamiento local bloqueado.</strong> La partida continúa, pero tus preferencias no se guardarán.</p>}
  </section>;
}
