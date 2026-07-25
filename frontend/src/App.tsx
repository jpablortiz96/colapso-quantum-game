import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DailyGame } from "./components/DailyGame";
import { ProductionRuntime } from "./components/ProductionRuntime";
import { useDailyGameStore } from "./store/daily-game-store";

function reloadExperience(): void {
  window.location.reload();
}

function returnToHome(): void {
  useDailyGameStore.getState().reset();
  window.history.replaceState(null, "", import.meta.env.BASE_URL);
}

export function App() {
  return <AppErrorBoundary onHome={returnToHome} onRetry={reloadExperience}>
    <ProductionRuntime />
    <DailyGame />
  </AppErrorBoundary>;
}
