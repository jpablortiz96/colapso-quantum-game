import { useEffect } from "react";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DailyGame } from "./components/DailyGame";
import { ProductionRuntime } from "./components/ProductionRuntime";
import { universeNumberFromPathname } from "./daily-game/universe";
import { useDailyGameStore } from "./store/daily-game-store";

function reloadExperience(): void {
  window.location.reload();
}

function syncUniverseFromLocation(): void {
  const store = useDailyGameStore.getState();
  const universeNumber = universeNumberFromPathname(window.location.pathname);
  if (universeNumber !== null) {
    if (store.universe.universeNumber !== universeNumber) store.selectUniverseFromRoute(universeNumber);
    return;
  }

  const basePath = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  if (
    (window.location.pathname === basePath || window.location.pathname === basePath.slice(0, -1))
    && store.universe.universeNumber !== 1
  ) {
    store.selectUniverseFromRoute(1);
  }
}

function returnToHome(): void {
  const store = useDailyGameStore.getState();
  store.selectUniverseFromRoute(1);
  store.reset();
  window.history.replaceState(null, "", import.meta.env.BASE_URL);
}

export function App() {
  useEffect(() => {
    syncUniverseFromLocation();
    window.addEventListener("popstate", syncUniverseFromLocation);
    return () => window.removeEventListener("popstate", syncUniverseFromLocation);
  }, []);

  return <AppErrorBoundary onHome={returnToHome} onRetry={reloadExperience}>
    <ProductionRuntime />
    <DailyGame />
  </AppErrorBoundary>;
}
