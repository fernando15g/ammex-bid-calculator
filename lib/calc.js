/*
 * Ammex Bid Calculator — calculation engine
 * -----------------------------------------------------------------------------
 * Direct port of "Amex_Rebar_Job_Estimator_Updated_v4.xlsx".
 * The workbook is the source of truth. Each function notes the workbook cells it
 * reproduces so the math stays auditable. No methodology was added or changed,
 * with ONE documented exception noted on the sensitivity table below.
 */

// Workbook defaults (Assumptions tab + Estimator seed values)
export const DEFAULTS = {
  // Project information (Estimator A5:B7) — labels only, no effect on math
  projectName: "",
  projectNumber: "",
  client: [], // GC(s) — multi-select
  cityCounty: "",
  bidDueDate: "", // YYYY-MM-DD
  fabricator: [], // multi-select: up to two of the known fabricators
  projectType: "Other",
  notes: "",

  // Editable numeric inputs. In the workbook these live on the Assumptions tab
  // and the Estimator mirrors them; here they are one editable source of truth.
  weightLb: 89476, // Estimator!B8
  crewSize: 6, // Assumptions!B9  -> Estimator!B10
  hoursPerDay: 8, // Assumptions!B8  -> Estimator!B11
  outputLbPerMH: 140, // Assumptions!B4  -> Estimator!B12  (lbs per man-hour)
  mobilizationHrs: 8, // Assumptions!B10 -> Estimator!B13
  wageRate: 32, // Assumptions!B5  -> Estimator!B14  ($/worker hr, before burden)
  burdenPct: 0.2, // Assumptions!B6  -> Estimator!B15  (Labor Burden & Field Overhead %)
  toolsPct: 0.03, // Assumptions!B7  -> Estimator!B16  (small tools / consumables)
  contingencyPct: 0.03, // Assumptions!B12 -> Estimator!B17
  targetMarginPct: 0.25, // Assumptions!B11 -> Estimator!B18

  // Reverse bid input (Estimator!B52)
  marketCentsPerLb: 40,

  // Specialty scope (labor-only add-on lines)
  specialtyOn: false,
  specialtyLines: [],
};

const safeDiv = (n, d) => (d ? n / d : 0); // mirrors the workbook's IFERROR(...,0)

/**
 * Core estimate — reproduces Estimator!B9, B27:B42.
 */
export function computeEstimate(i) {
  const weightTons = safeDiv(i.weightLb, 2000); // B9

  const fieldMH = safeDiv(i.weightLb, i.outputLbPerMH); // B27 = B8/B12
  const totalMH = fieldMH + i.mobilizationHrs; // B28 = B27+B13
  const crewDays = safeDiv(totalMH, i.crewSize * i.hoursPerDay); // B29
  const loadedRate = i.wageRate * (1 + i.burdenPct); // B30 = B14*(1+B15)

  const directLabor = totalMH * loadedRate; // B31 = B28*B30
  const tools = directLabor * i.toolsPct; // B32 = B31*B16
  const subtotal = directLabor + tools; // B33 = B31+B32
  const contingency = subtotal * i.contingencyPct; // B34 = B33*B17
  const totalCost = subtotal + contingency; // B35 = B33+B34

  const bid = safeDiv(totalCost, 1 - i.targetMarginPct); // B36 = B35/(1-B18)
  const bidPerLb = safeDiv(bid, i.weightLb); // B37
  const bidCentsPerLb = bidPerLb * 100; // B38
  const bidPerTon = safeDiv(bid, weightTons); // B39
  const breakevenPerTon = safeDiv(totalCost, weightTons); // B40
  const grossProfit = bid - totalCost; // B41
  const grossMargin = safeDiv(grossProfit, bid); // B42

  // "Revenue / Profit per Labor Hour" for the recommended bid use the workbook's
  // own metric definition from the reverse-bid section (B58/B59):
  //   revenue per MH = price/lb * planned output ;  profit per MH = that - loaded rate
  const revenuePerMH = bidPerLb * i.outputLbPerMH; // mirrors B58 pattern
  const profitPerMH = revenuePerMH - loadedRate; // mirrors B59 pattern

  return {
    weightTons,
    fieldMH,
    totalMH,
    crewDays,
    loadedRate,
    directLabor,
    tools,
    subtotal,
    contingency,
    totalCost,
    bid,
    bidPerLb,
    bidCentsPerLb,
    bidPerTon,
    breakevenPerTon,
    grossProfit,
    grossMargin,
    revenuePerMH,
    profitPerMH,
  };
}

