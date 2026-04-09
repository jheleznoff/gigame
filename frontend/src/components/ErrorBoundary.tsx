import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4 p-8">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <h1 className="text-lg font-semibold">Что-то пошло не так</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
            className="px-4 py-2 bg-[#21a038] text-white rounded-xl text-sm hover:bg-[#1b8a30] transition-colors"
          >
            Вернуться на главную
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
