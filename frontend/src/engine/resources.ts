import { V1_RULE_CONFIG } from "./constants";
import { compareCoordinates, coordinatesEqual } from "./coordinates";
import type {
  CollapsedCell,
  Coordinate,
  EngineEvent,
  GameState,
} from "./types";

export type ResourceEntryEffects = Readonly<{
  observations: number;
  collectedCrystals: readonly Coordinate[];
  collectedBatteries: readonly Coordinate[];
  events: readonly EngineEvent[];
}>;

const containsCoordinate = (
  coordinates: readonly Coordinate[],
  target: Coordinate,
): boolean => coordinates.some((coordinate) => coordinatesEqual(coordinate, target));

const insertCoordinateRowMajor = (
  coordinates: readonly Coordinate[],
  target: Coordinate,
): readonly Coordinate[] =>
  Object.freeze([...coordinates, target].sort(compareCoordinates));

/**
 * Computes collectible effects for a successful entry without constructing an
 * intermediate state whose player occupies an uncollected resource cell.
 */
export const collectResourceOnEntry = (
  state: GameState,
  target: CollapsedCell,
): ResourceEntryEffects => {
  if (
    target.outcome === "CRYSTAL" &&
    !containsCoordinate(state.collectedCrystals, target.coordinate)
  ) {
    const collectedCrystals = insertCoordinateRowMajor(
      state.collectedCrystals,
      target.coordinate,
    );
    return Object.freeze({
      observations: state.observations,
      collectedCrystals,
      collectedBatteries: state.collectedBatteries,
      events: Object.freeze([
        Object.freeze({
          kind: "CRYSTAL_COLLECTED" as const,
          coordinate: target.coordinate,
          collectedCrystals: collectedCrystals.length,
        }),
      ]),
    });
  }

  if (
    target.outcome === "BATTERY" &&
    !containsCoordinate(state.collectedBatteries, target.coordinate)
  ) {
    const collectedBatteries = insertCoordinateRowMajor(
      state.collectedBatteries,
      target.coordinate,
    );
    const observations = Math.min(
      V1_RULE_CONFIG.maxObservations,
      state.observations + 1,
    );
    return Object.freeze({
      observations,
      collectedCrystals: state.collectedCrystals,
      collectedBatteries,
      events: Object.freeze([
        Object.freeze({
          kind: "BATTERY_COLLECTED" as const,
          coordinate: target.coordinate,
          observationsBefore: state.observations,
          observationsAfter: observations,
        }),
      ]),
    });
  }

  return Object.freeze({
    observations: state.observations,
    collectedCrystals: state.collectedCrystals,
    collectedBatteries: state.collectedBatteries,
    events: Object.freeze([]),
  });
};
