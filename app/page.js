"use client";

import { useEffect, useMemo, useState } from "react";
import PasswordGate from "@/components/PasswordGate";
import { Section, Field, StatCard } from "@/components/ui";
import {
  DEFAULTS,
  computeEstimate,
  computeFlags,
  computeReverse,
  computeSensitivity,
  roundToQuarterCent,
  applyBid,
} from "@/lib/calc";
import { usd, num, pct, cents } from "@/lib/format";

const PROJECT_TYPES = [
  "Bridge",
  "Box Culvert",
  "Drainage Structure",
  "Industrial Building",
  "Warehouse",
  "Multifamily",
  "Site Structure",
  "Retaining Wall",
  "PT Structure",
  "Other",
];

const FABRICATORS = ["Tyler Reinforcing", "CMC", "Self-Performing"];

export default function Page() {
  return (
    <PasswordGate>
      <Calculator />
    </PasswordGate>
  );
}

const STORAGE_KEY = "ammex_bid_state";

function Calculator() {
  const [v, setV] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));

  // Load the last saved entries on open (per-device, this browser only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setV({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch {}
    setLoaded(true);
  }, []);

  // Save after every change so the last bid is remembered next time.
  useEffect(() => {
    if (!loaded) return; // don't overwrite saved data before it loads
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {}
  }, [v, loaded]);

  // Clear: blank all Project Information, plus weight + productivity only.
  // Everything else (crew, wage, burden, margins, market rate) stays put.
  function clearForNewBid() {
    setV((s) => ({
      ...s,
      projectName: "",
      projectNumber: "",
      client: "",
      cityCounty: "",
      bidDueDate: "",
      fabricator: [],
      projectType: "Other",
      notes: "",
      weightLb: "",
      outputLbPerMH: "",
    }));
  }

  // Guard against blank inputs while typing (treat "" as 0 for math).
  const i = useMemo(() => {
    const n = {};
    for (const k in v) n[k] = v[k] === "" ? 0 : v[k];
    return n;
  }, [v]);

  const e = useMemo(() => computeEstimate(i), [i]);
  const flags = useMemo(() => computeFlags(i, e), [i, e]);
  const rev = useMemo(() => computeReverse(i, e), [i, e]);

  // Sensitivity bid is locked to the recommended bid by default. Typing a number
  // into the override field tests that price instead; clearing it returns to auto.
  const [sensBidOverride, setSensBidOverride] = useState("");
  const lockedCents =
    sensBidOverride === "" || isNaN(Number(sensBidOverride))
      ? e.bidCentsPerLb
      : Number(sensBidOverride);
  const sens = useMemo(() => computeSensitivity(i, lockedCents), [i, lockedCents]);

  // Final bid: auto-round the recommendation to the nearest quarter-cent. An
  // optional override lets the user set a specific final bid; clearing it returns
  // to the rounded recommendation. Cost/inputs stay fixed; outputs follow the
  // active bid (and the active bid is what saves to Notion).
  const [bidOverride, setBidOverride] = useState("");
  const recommendedCents = e.bidCentsPerLb;
  const roundedCents = roundToQuarterCent(recommendedCents);
  const bidOverridden = bidOverride !== "" && !isNaN(Number(bidOverride));
  const activeCents = bidOverridden ? Number(bidOverride) : roundedCents;
  const d = useMemo(() => applyBid(i, e, activeCents), [i, e, activeCents]);

  const marginTone = d.grossMargin >= i.targetMarginPct ? "good" : "bad";

  // Save the bid's raw inputs as a new row in the Notion Bid Tracker.
  const [notionStatus, setNotionStatus] = useState("idle"); // idle | saving | saved | error
  const [notionMsg, setNotionMsg] = useState("");

  async function saveToNotion() {
    setNotionStatus("saving");
    setNotionMsg("");
    try {
      const res = await fetch("/api/save-to-notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: v.projectName,
          estimatedLbs: i.weightLb,
          lbsPerMH: i.outputLbPerMH,
          crewSize: i.crewSize,
          laborRate: i.wageRate,
          bidRatePerLb: Number(d.perLb.toFixed(4)), // active (rounded/override) bid, $/lb
          gc: v.client,
          cityCounty: v.cityCounty,
          bidDueDate: v.bidDueDate,
          fabricator: v.fabricator,
          notes: v.notes,
          // computed from the active bid (what you actually see/save)
          operatingProfit: Number(d.grossProfit.toFixed(2)),
          operatingMargin: Number(d.grossMargin.toFixed(4)), // ratio
          fullyLoadedCost: Number(e.totalCost.toFixed(2)),
          burdenedLaborCost: Number(e.directLabor.toFixed(2)),
          // assumptions used on this bid (ratios for the % ones)
          burdenPct: i.burdenPct,
          toolsPct: i.toolsPct,
          contingencyPct: i.contingencyPct,
          mobilizationHrs: i.mobilizationHrs,
          targetMarginPct: i.targetMarginPct,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setNotionStatus("saved");
        setTimeout(() => setNotionStatus("idle"), 3000);
      } else {
        setNotionStatus("error");
        setNotionMsg(data.error || "Save failed.");
      }
    } catch {
      setNotionStatus("error");
      setNotionMsg("Could not reach the server. Try again.");
    }
  }

  function copySummary() {
    const lines = [
      `AMMEX REBAR — BID SUMMARY`,
      v.projectName ? `Project: ${v.projectName}` : null,
      v.projectNumber ? `Project #: ${v.projectNumber}` : null,
      v.client ? `GC: ${v.client}` : null,
      v.fabricator && v.fabricator.length ? `Fabricator: ${v.fabricator.join(", ")}` : null,
      v.cityCounty ? `City/County: ${v.cityCounty}` : null,
      v.bidDueDate ? `Bid due: ${v.bidDueDate}` : null,
      `Project type: ${v.projectType}`,
      ``,
      `Weight: ${num(i.weightLb)} lb (${num(e.weightTons, 2)} tons)`,
      `Productivity: ${num(i.outputLbPerMH)} lb/MH`,
      `Crew: ${num(i.crewSize)} @ ${num(i.hoursPerDay)} hrs/day`,
      `Labor hours: ${num(e.totalMH, 1)} MH (${num(e.crewDays, 1)} crew days)`,
      `Total cost: ${usd(e.totalCost)}`,
      ``,
      `FINAL BID: ${usd(d.bid)}`,
      `Bid rate: ${cents(activeCents)}/lb  •  ${usd(d.perTon)}/ton`,
      `Gross profit: ${usd(d.grossProfit)}`,
      `Gross margin: ${pct(d.grossMargin)}`,
      v.notes ? `\nNotes: ${v.notes}` : null,
    ].filter(Boolean);
    navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="min-h-screen pb-16">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-line bg-gunmetal">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <div className="eyebrow text-rebar text-[10px] leading-none">Ammex Rebar Placers</div>
            <div className="font-display text-xl font-bold uppercase leading-tight tracking-wide text-white">Bid Calculator</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-eyebrow text-white/50">{bidOverridden ? "Final bid" : "Bid rate"}</div>
            <div className="tnum font-display text-2xl font-bold leading-none text-rebarLite">{cents(activeCents)}/lb</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-6">
        {/* 1 — PROJECT INFORMATION */}
        <Section index={1} title="Project Information" subtitle="For organization and reporting — does not affect the math.">
          <div className="flex justify-end px-4 pt-4">
            <button
              onClick={clearForNewBid}
              className="rounded-md border border-line bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate2 transition hover:border-rebar hover:text-rebar active:translate-y-px"
            >
              Clear for new bid
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <Field label="Project name" type="text" value={v.projectName} onChange={set("projectName")} placeholder="e.g. SR-101 Box Culvert" />
            <Field label="Project number" type="text" value={v.projectNumber} onChange={set("projectNumber")} placeholder="Optional" />
            <Field label="GC" type="text" value={v.client} onChange={set("client")} placeholder="General contractor" />
            <Field label="City / County" type="text" value={v.cityCounty} onChange={set("cityCounty")} placeholder="e.g. Maricopa County" />
            <Field label="Bid due date" type="date" value={v.bidDueDate} onChange={set("bidDueDate")} />
            <Field label="Project type" value={v.projectType} onChange={set("projectType")} options={PROJECT_TYPES} />
            <div className="sm:col-span-2">
              <FabricatorPicker value={v.fabricator} onChange={set("fabricator")} />
            </div>
            <div className="sm:col-span-2">
              <Field label="Notes" textarea value={v.notes} onChange={set("notes")} placeholder="Access, phasing, congestion, deck height, night work…" />
            </div>
          </div>
        </Section>

        {/* 2 — ASSUMPTIONS & INPUTS */}
        <Section index={2} title="Assumptions & Inputs" subtitle="You control every assumption. The calculator only does the math.">
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="Total rebar weight" value={v.weightLb} onChange={set("weightLb")} step="any" suffix="lb" hint={`${num(e.weightTons, 2)} tons`} />
            <Field label="Productivity" value={v.outputLbPerMH} onChange={set("outputLbPerMH")} step="any" suffix="lb/MH" hint="Lbs placed per man-hour" />
            <Field label="Crew size" value={v.crewSize} onChange={set("crewSize")} step="any" suffix="ppl" />
            <Field label="Hours per day" value={v.hoursPerDay} onChange={set("hoursPerDay")} step="any" suffix="hrs" />
            <Field label="Mobilization / setup" value={v.mobilizationHrs} onChange={set("mobilizationHrs")} step="any" suffix="hrs" />
            <Field label="Base wage rate" value={v.wageRate} onChange={set("wageRate")} step="any" prefix="$" suffix="/hr" />
            <Field
              label="Labor Burden & Field Overhead %"
              value={pctIn(v.burdenPct)}
              onChange={(x) => set("burdenPct")(pctOut(x))}
              step="any"
              suffix="%"
              hint="Payroll tax, comp, insurance, tools/vehicle allocation, misc field OH"
            />
            <Field label="Small tools / consumables %" value={pctIn(v.toolsPct)} onChange={(x) => set("toolsPct")(pctOut(x))} step="any" suffix="%" />
            <Field label="Contingency %" value={pctIn(v.contingencyPct)} onChange={(x) => set("contingencyPct")(pctOut(x))} step="any" suffix="%" />
            <Field label="Target gross margin %" value={pctIn(v.targetMarginPct)} onChange={(x) => set("targetMarginPct")(pctOut(x))} step="any" suffix="%" />
          </div>

          {flags.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-eyebrow text-warn">Review flags</div>
              <ul className="space-y-1.5">
                {flags.map((f, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-gunmetal">
                    <span className="mt-0.5 text-warn">▲</span>
                    <span>
                      <span className="font-semibold">{f.label}.</span> <span className="text-slate2">{f.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* 3 — COST BREAKDOWN */}
        <Section index={3} title="Cost Breakdown">
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Weight" value={`${num(i.weightLb)} lb`} sub={`${num(e.weightTons, 2)} tons`} />
            <StatCard label="Field man-hours" value={num(e.fieldMH, 1)} sub="weight ÷ productivity" />
            <StatCard label="Total man-hours" value={num(e.totalMH, 1)} sub="incl. mobilization" />
            <StatCard label="Crew days" value={num(e.crewDays, 1)} sub={`${num(i.crewSize)} × ${num(i.hoursPerDay)} hrs`} />
            <StatCard label="Loaded labor rate" value={usd(e.loadedRate, 2)} sub="wage + burden" />
            <StatCard label="Direct labor cost" value={usd(e.directLabor)} />
            <StatCard label="Tools / consumables" value={usd(e.tools)} />
            <StatCard label="Contingency" value={usd(e.contingency)} />
            <StatCard label="Total estimated cost" value={usd(e.totalCost)} tone="dark" />
            <StatCard label="Breakeven / ton" value={usd(e.breakevenPerTon)} />
          </div>
        </Section>

        {/* 4 — RECOMMENDED BID RESULTS */}
        <Section index={4} title="Recommended Bid" subtitle={`Priced to your ${pct(i.targetMarginPct, 0)} target margin, then rounded to the nearest quarter-cent.`}>
          {/* Hero */}
          <div className="border-b border-line bg-steel p-5 sm:p-6">
            <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <div className="eyebrow text-[10px] text-white/55">{bidOverridden ? "Final bid (override)" : "Recommended bid"}</div>
                <div className="tnum font-display text-5xl font-bold leading-none text-white sm:text-6xl">{usd(d.bid)}</div>
                <div className="mt-2 text-sm text-white/60">
                  {num(i.weightLb)} lb · {num(e.weightTons, 2)} tons · {num(e.totalMH, 1)} labor hrs
                </div>
              </div>
              <div className="dim-line w-full px-3 py-2 text-center sm:w-auto sm:min-w-[180px]">
                <div className="eyebrow text-[10px] text-rebarLite">Bid rate</div>
                <div className="tnum font-display text-4xl font-bold leading-none text-white">{cents(activeCents)}</div>
                <div className="text-[11px] uppercase tracking-eyebrow text-white/45">per lb</div>
              </div>
            </div>
          </div>

          {/* Final bid override */}
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-[240px]">
              <Field
                label="Final bid override"
                value={bidOverride}
                onChange={(x) => setBidOverride(x === "" ? "" : x)}
                step="any"
                suffix="¢/lb"
                placeholder={cents(roundedCents)}
                hint={bidOverridden ? "Using your bid · clear to return to recommended" : "Auto-rounded — type a number to override"}
              />
            </div>
            <div className="pb-1 text-[11px] text-slate2/80">
              Computed <span className="tnum font-semibold text-gunmetal">{cents(recommendedCents)}/lb</span>
              <span className="text-slate2/50"> · </span>
              rounded to <span className="tnum font-semibold text-gunmetal">{cents(roundedCents)}/lb</span>
              {bidOverridden && (
                <>
                  <span className="text-slate2/50"> · </span>
                  using <span className="tnum font-semibold text-rebar">{cents(activeCents)}/lb</span>
                </>
              )}
            </div>
          </div>

          {/* Supporting metrics */}
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Bid rate / lb" value={usd(d.perLb, 4)} />
            <StatCard label="Bid rate / ton" value={usd(d.perTon)} />
            <StatCard label="Gross profit" value={usd(d.grossProfit)} tone={d.grossProfit >= 0 ? "good" : "bad"} />
            <StatCard label="Gross margin" value={pct(d.grossMargin)} tone={marginTone} />
            <StatCard label="Revenue / labor hr" value={usd(d.revenuePerMH, 2)} sub="rate × productivity" />
            <StatCard label="Profit / labor hr" value={usd(d.profitPerMH, 2)} sub="less loaded rate" />
          </div>
        </Section>

        {/* 5 — REVERSE BID ANALYSIS */}
        <Section index={5} title="Reverse Bid Analysis" subtitle="Enter a market bid rate to see the margin it implies — and the productivity your crew would need to hit at that price.">
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[220px_1fr] lg:items-start">
            <div className="rounded-md border border-line bg-white p-3.5">
              <Field label="Market / target bid rate" value={v.marketCentsPerLb} onChange={set("marketCentsPerLb")} step="any" suffix="¢/lb" hint={`${usd(rev.inputPerLb, 4)}/lb · ${usd(rev.inputPerTon)}/ton`} />
              <div className={`mt-3 rounded px-3 py-2 text-center text-sm font-semibold ${rev.atOrAboveTarget ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
                {rev.atOrAboveTarget ? "At or above target" : "Below target — review price or productivity"}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard label="Implied revenue" value={usd(rev.impliedBid)} />
                <StatCard label="Estimated cost" value={usd(e.totalCost)} />
                <StatCard label="Gross profit" value={usd(rev.impliedProfit)} tone={rev.impliedProfit >= 0 ? "good" : "bad"} />
                <StatCard label="Gross margin" value={pct(rev.impliedMargin)} tone={rev.atOrAboveTarget ? "good" : "bad"} />
                <StatCard label="Revenue / labor hr" value={usd(rev.revenuePerMH, 2)} />
                <StatCard label="Profit / labor hr" value={usd(rev.profitPerMH, 2)} />
              </div>

              {/* Productivity required at this bid price */}
              <div className="rounded-md border border-line bg-white p-3.5">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-slate2">Productivity needed at this price</span>
                  <span className="tnum text-[11px] text-slate2/80">
                    You planned <span className="font-semibold text-gunmetal">{num(i.outputLbPerMH)} lb/MH</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <ProdCard
                    label={`For ${pct(i.targetMarginPct, 0)} target margin`}
                    prod={rev.targetMarginProd}
                    planned={i.outputLbPerMH}
                  />
                  <ProdCard label="To break even" prod={rev.breakEvenProd} planned={i.outputLbPerMH} breakeven />
                </div>
                <p className="mt-2.5 text-[11px] leading-snug text-slate2/70">
                  Lower than your planned pace means you have room to spare; higher means your crew must beat plan to make it work.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* 6 — SENSITIVITY ANALYSIS */}
        <Section index={6} title="Sensitivity Analysis" subtitle="Centered on your Section 2 productivity, ±5 rows. Holds your bid fixed and shows how margin moves as production runs faster or slower. Your planned row is highlighted.">
          <div className="flex flex-col gap-2 px-4 pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-[260px]">
              <Field
                label="Bid price to hold"
                value={sensBidOverride}
                onChange={(x) => setSensBidOverride(x === "" ? "" : x)}
                step="any"
                suffix="¢/lb"
                placeholder={cents(e.bidCentsPerLb)}
                hint={sensBidOverride === "" ? "Tracking recommended bid — type to test another price" : "Testing your price · clear the field to return to recommended"}
              />
            </div>
            <div className="pb-1 text-[11px] text-slate2/80">
              Holding <span className="tnum font-semibold text-gunmetal">{cents(lockedCents)}/lb</span>
              {sensBidOverride === "" ? " (recommended)" : " (manual)"}
            </div>
          </div>

          <div className="overflow-x-auto p-1 sm:p-2">
            <table className="tnum w-full min-w-[520px] border-collapse text-right text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-eyebrow text-slate2">
                  <th className="px-3 py-2 text-left font-semibold">lb/MH</th>
                  <th className="px-3 py-2 font-semibold">Field MH</th>
                  <th className="px-3 py-2 font-semibold">Total MH</th>
                  <th className="px-3 py-2 font-semibold">Total cost</th>
                  <th className="px-3 py-2 font-semibold">Gross profit</th>
                  <th className="px-3 py-2 font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody>
                {sens.map((r) => {
                  const planned = Number(r.out) === Number(i.outputLbPerMH);
                  const atOrAbove = r.margin >= i.targetMarginPct - 1e-9; // epsilon avoids float noise at equality
                  return (
                    <tr key={r.out} className={`border-t border-line ${planned ? "bg-rebar/[0.08]" : ""}`}>
                      <td className={`px-3 py-2.5 text-left font-display font-semibold ${planned ? "text-rebar" : "text-gunmetal"}`}>
                        {num(r.out)}
                        {planned && <span className="ml-1.5 align-middle text-[9px] uppercase tracking-eyebrow text-rebar">Planned</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate2">{num(r.fieldMH, 1)}</td>
                      <td className="px-3 py-2.5 text-slate2">{num(r.totalMH, 1)}</td>
                      <td className="px-3 py-2.5">{usd(r.cost)}</td>
                      <td className={`px-3 py-2.5 ${r.profit >= 0 ? "text-good" : "text-bad"}`}>{usd(r.profit)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${atOrAbove ? "bg-good/[0.12] text-good" : "bg-warn/[0.12] text-warn"}`}>
                          {pct(r.margin)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-[11px] text-slate2/70">
            Bid price is held fixed across every row, so margin and gross profit show what you'd actually earn at each productivity level. Green meets or beats your {pct(i.targetMarginPct, 0)} target; amber falls below. Cost uses the same compounding method as the headline estimate.
          </p>
        </Section>

        {/* 7 — BID SUMMARY */}
        <Section index={7} title="Bid Summary">
          <div className="p-4">
            <div className="rounded-md border border-line bg-white">
              <SummaryRow k="Project" val={v.projectName || "—"} />
              {v.projectNumber && <SummaryRow k="Project #" val={v.projectNumber} />}
              {v.client && <SummaryRow k="GC" val={v.client} />}
              {v.fabricator && v.fabricator.length > 0 && <SummaryRow k="Fabricator" val={v.fabricator.join(", ")} />}
              {v.cityCounty && <SummaryRow k="City / County" val={v.cityCounty} />}
              {v.bidDueDate && <SummaryRow k="Bid due" val={v.bidDueDate} />}
              <SummaryRow k="Type" val={v.projectType} />
              <SummaryRow k="Weight" val={`${num(i.weightLb)} lb · ${num(e.weightTons, 2)} tons`} />
              <SummaryRow k="Productivity" val={`${num(i.outputLbPerMH)} lb/MH`} />
              <SummaryRow k="Labor hours" val={`${num(e.totalMH, 1)} MH · ${num(e.crewDays, 1)} crew days`} />
              <SummaryRow k="Total cost" val={usd(e.totalCost)} />
              <SummaryRow k={bidOverridden ? "Final bid" : "Recommended bid"} val={usd(d.bid)} strong />
              <SummaryRow k="Bid rate" val={`${cents(activeCents)}/lb · ${usd(d.perTon)}/ton`} />
              <SummaryRow k="Gross profit" val={usd(d.grossProfit)} />
              <SummaryRow k="Gross margin" val={pct(d.grossMargin)} last />
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                onClick={saveToNotion}
                disabled={notionStatus === "saving"}
                className="w-full rounded-md bg-gunmetal py-3 font-display font-semibold uppercase tracking-wide text-white transition hover:bg-steel active:translate-y-px disabled:opacity-60 sm:w-auto sm:px-8"
              >
                {notionStatus === "saving"
                  ? "Saving…"
                  : notionStatus === "saved"
                  ? "Saved to Notion ✓"
                  : "Save bid to Notion"}
              </button>
              <button
                onClick={copySummary}
                className="w-full rounded-md bg-rebar py-3 font-display font-semibold uppercase tracking-wide text-white transition hover:bg-rebarLite active:translate-y-px sm:w-auto sm:px-8"
              >
                {copied ? "Copied ✓" : "Copy to clipboard"}
              </button>
            </div>
            {notionStatus === "error" && (
              <p className="mt-2 text-sm text-bad">{notionMsg}</p>
            )}
          </div>
        </Section>

        <footer className="mt-8 text-center text-[11px] text-slate2/60">
          Ammex Rebar Placers · Estimating assumptions are user-controlled · Calculator performs the math only
        </footer>
      </main>
    </div>
  );
}

function ProdCard({ label, prod, planned, breakeven }) {
  const p = Number(planned) || 0;
  let value, tone, note;
  if (prod == null || !isFinite(prod) || prod <= 0) {
    value = "—";
    tone = "bad";
    note = breakeven ? "Loses money at any pace" : "Not achievable at any pace";
  } else {
    value = `${num(prod, 0)} lb/MH`;
    const withinPlan = prod <= p + 1e-9;
    if (breakeven) {
      tone = withinPlan ? "default" : "bad";
      note = withinPlan ? "Below your planned pace" : "Above plan — underwater at your pace";
    } else {
      tone = withinPlan ? "good" : "warn";
      note = withinPlan ? "At or below your planned pace" : "Must beat your planned pace";
    }
  }
  const tones = {
    default: "border-line bg-white text-gunmetal",
    good: "border-good/30 bg-white text-good",
    warn: "border-warn/40 bg-white text-warn",
    bad: "border-bad/30 bg-white text-bad",
  };
  return (
    <div className={`rounded-md border p-3 ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-slate2/70">{label}</div>
      <div className="tnum mt-1.5 font-display text-2xl font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-slate2/70">{note}</div>
    </div>
  );
}

function FabricatorPicker({ value, onChange }) {
  const sel = Array.isArray(value) ? value : [];
  const toggle = (name) => {
    if (sel.includes(name)) onChange(sel.filter((x) => x !== name));
    else if (sel.length < 2) onChange([...sel, name]);
  };
  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate2">Fabricator</span>
      <div className="flex flex-wrap gap-2">
        {FABRICATORS.map((name) => {
          const on = sel.includes(name);
          const atMax = !on && sel.length >= 2;
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              disabled={atMax}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition active:translate-y-px ${
                on
                  ? "border-rebar bg-rebar text-white"
                  : atMax
                  ? "border-line bg-white text-slate2/40"
                  : "border-line bg-white text-gunmetal hover:border-rebar hover:text-rebar"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
      <span className="mt-1 block text-[11px] text-slate2/70">Pick up to two</span>
    </div>
  );
}

function SummaryRow({ k, val, strong, last }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-2.5 ${last ? "" : "border-b border-line"}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate2">{k}</span>
      <span className={`tnum text-right ${strong ? "font-display text-lg font-bold text-rebar" : "text-gunmetal"}`}>{val}</span>
    </div>
  );
}

// Percent fields: store as decimals (workbook style), edit as whole numbers.
const pctIn = (d) => (d === "" || d == null ? "" : Math.round(d * 1000) / 10);
const pctOut = (x) => (x === "" || x == null ? "" : Number(x) / 100);
