// Keeps a failed lazy chunk load (offline, a stale deploy) from unmounting the whole app (F-205, F-208).
import { Component, type JSX, type ReactNode } from "react";

interface State {
  readonly failed: boolean;
}

export class CanvasErrorBoundary extends Component<
  { readonly children: ReactNode; readonly message?: string },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render(): JSX.Element | ReactNode {
    if (this.state.failed)
      return (
        <p className="muted">
          {this.props.message ?? "The canvas couldn't load. Reload the page."}
        </p>
      );
    return this.props.children;
  }
}