/**
 * Quick review flags — reproduces Estimator!B44:B47.
 */
export function computeFlags(i, e) {
  const flags = [];
  if (i.outputLbPerMH > 250)
    flags.push({ level: "warn", label: "Planned output above 250 lb/MH", note: "Check aggressively — may be too optimistic." });
  if (i.outputLbPerMH < 140)
    flags.push({ level: "warn", label: "Planned output below 140 lb/MH", note: "Check — may be too conservative or a highly complex job." });
  if (i.crewSize < 3)
    flags.push({ level: "warn", label: "Crew size under 3", note: "Small crew may create inefficiency." });
  if (e.crewDays > 20)
    flags.push({ level: "warn", label: "Long duration", note: "Over 20 crew days — confirm phasing and supervision." });
  return flags;
}

/**
 * Reverse bid analysis — reproduces Estimator!B53:B61.
 * Uses totalCost from the main estimate (Estimator!B35), exactly as the workbook.
 */
export function computeReverse(i, e) {
  const cents = i.marketCentsPerLb;
  const inputPerLb = safeDiv(cents, 100); // B53
  const inputPerTon = inputPerLb * 2000; // B54
  const impliedBid = inputPerLb * i.weightLb; // B55
  const impliedProfit = impliedBid - e.totalCost; // B56
  const impliedMargin = safeDiv(impliedProfit, impliedBid); // B57
  const revenuePerMH = inputPerLb * i.outputLbPerMH; // B58
  const profitPerMH = revenuePerMH - e.loadedRate; // B59
  const atOrAboveTarget = impliedMargin >= i.targetMarginPct; // B61

  // Required productivity at THIS bid price.
  // Cost at productivity p:  cost(p) = (weight/p + mob) * M
  //   where M = fully-loaded cost per total man-hour.
  // Solve for the p that makes cost equal a target dollar amount, then invert:
  //   weight/p = targetCost/M - mob   ->   p = weight / (targetCost/M - mob)
  const M = e.loadedRate * (1 + i.toolsPct) * (1 + i.contingencyPct);
  const revenue = impliedBid; // revenue is fixed by the bid price, independent of p
  const prodForCost = (targetCost) => {
    if (i.weightLb <= 0 || M <= 0) return null;
    const denom = targetCost / M - i.mobilizationHrs; // = weight / p
    return denom > 0 ? i.weightLb / denom : null; // null = not achievable at any productivity
  };
  const breakEvenProd = prodForCost(revenue); // profit = $0
  const targetMarginProd = prodForCost(revenue * (1 - i.targetMarginPct)); // hits target margin

  return {
    centsPerLb: cents,
    inputPerLb,
    inputPerTon,
    impliedBid,
    impliedProfit,
    impliedMargin,
    revenuePerMH,
    profitPerMH,
    atOrAboveTarget,
    breakEvenProd,
    targetMarginProd,
  };
}

// Sensitivity rows center on the user's Section 2 productivity and step outward.
export const SENSITIVITY_STEP = 10; // lb/MH between rows
export const SENSITIVITY_ROWS_EACH_WAY = 5; // rows above and below the center

// Build the productivity levels for the table, centered on `center` (the planned
// lb/MH from Assumptions). Steps by SENSITIVITY_STEP, with SENSITIVITY_ROWS_EACH_WAY
// rows on each side. Floored so it never reaches zero or negative.
export function buildSensitivityOutputs(center) {
  const c = Math.round(Number(center) || 0);
  if (c <= 0) return [];
  const levels = [];
  for (let k = -SENSITIVITY_ROWS_EACH_WAY; k <= SENSITIVITY_ROWS_EACH_WAY; k++) {
    const val = c + k * SENSITIVITY_STEP;
    if (val >= SENSITIVITY_STEP) levels.push(val); // floor: drop rows at/below zero
  }
  return levels;
}

