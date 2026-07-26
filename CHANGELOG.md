# Changelog

All notable changes to COLAPSO are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use semantic versioning for public releases.

## [1.0.2] - 2026-07-22

### Changed

- Increased active-gameplay typography with responsive sizing for command metrics, board probabilities, Observer Console copy, buttons, telemetry, tactical details, and the board legend.
- Strengthened selected-cell, keyboard-focus, `TÚ`, and `SALIDA` presentation without changing the 7×7 board dimensions.
- Reorganized the desktop Observer Console so mode, resources, selected objective, and the primary action remain fixed above lower tools and optional information.

### Fixed

- Expanded powers, Guided controls, `Más telemetría`, event history, tactical details, help, and keyboard guidance remain reachable through a bounded inner console scroll region.
- Supported desktop cockpit sizes retain the complete board and primary action with no document-level or horizontal scrolling.
- Tablet and mobile continue to use natural page flow without a competing nested console scrollbar.

### Preserved contracts

- No changes to the F1 engine, Universe #001, 10/13/13 observation balance, scoring, powers, Explorer Pulse, Guided Journey, evidence, replay, AWS application identity, Amplify branch, or production URL.

## [1.0.1] - 2026-07-22

### Changed

- Reorganized active desktop gameplay into a single-screen cockpit at supported viewports of at least 1100×680.
- Consolidated mission identity, objective, five core metrics, mode, sound, help, and decoherence pressure into one compact command bar.
- Kept observation pressure, the contextual primary action, powers, Explorer Pulse, and Guided Journey controls immediately visible in the Observer Console.
- Moved probabilities, coherence, event history, tactical details, keyboard help, and provenance into a closed `Más telemetría` disclosure.
- Updated Explorer, decoherence, Guided Journey, and mobile production media; cockpit captures now use 1366×768.

### Fixed

- The complete 7×7 board is visible when active gameplay opens on supported desktop cockpit dimensions.
- Active desktop gameplay no longer creates document-level vertical scrolling or a competing sidebar scrollbar.
- Tablet and mobile layouts use one natural document scroll instead of combined page and console scrolling.
- Removed the duplicated sticky mission resource/action strip without changing game rules or keyboard behavior.

### Preserved contracts

- No changes to the F1 engine, Universe #001, 10/13/13 observation balance, scoring, powers, decoherence cadence, hidden results, evidence, guided transcript, replay, AWS application identity, Amplify branch, or production URL.

## [1.0.0] - 2026-07-22

### Added

- Public production release of the Spanish COLAPSO player experience.
- Three presentation modes: Quantum Mission, Explorer, and Guided Journey.
- Deterministic 7×7 F1 engine with observation, movement, powers, pair policies, decoherence, serialization, scoring, and replay.
- Compiled Universe #001 with a public integrity commitment and resolution plan.
- Preserved real IBM Quantum evidence pack from `ibm_fez`, including SamplerV2 and EstimatorV2 exports, derived entropy/correlation/CHSH records, provenance, manifest, and SHA-256 sums.
- Responsive, keyboard-accessible UI with reduced motion, optional sound, focus-managed dialogs, and local preference handling.
- Static AWS Amplify packaging, deployment, and 23-check live verification workflow.
- English architecture, gameplay, quantum provenance, production, contribution, security, and Kiro workflow documentation.
- Seven real production screenshots and four original SVG diagrams.
- Public-repository, media, privacy, evidence, production, and packaging gates in GitHub Actions.
- Reproducible fresh-history public mirror builder.

### Security

- Public source contains no cloud/provider credential, personal data, private Git history, local deployment state, generated release archive, or source map.
- GitHub Actions uses read-only contents permission and performs no deployment.

### Scientific disclosure

- One-basis correlation is explicitly not represented as a Bell violation or conclusive entanglement certification.
- CHSH is published with propagated uncertainty and no device-independent, loophole-free, or quantum-advantage claim.
- Deterministic expansion is not represented as new physical entropy.
- Public resolution material is disclosed; no anti-cheat claim is made.

[1.0.2]: https://github.com/jpablortiz96/colapso-quantum-game/releases/tag/v1.0.2
[1.0.1]: https://github.com/jpablortiz96/colapso-quantum-game/releases/tag/v1.0.1
[1.0.0]: https://github.com/jpablortiz96/colapso-quantum-game/releases/tag/v1.0.0
