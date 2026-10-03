import { useEffect, useLayoutEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { PanelPage } from "./pages/Panel";

/** Apply panel-only document classes before paint so #root never uses workspace 100vh sizing on first frame. */
function PanelDocumentShell() {
  useLayoutEffect(() => {
    document.documentElement.classList.add("panel-window-html");
    document.body.classList.add("panel-window-body");
    return () => {
      document.documentElement.classList.remove("panel-window-html");
      document.body.classList.remove("panel-window-body");
    };
  }, []);
  return null;
}

/**
 * Floating panel window only: no workspace routes, no workspace event listeners.
 * Prevents tray/HMR/hash glitches from rendering WorkspaceLayout inside the panel webview.
 */
function PanelOpenListener() {
  const navigate = useNavigate();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("open-panel", () => {
      navigate("/panel", { replace: true });
      console.log("[panel-app] open-panel → /panel");
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [navigate]);
  return null;
}

/** Desktop panel should behave like a native tool window, not expose the WebView's browser context menu. */
function PanelDesktopGuards() {
  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener("contextmenu", preventContextMenu);
    return () => {
      window.removeEventListener("contextmenu", preventContextMenu);
    };
  }, []);
  return null;
}

export function PanelApp() {
  return (
    <HashRouter>
      <PanelDocumentShell />
      <PanelDesktopGuards />
      <PanelOpenListener />
      <Routes>
        <Route path="/panel" element={<PanelPage />} />
        <Route path="*" element={<Navigate to="/panel" replace />} />
      </Routes>
    </HashRouter>
  );
}
