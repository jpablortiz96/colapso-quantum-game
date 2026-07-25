import { Component, type ReactNode } from "react";

interface LazyModuleBoundaryProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClose?: () => void;
  readonly onRetry?: () => void;
  readonly resetKey?: string | number | null;
}

interface LazyModuleBoundaryState {
  readonly failed: boolean;
}

export class LazyModuleBoundary extends Component<LazyModuleBoundaryProps, LazyModuleBoundaryState> {
  state: LazyModuleBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyModuleBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    if (import.meta.env.DEV) console.error("COLAPSO lazy module failure", error);
  }

  componentDidUpdate(previous: LazyModuleBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  private retry = (): void => {
    if (this.props.onRetry !== undefined) {
      this.props.onRetry();
      this.setState({ failed: false });
      return;
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return <section aria-live="assertive" className="lazy-error" role="alert">
      <strong>{this.props.label}</strong>
      {offline
        ? <p>No hay conexión y este módulo aún no estaba cargado. Vuelve a conectarte y reintenta.</p>
        : <><p>La experiencia principal sigue disponible. Puedes cerrar este panel y continuar.</p><p>También puedes reintentar la carga del módulo.</p></>}
      <div>
        <button onClick={this.retry} type="button">Reintentar carga</button>
        {this.props.onClose !== undefined && <button onClick={this.props.onClose} type="button">Cerrar y continuar</button>}
      </div>
    </section>;
  }
}