/**
 * Sensitivity table — bid-locked mode.
 *
 * The bid price is held FIXED at lockedCentsPerLb (the recommended bid's ¢/lb by
 * default, or a user override) and we show what the MARGIN and gross profit would
 * actually be at each productivity level. Answers "if I hold this price, how does
 * my margin move as crew production runs faster or slower than planned?" The
 * planned-output row returns the target margin because the recommended bid was
 * priced at that productivity. Cost uses the Estimator's compounding method so the
 * numbers tie to the headline estimate.
 */
export function computeSensitivity(i, lockedCentsPerLb) {
  const loadedRate = i.wageRate * (1 + i.burdenPct);
  const lockedPerLb = safeDiv(lockedCentsPerLb, 100);
  const revenue = lockedPerLb * i.weightLb; // same bid $ on every row (price is locked)
  const outputs = buildSensitivityOutputs(i.outputLbPerMH); // centered on Section 2 productivity

  return outputs.map((out) => {
    const fieldMH = safeDiv(i.weightLb, out);
    const totalMH = fieldMH + i.mobilizationHrs;
    const directLabor = totalMH * loadedRate;
    const cost = directLabor * (1 + i.toolsPct) * (1 + i.contingencyPct); // compounding, matches Estimator

    const profit = revenue - cost;
    const margin = safeDiv(profit, revenue);
    return { out, fieldMH, totalMH, cost, revenue, profit, margin };
  });
}

// ---------------------------------------------------------------------------
// Final-bid rounding + override
// ---------------------------------------------------------------------------

// Round a ¢/lb value to the nearest quarter-cent (e.g. 57.06 -> 57.00, 57.20 -> 57.25).
export const roundToQuarterCent = (cents) => Math.round(Number(cents) / 0.25) * 0.25;

/**
 * Recompute the bid-dependent outputs from an "active" bid rate (¢/lb), which may
 * be the auto-rounded recommendation or a manual override. INPUTS AND COST STAY
 * FIXED — only the price-derived outputs move. Mirrors the Estimator's own output
 * formulas (B36:B42), just driven by the chosen bid instead of the target margin.
 */
export function applyBid(i, e, activeCentsPerLb) {
  const perLb = safeDiv(activeCentsPerLb, 100);
  const bid = perLb * i.weightLb;
  const perTon = perLb * 2000;
  const grossProfit = bid - e.totalCost;
  const grossMargin = safeDiv(grossProfit, bid);
  const revenuePerMH = perLb * i.outputLbPerMH; // rate × productivity (matches B58 pattern)
  const profitPerMH = revenuePerMH - e.loadedRate; // less loaded rate (matches B59 pattern)
  return { centsPerLb: activeCentsPerLb, perLb, bid, perTon, grossProfit, grossMargin, revenuePerMH, profitPerMH };
}

// ---------------------------------------------------------------------------
// Specialty scope (PT Bridge / PT Building / Mesh) — LABOR ONLY
// ---------------------------------------------------------------------------
// Each line uses the SAME cost stack as rebar: quantity ÷ productivity -> hours,
// then hours × fully-loaded cost per man-hour. Material is intentionally excluded
// (tracked in the OS, not here). Mesh productivity is optional: if blank the line
// books revenue with NO cost basis and is flagged, rather than guessing a rate.

export const SPECIALTY_TYPES = ["PT Bridge", "PT Building", "Mesh"];

// Fully-loaded cost per total man-hour (same multipliers as the Estimator).
export const costPerMH = (i) =>
  i.wageRate * (1 + i.burdenPct) * (1 + i.toolsPct) * (1 + i.contingencyPct);

