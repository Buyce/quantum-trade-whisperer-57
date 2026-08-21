// Shared brand styling for P-Trades Hub emails.
// Email bodies stay light for inbox compatibility; brand accents use the
// terminal's amber primary and mono numerics.
export const BRAND_AMBER = "#d99b26";
export const BRAND_INK = "#12100c";
export const BRAND_MUTED = "#6b6f76";
export const BRAND_BORDER = "#e6e3dd";
export const MONO = '"JetBrains Mono", Courier, monospace';

export const main = {
  backgroundColor: "#ffffff",
  fontFamily: "Helvetica, Arial, sans-serif",
};

export const container = {
  padding: "28px 26px",
  maxWidth: "560px",
  margin: "0 auto",
};

export const brandBar = {
  fontFamily: MONO,
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: BRAND_AMBER,
  margin: "0 0 22px",
};

export const h1 = {
  fontSize: "21px",
  fontWeight: "bold" as const,
  color: BRAND_INK,
  margin: "0 0 18px",
};

export const text = {
  fontSize: "14px",
  color: "#3f434a",
  lineHeight: "1.6",
  margin: "0 0 22px",
};

export const link = { color: BRAND_INK, textDecoration: "underline" };

export const button = {
  backgroundColor: BRAND_INK,
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "bold" as const,
  borderRadius: "6px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};

export const code = {
  fontFamily: MONO,
  fontSize: "26px",
  letterSpacing: "0.18em",
  fontWeight: "bold" as const,
  color: BRAND_INK,
  margin: "0 0 26px",
};

export const hr = {
  border: "none",
  borderTop: `1px solid ${BRAND_BORDER}`,
  margin: "28px 0 16px",
};

export const footer = {
  fontSize: "12px",
  color: BRAND_MUTED,
  lineHeight: "1.6",
  margin: "0",
};
