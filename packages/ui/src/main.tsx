import { Component, StrictMode, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts'
import './styles/katex-css'
import './index.css'
import App from './App.tsx'
import { SessionAuthGate } from './components/auth/SessionAuthGate'
import { ThemeSystemProvider } from './contexts/ThemeSystemContext'
import { ThemeProvider } from './components/providers/ThemeProvider'
import './lib/debug'
import { initializeAppearancePreferences } from './lib/persistence'
import { startAppearanceAutoSave } from './lib/appearanceAutoSave'
import { applyPersistedDirectoryPreferences } from './lib/directoryPersistence'
import { preloadMarkdownRenderer } from './components/chat/markdownRendererLoader'
import { startTypographyWatcher } from './lib/typographyWatcher'
import { startModelPrefsAutoSave } from './lib/modelPrefsAutoSave'
import { initializeLocale, I18nProvider } from './lib/i18n'
import type { RuntimeAPIs } from './lib/api/types'
import { installRuntimeEndpointReset } from './apps/runtimeEndpointReset'
import { installVqWriterLoader } from './lib/vq/writer'
import { forgetLayoutForSafeStart, isDesktopSafeStart } from './lib/desktopSafeStart'
import { prefetchOpenCodeCompatibility } from './components/update/openCodeCompatibilityCheck'

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

const runtimeAPIs = (typeof window !== 'undefined' && window.__OPENCHAMBER_RUNTIME_APIS__) || (() => {
  throw new Error('Runtime APIs not provided for legacy UI entrypoint.');
})();

initializeLocale();
if (isDesktopSafeStart()) forgetLayoutForSafeStart();
installRuntimeEndpointReset();
// A `vq` answer's files go to the folder its spec names, through the app's own
// file route rather than the browser's folder picker, which a server cannot
// answer. The library loads on demand there, so this install is fire and
// forget: the fence's loader installs the same writer when a fence arrives.
installVqWriterLoader();
prefetchOpenCodeCompatibility();

// Initialize settings asynchronously — the app renders with defaults first
// and hydrates once persisted preferences are applied. Users with non-default
// themes may briefly see default appearance on cold start; accepted trade-off
// for faster time-to-first-paint.
// Only local preferences load here. Server settings are fetched once, by
// SessionAuthGate after authentication: a fetch from here duplicated that read
// on every start, and failed on a password-protected server.
void initializeAppearancePreferences().then(() => {
  void applyPersistedDirectoryPreferences().catch((err) => {
    console.error('[main] settings init failed:', err);
  });

  // Start watchers regardless of whether secondary settings succeed.
  startAppearanceAutoSave();
  startModelPrefsAutoSave();
  startTypographyWatcher();
}).catch((err) => {
  console.error('[main] appearance init failed:', err);
});


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

// The first session opened after load renders its messages through the lazy
// markdown chunk; fetching it now, while the app boots, means that open shows
// text instead of empty message boxes until the chunk arrives.
preloadMarkdownRenderer();

// Third-party component-library mount proof, development builds only. It sits
// at the app root rather than in MainLayout's dev slot because the app-wide
// gates (auth, OpenCode-version check) replace the whole tree before MainLayout
// ever mounts; a proof that disappears behind a gate proves nothing. The import
// is dropped from production bundles.
const VqMountPanel = import.meta.env.DEV ? lazy(() => import('./components/dev/VqMountPanel')) : null;

// A rejected dynamic import surfaces as a render error, and without a boundary
// above it React unmounts the whole root: one unloadable dev panel would blank
// the entire app. This catches it and renders nothing instead. The log stays —
// a boundary that hides a broken panel makes the thing it exists to prove
// invisible to whoever is debugging it.
class VqMountBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[vq-mount-proof] failed to load', error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <ThemeSystemProvider>
        <ThemeProvider>
          <SessionAuthGate>
            <App apis={runtimeAPIs} />
          </SessionAuthGate>
          {VqMountPanel ? (
            <VqMountBoundary>
              <Suspense fallback={null}><VqMountPanel /></Suspense>
            </VqMountBoundary>
          ) : null}
        </ThemeProvider>
      </ThemeSystemProvider>
    </I18nProvider>
  </StrictMode>,
);
