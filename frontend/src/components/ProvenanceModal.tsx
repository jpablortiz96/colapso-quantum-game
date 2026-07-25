import { motion } from "framer-motion";
import { useState } from "react";
import { useDailyGameStore } from "../store/daily-game-store";
import { useDialogFocus } from "./use-dialog-focus";

const provenancePipeline = [
  ["⌬", "IBM Quantum Hardware", "ibm_fez ejecutó los circuitos preservados."],
  ["∿", "SamplerV2 + EstimatorV2", "Primitivas que produjeron muestras y valores esperados."],
  ["▤", "Raw results preservados", "Resultados exportados antes de compilar el universo."],
  ["#", "Evidence Pack + SHA-256", "Manifest y hashes permiten comprobar integridad."],
  ["01", "1.024 bits de entropía aceptados", "Material aceptado y documentado en la evidencia."],
  ["↗", "Expansión determinista", "SHA-256 counter mode extiende el material de forma reproducible."],
  ["◎", "Universo REAL #001", "Tablero y plan de resolución previamente compilados."],
  ["▶", "Motor F1 y replay auditable", "Las mismas acciones producen el mismo resultado verificable."],
] as const;

function abbreviate(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

export function ProvenanceModal() {
  const { closePanel, universe } = useDailyGameStore();
  const dialogRef = useDialogFocus(closePanel);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
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
  const facts = [
    ["Universo", `#${String(universe.universeNumber).padStart(3, "0")}`],
    ["Backend", universe.backend],
    ["Modo", universe.mode],
    ["Entropía", `${universe.entropyBitsAccepted.toLocaleString("es-ES")} bits`],
    ["Hash", abbreviate(universe.sourceEntropyHash)],
    ["Commitment", abbreviate(universe.commitment)],
    ["Bell correlation", String(universe.bellSummary.observedCorrelation)],
    ["CHSH S", String(universe.chshSummary.witness)],
    ["Standard error", String(universe.chshSummary.standardError)],
    ["Clasificación", universe.chshSummary.classification],
    ["Job IDs", universe.jobIds.map(abbreviate).join(" · ")],
  ] as const;

  return <motion.div className="mission-modal" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section ref={dialogRef} aria-labelledby="provenance-title" aria-modal="true" className="provenance-modal" role="dialog" tabIndex={-1} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
      <header><div><p className="eyebrow">Procedencia cuántica verificable</p><h2 id="provenance-title">Cómo nació este universo</h2><p>COLAPSO transforma resultados preservados de hardware cuántico IBM en un tablero determinista, verificable y jugable offline.</p></div><button aria-label="Cerrar procedencia" onClick={closePanel} type="button">×</button></header>
      <ol className="provenance-pipeline">{provenancePipeline.map(([icon, title, copy], index) => <motion.li key={title} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.045 }}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><p>{copy}</p></div><small>✓ Verificado</small></motion.li>)}</ol>
      <blockquote>“COLAPSO no ejecuta un job cuántico por cada movimiento. Usa resultados reales preservados para compilar un universo que después puede jugarse offline, verificarse y reproducirse.”</blockquote>
      <section className="provenance-comparison" aria-labelledby="comparison-title"><h3 id="comparison-title">Qué cambia frente a un juego convencional</h3><div><article><h4>Juego convencional</h4><ul><li>Pseudoaleatoriedad del navegador.</li><li>Tablero generado al cargar.</li><li>Procedencia normalmente no demostrable.</li><li>Resultados difíciles de auditar.</li></ul></article><article><h4>COLAPSO</h4><ul><li>Universo derivado de evidencia de hardware real.</li><li>Universo previamente compilado.</li><li>Manifest, hashes y commitment.</li><li>Replay determinista y funcionamiento offline.</li></ul></article></div></section>
      <dl className="provenance-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="provenance-copy"><button onClick={() => void copyReference()} type="button">Copiar referencia de integridad</button>{copyStatus !== null && <p aria-live="polite">{copyStatus}</p>}</div>
      <section className="science-guardrails"><h3>Límites científicos</h3><p>La correlación Bell mostrada pertenece a una sola base y no constituye por sí sola una demostración de violación de Bell.</p><p>El resultado CHSH se presenta con incertidumbre y no se utiliza para afirmar ventaja cuántica.</p><p>Los Job IDs pueden requerir acceso autorizado. El Evidence Pack preserva resultados y hashes auditables.</p><p>No existe una afirmación anti-trampa, de ventaja cuántica ni de certificación física de los pares tácticos.</p></section>
    </motion.section>
  </motion.div>;
}
