import { motion } from "framer-motion";
import { useState } from "react";
import type {
  DirectDualPrimitiveProvenance,
  DirectSamplerSharedChshProvenance,
  PlayableCampaignEntry,
} from "../daily-universe/types";
import { getUniverseDisplayTitle } from "../daily-game/universe";
import { useDailyGameStore } from "../store/daily-game-store";
import { useDialogFocus } from "./use-dialog-focus";

type PipelineStep = readonly [icon: string, title: string, copy: string];

const commonTail = (entry: PlayableCampaignEntry): readonly PipelineStep[] => [
  ["#", "Evidence Pack + SHA-256", "Manifest y hashes permiten comprobar la integridad de los artefactos preservados."],
  ["01", "1.024 bits de entropía aceptados", "El material aceptado está documentado y se usa como entrada del compilador determinista."],
  ["↗", "Expansión determinista", "SHA-256 counter mode extiende el material de forma reproducible; no crea entropía física nueva."],
  ["◎", `Universo REAL #${String(entry.universeNumber).padStart(3, "0")}`, "El tablero y el plan de resolución fueron compilados previamente para jugarse offline."],
  ["▶", "Motor F1 y replay auditable", "Las mismas acciones sobre el mismo universo producen el mismo resultado verificable."],
];

function provenancePipeline(entry: PlayableCampaignEntry): readonly PipelineStep[] {
  const provenance = entry.provenance;
  if (provenance.kind === "DIRECT_DUAL_PRIMITIVE") {
    return [
      ["⌬", "IBM Quantum Hardware", `${provenance.directEvidence.backend} ejecutó los circuitos preservados del Universo #001.`],
      ["∿", "SamplerV2 + EstimatorV2 directos", "Este universo conserva evidencia directa de muestras SamplerV2 y valores esperados EstimatorV2."],
      ["▤", "Resultados directos preservados", "Los resultados de ambas primitivas fueron exportados antes de compilar el universo."],
      ...commonTail(entry),
    ];
  }
  return [
    ["⌬", "IBM Quantum Hardware", `${provenance.directEvidence.backend} ejecutó el trabajo SamplerV2 preservado para este universo.`],
    ["∿", "SamplerV2 directo", "Las muestras y la entropía aceptada proceden del Job ID propio de este universo."],
    ["▤", "Resultado Sampler preservado", "El resultado runtime y su representación canónica fueron fijados por hashes antes de compilar el tablero."],
    ["CH", "CHSH compartido y explícito", "El resumen CHSH referencia la evidencia EstimatorV2 preservada del Universo #001; no se presenta como ejecución directa de este universo."],
    ...commonTail(entry),
  ];
}

