/**
 * Per-panel error isolation for the admin intelligence terminal.
 *
 * The terminal renders ~25 independent panels on one route. A throw inside any
 * one of them (a malformed timestamp, an unexpected null shape) used to reach
 * the root error boundary and replace the entire page with the generic
 * "This page didn't load" screen. This boundary keeps the failure local and
 * reports the message inline, so every other panel stays readable.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Human label used in the inline failure note. */
  name: string;
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class PanelBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : "unknown error" };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[admin] panel "${this.props.name}" failed`, error, info.componentStack);
  }

  override render() {
    if (this.state.message !== null) {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-destructive">{this.props.name} failed to render</p>
          <p className="mt-1 text-muted-foreground">
            {this.state.message} · other panels are unaffected.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
