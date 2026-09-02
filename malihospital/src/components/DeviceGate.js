import { useState, useEffect } from "react";

const COLORS = {
  green: "#14B53A",
  gold: "#FCD116",
  red: "#CE1126",
  ink: "#1B2A1F",
  slate: "#5B6B63",
  paper: "#FAF9F5",
};
const FONT_DISPLAY = "'Georgia', 'Iowan Old Style', 'Times New Roman', serif";
const FONT_BODY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

// 768px is the standard tablet-portrait breakpoint (iPad portrait is
// 768px wide) — anything narrower is treated as a phone. Checked on both
// width AND orientation so a phone rotated to landscape (often 700-800px
// wide) doesn't slip through just because the number alone looks tablet-
// sized; real tablets report a much larger height than a landscape phone
// does at the same width.
const MIN_WIDTH = 768;
const MIN_HEIGHT = 600;

function isAllowedSize(width, height) {
  return width >= MIN_WIDTH && height >= MIN_HEIGHT;
}

/**
 * Wraps the whole app (see App.js) and blocks phone-sized screens with a
 * clear, friendly message instead of letting the actual hospital UI try
 * (and fail) to render sensibly at phone width. Deliberately a soft,
 * screen-size-based check rather than user-agent sniffing — a real
 * tablet held in portrait or a small laptop window should both work
 * fine, and a phone forced into a huge browser zoom shouldn't bypass
 * this by accident either. Re-checks live on resize/rotation, so
 * someone who plugs a phone into an external monitor (or a foldable
 * device that's unfolded) isn't stuck behind a stale block.
 */
export default function DeviceGate({ children }) {
  const [allowed, setAllowed] = useState(() => isAllowedSize(window.innerWidth, window.innerHeight));

  useEffect(() => {
    const check = () => setAllowed(isAllowedSize(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  if (allowed) return children;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 18, backgroundColor: COLORS.paper, fontFamily: FONT_BODY,
      padding: 32, textAlign: "center",
    }}>
      <div style={{ display: "flex", width: 64, height: 44, borderRadius: 4, overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.18)" }}>
        <div style={{ flex: 1, background: COLORS.green }} />
        <div style={{ flex: 1, background: COLORS.gold }} />
        <div style={{ flex: 1, background: COLORS.red }} />
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: COLORS.ink, maxWidth: 420 }}>
        Écran trop petit
      </div>
      <p style={{ fontSize: 15, color: COLORS.slate, maxWidth: 380, lineHeight: 1.6, margin: 0 }}>
        Ce système est conçu pour être utilisé sur une tablette ou un ordinateur, afin de garantir un
        affichage clair et fiable pour un usage hospitalier. Veuillez vous connecter depuis un appareil
        avec un écran plus grand.
      </p>
      <p style={{ fontSize: 12.5, color: COLORS.slate, opacity: 0.75 }}>
        Largeur minimale requise : {MIN_WIDTH}px
      </p>
    </div>
  );
}