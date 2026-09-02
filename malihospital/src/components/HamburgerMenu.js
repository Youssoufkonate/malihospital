import { useState, useRef, useEffect } from "react";

/**
 * Shared hamburger-dropdown navigation, used by both SuperAdmin.js and
 * AdminPanel.js in place of their old horizontal tab bars. Kept as one
 * component rather than duplicating the same menu twice, since both
 * pages need identical behavior (open/close, click-outside-to-close,
 * badge counts) — only the tab list, active color, and badge logic
 * actually differ between them, all passed in as props.
 *
 * Props:
 *   tabs       - array of { key, label, icon? }
 *   activeTab  - the currently selected tab's key
 *   onSelect   - (key) => void, called when a tab is chosen
 *   getBadge   - optional (tab) => { count?: number, warn?: boolean }
 *   colors     - the calling page's own COLORS object, so this renders
 *                with that page's exact palette rather than a hardcoded one
 *   dark       - true for a dark header background (SuperAdmin), false
 *                for a light card background (AdminPanel) — controls
 *                which text/icon colors are used for the closed button
 */
export default function HamburgerMenu({ tabs, activeTab, onSelect, getBadge, colors, dark = false }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const activeTabObj = tabs.find((t) => t.key === activeTab);
  const totalBadgeCount = getBadge
    ? tabs.reduce((sum, t) => sum + (getBadge(t)?.count || 0), 0)
    : 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", borderRadius: 8, cursor: "pointer",
          border: dark ? "1.5px solid rgba(255,255,255,0.25)" : `1.5px solid ${colors.line}`,
          backgroundColor: dark ? "rgba(255,255,255,0.06)" : colors.card,
          color: dark ? "#fff" : colors.ink,
          fontSize: 13.5, fontWeight: 700, fontFamily: "inherit",
        }}
      >
        {/* Hamburger icon */}
        <span style={{ display: "flex", flexDirection: "column", gap: 3, width: 16 }}>
          <span style={{ height: 2, borderRadius: 1, backgroundColor: dark ? "#fff" : colors.ink }} />
          <span style={{ height: 2, borderRadius: 1, backgroundColor: dark ? "#fff" : colors.ink }} />
          <span style={{ height: 2, borderRadius: 1, backgroundColor: dark ? "#fff" : colors.ink }} />
        </span>
        <span>{activeTabObj ? `${activeTabObj.icon ? activeTabObj.icon + " " : ""}${activeTabObj.label}` : "Menu"}</span>
        {totalBadgeCount > 0 && (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
            backgroundColor: colors.red, color: "#fff", fontSize: 10.5, fontWeight: 700,
          }}>
            {totalBadgeCount}
          </span>
        )}
        <span style={{ fontSize: 10, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 260, zIndex: 100,
          backgroundColor: colors.card, border: `1px solid ${colors.line}`, borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)", overflow: "hidden", padding: 4,
        }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const badge = getBadge ? getBadge(tab) : null;
            return (
              <button
                key={tab.key}
                onClick={() => { onSelect(tab.key); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "10px 14px", border: "none", borderRadius: 7, cursor: "pointer",
                  textAlign: "left", fontSize: 13.5, fontWeight: isActive ? 700 : 500,
                  backgroundColor: isActive ? colors.green : "transparent",
                  color: isActive ? "#fff" : colors.ink,
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = colors.paper; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                {tab.icon && <span style={{ fontSize: 14 }}>{tab.icon}</span>}
                <span style={{ flex: 1 }}>{tab.label}</span>
                {badge?.warn && (
                  <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: isActive ? "#fff" : colors.red, flexShrink: 0 }} />
                )}
                {badge?.count > 0 && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
                    backgroundColor: isActive ? "#fff" : colors.red,
                    color: isActive ? colors.green : "#fff",
                    fontSize: 10.5, fontWeight: 700, flexShrink: 0,
                  }}>
                    {badge.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}