let __sid = 0;
export const newSpecialtyLine = (type = "PT Building") => ({
  id: `s${Date.now()}_${__sid++}`,
  type,
  tons: "", lbs: "", prodLbPerMH: type === "PT Building" ? 98 : "", // PT Building
  hours: "", ratePerHour: "",                                       // PT Bridge
  sqft: "", prodSqftPerMH: "", rateCentsPerSqft: "",                // Mesh
  rateCentsPerLb: "",                                               // PT Building rate
});

const n = (x) => (x === "" || x == null || isNaN(Number(x)) ? 0 : Number(x));
const blank = (x) => x === "" || x == null || isNaN(Number(x)) || Number(x) <= 0;

/**
 * Compute one specialty line. Returns quantity label, hours, cost, revenue,
 * the recommended rate (priced to target margin) and whether a cost basis exists.
 */
export function computeSpecialtyLine(line, i) {
  const M = costPerMH(i);
  const target = i.targetMarginPct;
  const out = {
    id: line.id, type: line.type, hours: 0, cost: 0, revenue: 0,
    hasCostBasis: false, recommendedRate: null, rateUnit: "", qtyLabel: "",
  };

  if (line.type === "PT Building") {
    const lbs = n(line.lbs);
    out.qtyLabel = `${lbs.toLocaleString()} lb`;
    out.rateUnit = "¢/lb";
    if (!blank(line.prodLbPerMH) && lbs > 0) {
      out.hours = lbs / n(line.prodLbPerMH);
      out.cost = out.hours * M;
      out.hasCostBasis = true;
      out.recommendedRate = safeDiv(safeDiv(out.cost, 1 - target), lbs) * 100; // ¢/lb
    }
    out.revenue = (n(line.rateCentsPerLb) / 100) * lbs;
  } else if (line.type === "PT Bridge") {
    const hrs = n(line.hours);
    out.qtyLabel = `${hrs.toLocaleString()} hrs`;
    out.rateUnit = "$/hr";
    if (hrs > 0) {
      out.hours = hrs;                 // fabricator-provided hours
      out.cost = hrs * M;
      out.hasCostBasis = true;
      out.recommendedRate = safeDiv(M, 1 - target); // $/hr to hit target
    }
    out.revenue = hrs * n(line.ratePerHour);
  } else if (line.type === "Mesh") {
    const sqft = n(line.sqft);
    out.qtyLabel = `${sqft.toLocaleString()} sqft`;
    out.rateUnit = "¢/sqft";
    if (!blank(line.prodSqftPerMH) && sqft > 0) {
      out.hours = sqft / n(line.prodSqftPerMH);
      out.cost = out.hours * M;
      out.hasCostBasis = true;
      out.recommendedRate = safeDiv(safeDiv(out.cost, 1 - target), sqft) * 100; // ¢/sqft
    }
    out.revenue = (n(line.rateCentsPerSqft) / 100) * sqft;
  }

  out.profit = out.hasCostBasis ? out.revenue - out.cost : null;
  out.margin = out.hasCostBasis ? safeDiv(out.profit, out.revenue) : null;
  return out;
}

/**
 * Roll specialty lines up and combine with the rebar side.
 * rebar: { revenue, cost, hours } from the active bid + estimate.
 */
export function computeSpecialtyRollup(lines, i, rebar) {
  const rows = (lines || []).map((l) => computeSpecialtyLine(l, i));
  const specRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const specCost = rows.reduce((s, r) => s + r.cost, 0);
  const specHours = rows.reduce((s, r) => s + r.hours, 0);
  const missingBasis = rows.filter((r) => !r.hasCostBasis && r.revenue > 0).length;

  const totalRevenue = rebar.revenue + specRevenue;
  const totalCost = rebar.cost + specCost;
  const totalHours = rebar.hours + specHours;
  const totalProfit = totalRevenue - totalCost;
  const totalMargin = safeDiv(totalProfit, totalRevenue);

  return {
    rows, specRevenue, specCost, specHours, missingBasis,
    specProfit: specRevenue - specCost,
    specMargin: safeDiv(specRevenue - specCost, specRevenue),
    totalRevenue, totalCost, totalHours, totalProfit, totalMargin,
  };
}
