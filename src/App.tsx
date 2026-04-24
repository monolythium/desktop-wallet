// Stage 0 placeholder. Real chrome ports from designs/wallet-*.jsx in Stage 2.
// Liquid-glass charcoal background per designs/design_handoff_monarch/README.md.

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background:
    "radial-gradient(120% 120% at 50% 0%, rgba(168, 64, 220, 0.18) 0%, rgba(20, 18, 28, 1) 60%)",
  color: "#F4F1FA",
  fontFamily:
    '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 18,
  letterSpacing: "0.01em",
};

const cardStyle: React.CSSProperties = {
  padding: "32px 40px",
  borderRadius: 18,
  background: "rgba(28, 24, 38, 0.55)",
  border: "1px solid rgba(244, 241, 250, 0.08)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  boxShadow:
    "0 24px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
};

export function App() {
  return (
    <div style={shellStyle}>
      <div style={cardStyle}>Monolythium Wallet — Desktop — scaffold v0.0.1</div>
    </div>
  );
}
