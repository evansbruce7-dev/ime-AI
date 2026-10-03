import { Suspense, lazy } from "react";
import { I18nProvider, useI18n } from "./i18n/context";
import { isPanelWebview } from "./lib/windowKind";
import "./App.css";

const LazyPanelApp = lazy(async () => {
  const mod = await import("./PanelApp");
  return { default: mod.PanelApp };
});

const LazyWorkspaceApp = lazy(() => import("./WorkspaceApp"));

function AppFallback({ panel }: { panel: boolean }) {
  const { m } = useI18n();
  return (
    <div
      aria-busy="true"
      style={{
        /* Panel webview: never occupy 100vh while lazy-loading — that blocks clicks on apps underneath. */
        minHeight: panel ? "auto" : "100vh",
        display: "grid",
        placeItems: "center",
        background: panel ? "transparent" : "var(--workspace-bg, #0b1020)",
        color: "var(--workspace-fg, #e5e7eb)",
        fontSize: "14px",
      }}
    >
      {m.common.loading}
    </div>
  );
}

function App() {
  const panel = isPanelWebview();
  const ActiveApp = panel ? LazyPanelApp : LazyWorkspaceApp;

  return (
    <I18nProvider>
      <Suspense fallback={<AppFallback panel={panel} />}>
        <ActiveApp />
      </Suspense>
    </I18nProvider>
  );
}

export default App;
