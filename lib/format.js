// Display formatting helpers. These affect presentation only, never the math.

export const usd = (n, dp = 0) =>
  isFinite(n)
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      })
    : "—";

export const num = (n, dp = 0) =>
  isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "—";

export const pct = (n, dp = 1) =>
  isFinite(n) ? `${(n * 100).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}%` : "—";

export const cents = (n, dp = 2) =>
  isFinite(n) ? `${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}¢` : "—";
