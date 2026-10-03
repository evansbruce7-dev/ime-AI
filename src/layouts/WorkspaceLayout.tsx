import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { ScrollArea } from "@base-ui/react/scroll-area";
import {
  ChartNoAxesColumn,
  Cpu,
  Keyboard,
  LayoutDashboard,
  ListTree,
  Search,
  ShieldCheck,
  SwatchBook,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import "@fontsource-variable/geist/wght.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { CustomTitleBar } from "../components/CustomTitleBar";
import { useI18n } from "../i18n/context";
import type { Messages } from "../i18n/messages";
import { getAppVersion } from "../lib/updateCheck";

type NavItem = {
  to: string;
  label: string;
  hint: string;
  index: string;
  Icon: LucideIcon;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

function buildNav(m: Messages): NavGroup[] {
  return [
    {
      id: "overview",
      label: m.shell.groups.overview,
      items: [
        { to: "/home", label: m.shell.nav.home, hint: m.shell.nav.homeHint, index: "01", Icon: LayoutDashboard },
        { to: "/statistics", label: m.shell.nav.stats, hint: m.shell.nav.statsHint, index: "02", Icon: ChartNoAxesColumn },
      ],
    },
    {
      id: "workflow",
      label: m.shell.groups.workflow,
      items: [
        { to: "/commands", label: m.shell.nav.commands, hint: m.shell.nav.commandsHint, index: "03", Icon: Waypoints },
        { to: "/models", label: m.shell.nav.models, hint: m.shell.nav.modelsHint, index: "04", Icon: Cpu },
        { to: "/queue", label: m.shell.nav.queue, hint: m.shell.nav.queueHint, index: "05", Icon: ListTree },
      ],
    },
    {
      id: "system",
      label: m.shell.groups.system,
      items: [
        { to: "/behavior", label: m.shell.nav.behavior, hint: m.shell.nav.behaviorHint, index: "06", Icon: Keyboard },
        { to: "/privacy", label: m.shell.nav.privacy, hint: m.shell.nav.privacyHint, index: "07", Icon: ShieldCheck },
        { to: "/appearance", label: m.shell.nav.appearance, hint: m.shell.nav.appearanceHint, index: "08", Icon: SwatchBook },
      ],
    },
  ];
}

function currentItem(pathname: string, groups: NavGroup[]): NavItem {
  const items = groups.flatMap((group) => group.items);
  const path = pathname.split("?")[0].replace(/\/$/, "") || "/home";
  return items.find((item) => path === item.to) ?? items[0];
}

function currentGroup(pathname: string, groups: NavGroup[]): NavGroup {
  const item = currentItem(pathname, groups);
  return groups.find((group) => group.items.some((entry) => entry.to === item.to)) ?? groups[0];
}

/**
 * Swap the settings page in place.
 * The old cross-fade waited for the previous page to fade out first, so the stage went blank
 * on every tab click. Lazy route chunks are caught here so the rail and title bar stay put.
 */
function AtelierStage() {
  const outlet = useOutlet();
  return (
    <Suspense fallback={<div className="atelier-stage atelier-stage--hold" aria-busy="true" />}>
      <div className="atelier-stage">{outlet}</div>
    </Suspense>
  );
}

/**
 * Settings shell: instrument-dark canvas, grouped rail, and a single reading column.
 * Visual language is independent of the older Windows 11 settings chrome.
 */
export function WorkspaceLayout() {
  const { m } = useI18n();
  const navGroups = useMemo(() => buildNav(m), [m]);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const active = currentItem(pathname, navGroups);
  const group = currentGroup(pathname, navGroups);
  const version = getAppVersion();

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return navGroups;
    return navGroups.map((entry) => ({
      ...entry,
      items: entry.items.filter((item) =>
        `${item.label} ${item.hint} ${entry.label}`.toLowerCase().includes(needle),
      ),
    })).filter((entry) => entry.items.length > 0);
  }, [query, navGroups]);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
    console.log("[atelier] section", active.to, active.label);
  }, [pathname, active.to, active.label]);

  useEffect(() => {
    // Warm the other tabs so the first click does not suspend the page (that suspend used to
    // replace the whole settings window with the route fallback).
    void import("../pages/Home");
    void import("../pages/Statistics");
    void import("../pages/Commands");
    void import("../pages/Models");
    void import("../pages/Queue");
    void import("../pages/Behavior");
    void import("../pages/Privacy");
    void import("../pages/Appearance");
    console.log("[atelier] preloading settings pages");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || Boolean(target?.isContentEditable);
      const wantsSearch = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (wantsSearch || (!typing && event.key === "/")) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        console.log("[atelier] focus settings search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const jumpToFirst = () => {
    const first = filteredGroups[0]?.items[0];
    if (!first) {
      console.log("[atelier] search has no match", query);
      return;
    }
    navigate(first.to);
    console.log("[atelier] search jump", query, "→", first.to);
  };

  return (
    <main className="workspace-root atelier app-window-frame" aria-label={m.shell.windowLabel}>
      <div className="atelier-glow" aria-hidden="true" />
      <div className="atelier-grain" aria-hidden="true" />
      <CustomTitleBar
        variant="workspace"
        restoreFloatingPanelAfterClose
        dragContent={
          <div className="atelier-wordmark">
            <span className="atelier-wordmark-serif">IME</span>
            <span className="atelier-wordmark-name">Companion</span>
            <span className="atelier-wordmark-rule" aria-hidden="true" />
            <span className="atelier-wordmark-section">{group.label}</span>
            <span className="atelier-wordmark-page">{active.label}</span>
          </div>
        }
      />
      <div className="atelier-body">
        <aside className="atelier-rail" aria-label={m.shell.railLabel}>
          <label className="atelier-search">
            <Search size={15} strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={m.shell.searchPlaceholder}
              aria-label={m.shell.searchAria}
              onChange={(event) => {
                setQuery(event.target.value);
                console.log("[atelier] search", event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") jumpToFirst();
                if (event.key === "Escape") {
                  setQuery("");
                  event.currentTarget.blur();
                }
              }}
            />
            <kbd>Ctrl K</kbd>
          </label>

          <ScrollArea.Root className="atelier-scroll atelier-scroll--rail">
            <ScrollArea.Viewport className="atelier-scroll-viewport">
              <ScrollArea.Content className="atelier-rail-content">
                {filteredGroups.length === 0 ? (
                  <p className="atelier-search-empty">{m.shell.searchEmpty}</p>
                ) : (
                  filteredGroups.map((entry) => (
                    <div key={entry.id} className="atelier-nav-group">
                      <p className="atelier-nav-label">{entry.label}</p>
                      {entry.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === "/home"}
                          className={({ isActive }) => `atelier-nav-link${isActive ? " active" : ""}`}
                        >
                          <span className="atelier-nav-index">{item.index}</span>
                          <item.Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                          <span className="atelier-nav-copy">
                            <span className="atelier-nav-title">{item.label}</span>
                            <span className="atelier-nav-hint">{item.hint}</span>
                          </span>
                        </NavLink>
                      ))}
                    </div>
                  ))
                )}
              </ScrollArea.Content>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar className="atelier-scrollbar" orientation="vertical">
              <ScrollArea.Thumb className="atelier-scrollbar-thumb" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>

          <footer className="atelier-rail-foot">
            <span className="atelier-rail-live" aria-hidden="true" />
            <div>
              <strong>{m.shell.runningLocal}</strong>
              <span>{m.shell.stayLocal(version)}</span>
            </div>
          </footer>
        </aside>

        <ScrollArea.Root className="atelier-scroll atelier-scroll--stage">
          <ScrollArea.Viewport ref={viewportRef} className="atelier-scroll-viewport">
            <ScrollArea.Content className="atelier-stage-content">
              <AtelierStage />
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar className="atelier-scrollbar" orientation="vertical">
            <ScrollArea.Thumb className="atelier-scrollbar-thumb" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
    </main>
  );
}
