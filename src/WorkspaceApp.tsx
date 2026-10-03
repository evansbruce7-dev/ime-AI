import { Suspense, lazy, useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyWorkspaceThemeToDocument, readWorkspaceTheme } from "./lib/prefs";
import { useI18n } from "./i18n/context";

const WorkspaceLayout = lazy(async () => {
  const mod = await import("./layouts/WorkspaceLayout");
  return { default: mod.WorkspaceLayout };
});

const HomePage = lazy(async () => {
  const mod = await import("./pages/Home");
  return { default: mod.HomePage };
});

const StatisticsPage = lazy(async () => {
  const mod = await import("./pages/Statistics");
  return { default: mod.StatisticsPage };
});

const CommandsPage = lazy(async () => {
  const mod = await import("./pages/Commands");
  return { default: mod.CommandsPage };
});

const ModelsPage = lazy(async () => {
  const mod = await import("./pages/Models");
  return { default: mod.ModelsPage };
});

const BehaviorPage = lazy(async () => {
  const mod = await import("./pages/Behavior");
  return { default: mod.BehaviorPage };
});

const QueuePage = lazy(async () => {
  const mod = await import("./pages/Queue");
  return { default: mod.QueuePage };
});

const PrivacyPage = lazy(async () => {
  const mod = await import("./pages/Privacy");
  return { default: mod.PrivacyPage };
});

const AppearancePage = lazy(async () => {
  const mod = await import("./pages/Appearance");
  return { default: mod.AppearancePage };
});

const OnboardingPage = lazy(async () => {
  const mod = await import("./pages/Onboarding");
  return { default: mod.OnboardingPage };
});

const RootRedirect = lazy(async () => {
  const mod = await import("./components/RootRedirect");
  return { default: mod.RootRedirect };
});

function syncWorkspaceThemeFromPrefs(): void {
  applyWorkspaceThemeToDocument(readWorkspaceTheme());
}

function WorkspaceRouteFallback() {
  const { m } = useI18n();
  return (
    <div className="workspace-loading" aria-busy="true">
      <p className="muted">{m.common.loadingWorkspace}</p>
    </div>
  );
}

/** Listens for tray / panel events that navigate the main workspace webview (e.g. 打开设置). */
function OpenWorkspaceListener() {
  const navigate = useNavigate();

  useEffect(() => {
    syncWorkspaceThemeFromPrefs();
    const onTheme = () => syncWorkspaceThemeFromPrefs();
    window.addEventListener("workspace-theme-changed", onTheme);
    return () => window.removeEventListener("workspace-theme-changed", onTheme);
  }, []);

  useEffect(() => {
    let unlistenSettings: (() => void) | undefined;
    void listen("open-settings", () => {
      navigate("/behavior");
      console.log("[app] tray → navigate /behavior (settings)");
      void getCurrentWindow()
        .maximize()
        .then(() => console.log("[app] main window maximized (open-settings)"))
        .catch((e) => console.warn("[app] maximize failed", e));
    }).then((fn) => {
      unlistenSettings = fn;
    });

    let unlistenCommands: (() => void) | undefined;
    void listen("open-commands", () => {
      navigate("/commands");
      console.log("[app] navigate /commands");
    }).then((fn) => {
      unlistenCommands = fn;
    });

    let unlistenPage: (() => void) | undefined;
    void listen<string>("open-workspace-page", (event) => {
      const slug = typeof event.payload === "string" ? event.payload : "home";
      const path = slug.startsWith("/") ? slug : `/${slug}`;
      navigate(path);
      console.log("[app] tray/panel → navigate", path);
    }).then((fn) => {
      unlistenPage = fn;
    });

    return () => {
      unlistenSettings?.();
      unlistenCommands?.();
      unlistenPage?.();
    };
  }, [navigate]);

  return null;
}

export default function WorkspaceApp() {
  return (
    <HashRouter>
      <OpenWorkspaceListener />
      <Suspense fallback={<WorkspaceRouteFallback />}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<WorkspaceLayout />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/commands" element={<CommandsPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/behavior" element={<BehaviorPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/appearance" element={<AppearancePage />} />
          </Route>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/settings" element={<Navigate to="/home" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
