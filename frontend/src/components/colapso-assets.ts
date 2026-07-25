const assetRoot = "/assets/colapso";

export const colapsoAssets = {
  logo: `${assetRoot}/logo_colapso.webp`,
  observer: `${assetRoot}/player_observer.webp`,
  atom: `${assetRoot}/symbol_quantum_atom.webp`,
  tiles: {
    FLOOR: `${assetRoot}/tile_path.webp`,
    WALL: `${assetRoot}/tile_wall.webp`,
    VOID: `${assetRoot}/tile_void.webp`,
    CRYSTAL: `${assetRoot}/tile_crystal.webp`,
    BATTERY: `${assetRoot}/tile_battery.webp`,
    EXIT: `${assetRoot}/tile_exit.webp`,
  },
  powers: {
    X: `${assetRoot}/power_x.webp`,
    H: `${assetRoot}/power_h.webp`,
  },
  effects: {
    selection: `${assetRoot}/fx_selection_glow.webp`,
    entanglement: `${assetRoot}/fx_entanglement_link.webp`,
  },
} as const;
