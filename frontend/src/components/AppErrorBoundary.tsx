import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onRetry?: () => void;
  readonly onHome?: () => void;
}

interface AppErrorBoundaryState {
  readonly error: Error | null;
  readonly recoveryAttempt: number;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, recoveryAttempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error("COLAPSO render failure", error, info.componentStack);
  }

  private recover = (callback?: () => void): void => {
    callback?.();
    this.setState((state) => ({ error: null, recoveryAttempt: state.recoveryAttempt + 1 }));
  };

  render(): ReactNode {
    if (this.state.error !== null) {
      return <main className="fatal-error-shell" role="alert">
        <section aria-labelledby="fatal-error-title" className="fatal-error-card">
          <span aria-hidden="true" className="fatal-error-mark">◎</span>
          <p className="eyebrow">Interferencia controlada</p>
          <h1 id="fatal-error-title">El universo encontró una interferencia inesperada.</h1>
          <p>Tu pantalla sigue bajo control. Puedes volver a cargar la experiencia o regresar a la portada.</p>
          <div>
            <button className="intro-primary" onClick={() => this.recover(this.props.onRetry)} type="button">Reintentar</button>
            <button className="intro-secondary" onClick={() => this.recover(this.props.onHome)} type="button">Volver al inicio</button>
          </div>
          {import.meta.env.DEV && <details className="fatal-error-technical">
            <summary>Información técnica de desarrollo</summary>
            <pre>{this.state.error.stack ?? this.state.error.message}</pre>
          </details>}
        </section>
      </main>;
    }

    return <div key={this.state.recoveryAttempt}>{this.props.children}</div>;
  }
}