function abbreviate(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function directDualFacts(provenance: DirectDualPrimitiveProvenance): readonly (readonly [string, string])[] {
  return [
    ["Modelo de evidencia", "SamplerV2 + EstimatorV2 directos"],
    ["Evidence run", provenance.directEvidence.evidenceRunId],
    ["Sampler Job ID", abbreviate(provenance.directEvidence.samplerJobId)],
    ["Estimator Job ID", abbreviate(provenance.directEvidence.estimatorJobId)],
    ["Artefactos con hash", String(Object.keys(provenance.directEvidence.artifactHashes).length)],
  ];
}

function directSamplerFacts(provenance: DirectSamplerSharedChshProvenance): readonly (readonly [string, string])[] {
  return [
    ["Modelo de evidencia", "SamplerV2 directo + CHSH compartido"],
    ["Sampler Job ID", abbreviate(provenance.directEvidence.jobId)],
    ["Evidence path", provenance.directEvidence.evidencePath],
    ["Runtime raw SHA-256", abbreviate(provenance.directEvidence.runtimeRawSha256)],
    ["Manifest SHA-256", abbreviate(provenance.directEvidence.manifestSha256)],
    ["CHSH de referencia", `Universo #001 · ${abbreviate(provenance.sharedChshReference.jobId)}`],
    ["Estimator runtime SHA-256", abbreviate(provenance.sharedChshReference.runtimeRawSha256)],
  ];
}

export function ProvenanceModal() {
  const { campaignEntry, closePanel, universe } = useDailyGameStore();
  const dialogRef = useDialogFocus(closePanel);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const provenance = campaignEntry.provenance;
  const modelFacts = provenance.kind === "DIRECT_DUAL_PRIMITIVE"
    ? directDualFacts(provenance)
    : directSamplerFacts(provenance);
  const facts: readonly (readonly [string, string])[] = [
    ["Universo", `#${String(universe.universeNumber).padStart(3, "0")} · ${getUniverseDisplayTitle(campaignEntry.universeNumber)}`],
    ["Backend", universe.backend],
    ["Modo", universe.mode],
    ["Entropía", `${universe.entropyBitsAccepted.toLocaleString("es-ES")} bits`],
    ["Hash de entropía", abbreviate(universe.sourceEntropyHash)],
    ["Commitment", abbreviate(universe.commitment)],
    ["Bell correlation", String(universe.bellSummary.observedCorrelation)],
    ["CHSH S", String(universe.chshSummary.witness)],
    ["Standard error", String(universe.chshSummary.standardError)],
    ["Clasificación", universe.chshSummary.classification],
    ...modelFacts,
  ];

  const copyReference = async () => {
    if (typeof navigator.clipboard?.writeText !== "function") {
      setCopyStatus("La copia automática no está disponible. La referencia sigue visible en este panel.");
      return;
    }
    try {
      await navigator.clipboard.writeText(universe.commitment);
      setCopyStatus("Referencia copiada.");
    } catch {
      setCopyStatus("El navegador bloqueó la copia. La referencia sigue visible en este panel.");
    }
  };

  return <motion.div className="mission-modal" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section ref={dialogRef} aria-labelledby="provenance-title" aria-modal="true" className="provenance-modal" data-provenance-kind={provenance.kind} role="dialog" tabIndex={-1} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
      <header><div><p className="eyebrow">Procedencia cuántica verificable</p><h2 id="provenance-title">Cómo nació {getUniverseDisplayTitle(campaignEntry.universeNumber)}</h2><p>COLAPSO transforma resultados preservados de hardware cuántico IBM en un tablero determinista, verificable y jugable offline.</p></div><button aria-label="Cerrar procedencia" onClick={closePanel} type="button">×</button></header>
      <div className="provenance-model"><span>{provenance.kind === "DIRECT_DUAL_PRIMITIVE" ? "Evidencia dual directa" : "Sampler directo · CHSH compartido"}</span><strong>Universo #{String(universe.universeNumber).padStart(3, "0")}</strong></div>
      <ol className="provenance-pipeline">{provenancePipeline(campaignEntry).map(([icon, title, copy], index) => <motion.li key={title} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.045 }}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><p>{copy}</p></div><small>✓ Verificado</small></motion.li>)}</ol>
      <blockquote>{provenance.kind === "DIRECT_DUAL_PRIMITIVE"
        ? "“El Universo #001 conserva evidencia directa de SamplerV2 y EstimatorV2. El juego usa esos resultados preservados para compilar un universo reproducible y jugarlo offline.”"
        : `“El Universo #${String(universe.universeNumber).padStart(3, "0")} conserva evidencia SamplerV2 directa. Su resumen CHSH referencia de forma explícita la evidencia EstimatorV2 fijada del Universo #001.”`}</blockquote>
      <section className="provenance-comparison" aria-labelledby="comparison-title"><h3 id="comparison-title">Qué cambia frente a un juego convencional</h3><div><article><h4>Juego convencional</h4><ul><li>Pseudoaleatoriedad del navegador.</li><li>Tablero generado al cargar.</li><li>Procedencia normalmente no demostrable.</li><li>Resultados difíciles de auditar.</li></ul></article><article><h4>COLAPSO</h4><ul><li>Universo derivado de evidencia de hardware real.</li><li>Universo previamente compilado.</li><li>Manifest, hashes y commitment.</li><li>Replay determinista y funcionamiento offline.</li></ul></article></div></section>
      <dl className="provenance-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="provenance-copy"><button onClick={() => void copyReference()} type="button">Copiar referencia de integridad</button>{copyStatus !== null && <p aria-live="polite">{copyStatus}</p>}</div>
      <section className="science-guardrails"><h3>Límites científicos</h3><p>La correlación Bell mostrada pertenece a una sola base y no constituye por sí sola una demostración de violación de Bell.</p><p>El resultado CHSH se presenta con incertidumbre y no se utiliza para afirmar ventaja cuántica.</p>{provenance.kind === "DIRECT_SAMPLER_SHARED_CHSH" && <p>El CHSH mostrado es una referencia compartida al EstimatorV2 del Universo #001; no es evidencia EstimatorV2 directa de este universo.</p>}<p>Los Job IDs pueden requerir acceso autorizado. El Evidence Pack preserva resultados y hashes auditables.</p><p>No existe una afirmación anti-trampa, de ventaja cuántica ni de certificación física de los pares tácticos.</p></section>
    </motion.section>
  </motion.div>;
}
