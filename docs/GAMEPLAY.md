# Gameplay

COLAPSO is a 7×7 route-finding puzzle. You control the Observer, beginning at the lower-left corner, and must reach the golden exit at the upper-right. Most of the field starts unresolved: you choose what to observe, decide where to move, and adapt when decoherence changes the board.

The player interface is Spanish (`es-419`). This guide uses the exact Spanish control labels where useful.

## Five-universe campaign

The landing screen lists five finalized, evidence-verified universes: Origin Universe, Entangled Paths, The Void Protocol, Energy Crisis, and Quantum Storm. Selecting an entry rebuilds the board, deterministic entropy source, narrative, and theme from that entry's published artifact; it never submits a job or performs a provider request. A victory marks the selected universe complete for the current browser session, and the result offers the next campaign entry. Verified entries are selectable independently of completion order.

## Single-screen cockpit

Active gameplay uses a board-first cockpit on supported desktop viewports of at least 1100×680:

- the full 7×7 board is visible when gameplay opens;
- one compact command bar carries the objective, observations, energy, turn/decoherence state, crystals, score, mode, sound, and help;
- the Observer Console keeps its resource warning, contextual primary action, target, powers, Explorer Pulse, and Guided Journey step visible;
- `Más telemetría` keeps probabilities, coherence, event history, tactical detail, keyboard help, and provenance available without competing for initial viewport space;
- document-level vertical scrolling is disabled only while active gameplay occupies a supported desktop cockpit.

Tablet and mobile layouts preserve a natural page flow. The console does not introduce a second vertical scrollbar, its mobile collapse control remains available, and dialogs retain bounded internal overflow when their content requires it.

This layout is presentation-only. It does not alter observations, energy, movement, powers, decoherence, score, hidden outcomes, replay, or any selected published universe.

## Core loop

1. Select a cell on the board.
2. Observe an unresolved possibility (`Observar casilla`) to reveal its outcome.
3. Move onto a reachable traversable cell (`Mover aquí`).
4. Preserve enough observations and energy to keep a route open.
5. Re-evaluate after each four-turn decoherence cycle.
6. Reach `SALIDA` to finish and produce a route summary.

You do not need to reveal the whole board. Efficient play resolves only the possibilities needed to build a viable route.

## Cell outcomes

| Signal | Meaning |
| --- | --- |
| Observer | Current player position |
| Exit | Goal cell; reaching it wins |
| Possibility | Unresolved cell with a visible path probability |
| Path | Traversable resolved cell |
| Wall | Resolved obstacle |
| Void | Non-traversable outcome |
| Crystal | Traversable collectible that contributes to score |
| Battery | Traversable collectible that restores an observation |
| Pair marker | Cell participates in a deterministic paired-collapse policy |

Probability labels describe the published F1 distribution for that cell. They are inspectable game inputs, not live hardware readings.

## Resources and pressure

### Observations

Observing spends one reading. Quantum Mission begins with 10 observations; Explorer and Guided Journey begin with 13. Batteries can restore a reading. The console shows a derived resource margin and escalating alerts as the budget tightens.

### Energy

Energy is part of the F1 state and can be affected by outcomes and movement. Reaching a terminal state ends the run.

### Decoherence

The field evaluates decoherence every four turns. The HUD progresses through stable, rising, high, and maximum pressure, then reports the collapse event. Decoherence uses the same published resolution plan as other deterministic transitions.

### Powers X and H

Each run begins with one `X` and one `H` inventory item. A power can target an unresolved possibility before observation:

- **X** exchanges the leading probabilities according to F1 rules.
- **H** balances the distribution according to F1 rules.

A power changes deterministic game probabilities. It is not a live quantum gate sent to hardware.

## Modes

### Quantum Mission (`MISIÓN CUÁNTICA`)

The canonical challenge:

- 10 starting observations;
- official score presentation;
- no Quantum Pulses;
- no guided route or rewind.

### Explorer (`MODO EXPLORADOR`)

The recommended learning mode:

- 13 starting observations;
- five optional Quantum Pulses;
- visible resource margin and tactical details;
- F1 score marked non-competitive.

A Quantum Pulse suggests a visible target but does not reveal or change its outcome.

### Guided Journey (`RUTA GUIADA`)

Each universe has a commitment-bound walkthrough of one audited solution: 23 steps for Universes #001–#003 and 21 steps for Universes #004–#005. The selected board always uses its own transcript rather than replaying another universe's guidance:

- 13 starting observations;
- exact next-action guidance;
- up to three rewinds;
- concept explanations for observation, movement, resources, decoherence, and replay;
- no competitive score.

The player still executes every action. Guidance validates a transcript prefix; it does not replace the F1 engine. The route is one solution, not proof of uniqueness.

## Controls

| Input | Action |
| --- | --- |
| Mouse/touch | Select a cell or activate a visible control |
| Arrow keys / WASD | Move the board cursor |
| Space | Select the cursor cell, then execute its primary action |
| Enter | Execute the available primary action |
| X / H | Apply the corresponding available power |
| Q | Activate a Quantum Pulse in Explorer |
| M | Toggle sound |
| R | Open restart confirmation |
| ? | Open contextual help when available |
| Escape | Close the active dialog |

Keyboard repeat is suppressed for gameplay actions. Dialog focus is trapped and restored, and board cells expose semantic labels for screen-reader users.

## Score and result

F1 derives score from the deterministic state and recorded actions. The presentation also tracks moves, observations, decoherence events, collected resources, powers, flow, and mode-specific assistance.

A completed result includes a 7×7 route map showing the start, path, observed cells, decoherence cells, final position, and exit. Guided completion additionally reports completed steps, rewinds, and F1 action count.

## Accessibility and preferences

- Responsive desktop and mobile layouts
- Full keyboard path through gameplay
- Reduced-motion support via system preference or saved setting
- Mute control and non-audio status equivalents
- Focus-managed dialogs and live regions
- High-contrast pressure and resource states with text labels
- Safe operation when local preference storage is unavailable

Local storage contains two validated records: presentation preferences (mute, reduced-motion choice, tutorial completion, last selected mode, and audio consent) and campaign progress (completed universe numbers only). No game state, score, transcript, board, hidden result, provider data, or credential is uploaded or persisted; campaign progress has an explicit reset.

## Provenance inside the game

Select `Consultar procedencia cuántica` on the landing screen, or `Ver procedencia` after a result. The modal follows the currently selected universe and presents its evidence pipeline, exact facts, integrity reference, and scientific boundaries. Universe #001 identifies direct SamplerV2 and EstimatorV2 evidence. Universes #002–#005 identify direct SamplerV2 evidence and visibly label their CHSH values as a shared reference to #001, not direct EstimatorV2 evidence. See [QUANTUM_PROVENANCE.md](QUANTUM_PROVENANCE.md) for the repository-level record.
