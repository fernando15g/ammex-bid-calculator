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
  client: "",
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
