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
  const sens = useMemo(() => computeSensitivity(i), [i]);

  const marginTone = e.grossMargin >= i.targetMarginPct ? "good" : "bad";

  function copySummary() {
    const lines = [
      `AMMEX REBAR — BID SUMMARY`,
      v.projectName ? `Project: ${v.projectName}` : null,
      v.projectNumber ? `Project #: ${v.projectNumber}` : null,
      v.client ? `Client / GC: ${v.client}` : null,
      `Project type: ${v.projectType}`,
      ``,
      `Weight: ${num(i.weightLb)} lb (${num(e.weightTons, 2)} tons)`,
      `Productivity: ${num(i.outputLbPerMH)} lb/MH`,
      `Crew: ${num(i.crewSize)} @ ${num(i.hoursPerDay)} hrs/day`,
      `Labor hours: ${num(e.totalMH, 1)} MH (${num(e.crewDays, 1)} crew days)`,
      `Total cost: ${usd(e.totalCost)}`,
      ``,
      `RECOMMENDED BID: ${usd(e.bid)}`,
      `Bid rate: ${cents(e.bidCentsPerLb)}/lb  •  ${usd(e.bidPerTon)}/ton`,
      `Gross profit: ${usd(e.grossProfit)}`,
      `Gross margin: ${pct(e.grossMargin)}`,
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
            <div className="text-[10px] uppercase tracking-eyebrow text-white/50">Recommended bid</div>
            <div className="tnum font-display text-2xl font-bold leading-none text-rebarLite">{cents(e.bidCentsPerLb)}/lb</div>
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
            <Field label="Client / GC" type="text" value={v.client} onChange={set("client")} placeholder="General contractor" />
            <Field label="Project type" value={v.projectType} onChange={set("projectType")} options={PROJECT_TYPES} />
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
        <Section index={4} title="Recommended Bid" subtitle={`Priced to your ${pct(i.targetMarginPct, 0)} target gross margin.`}>
          {/* Hero */}
          <div className="border-b border-line bg-steel p-5 sm:p-6">
            <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <div className="eyebrow text-[10px] text-white/55">Recommended bid amount</div>
                <div className="tnum font-display text-5xl font-bold leading-none text-white sm:text-6xl">{usd(e.bid)}</div>
                <div className="mt-2 text-sm text-white/60">
                  {num(i.weightLb)} lb · {num(e.weightTons, 2)} tons · {num(e.totalMH, 1)} labor hrs
                </div>
              </div>
              <div className="dim-line w-full px-3 py-2 text-center sm:w-auto sm:min-w-[180px]">
                <div className="eyebrow text-[10px] text-rebarLite">Bid rate</div>
                <div className="tnum font-display text-4xl font-bold leading-none text-white">{cents(e.bidCentsPerLb)}</div>
                <div className="text-[11px] uppercase tracking-eyebrow text-white/45">per lb</div>
              </div>
            </div>
          </div>
          {/* Supporting metrics */}
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Bid rate / lb" value={usd(e.bidPerLb, 4)} />
            <StatCard label="Bid rate / ton" value={usd(e.bidPerTon)} />
            <StatCard label="Gross profit" value={usd(e.grossProfit)} tone="good" />
            <StatCard label="Gross margin" value={pct(e.grossMargin)} tone={marginTone} />
            <StatCard label="Revenue / labor hr" value={usd(e.revenuePerMH, 2)} sub="rate × productivity" />
            <StatCard label="Profit / labor hr" value={usd(e.profitPerMH, 2)} sub="less loaded rate" />
          </div>
        </Section>

        {/* 5 — REVERSE BID ANALYSIS */}
        <Section index={5} title="Reverse Bid Analysis" subtitle="Know the market rate? See the margin it implies against this job's cost.">
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[220px_1fr] lg:items-start">
            <div className="rounded-md border border-line bg-white p-3.5">
              <Field label="Market / target bid rate" value={v.marketCentsPerLb} onChange={set("marketCentsPerLb")} step="any" suffix="¢/lb" hint={`${usd(rev.inputPerLb, 4)}/lb · ${usd(rev.inputPerTon)}/ton`} />
              <div className={`mt-3 rounded px-3 py-2 text-center text-sm font-semibold ${rev.atOrAboveTarget ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
                {rev.atOrAboveTarget ? "At or above target" : "Below target — review price or productivity"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="Implied revenue" value={usd(rev.impliedBid)} />
              <StatCard label="Estimated cost" value={usd(e.totalCost)} />
              <StatCard label="Gross profit" value={usd(rev.impliedProfit)} tone={rev.impliedProfit >= 0 ? "good" : "bad"} />
              <StatCard label="Gross margin" value={pct(rev.impliedMargin)} tone={rev.atOrAboveTarget ? "good" : "bad"} />
              <StatCard label="Revenue / labor hr" value={usd(rev.revenuePerMH, 2)} />
              <StatCard label="Profit / labor hr" value={usd(rev.profitPerMH, 2)} />
            </div>
          </div>
        </Section>

        {/* 6 — SENSITIVITY ANALYSIS */}
        <Section index={6} title="Sensitivity Analysis" subtitle="How the bid moves as productivity changes. Your planned row is highlighted.">
          <div className="overflow-x-auto p-1 sm:p-2">
            <table className="tnum w-full min-w-[640px] border-collapse text-right text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-eyebrow text-slate2">
                  <th className="px-3 py-2 text-left font-semibold">lb/MH</th>
                  <th className="px-3 py-2 font-semibold">Field MH</th>
                  <th className="px-3 py-2 font-semibold">Total MH</th>
                  <th className="px-3 py-2 font-semibold">Total cost</th>
                  <th className="px-3 py-2 font-semibold">Bid</th>
                  <th className="px-3 py-2 font-semibold">¢/lb</th>
                  <th className="px-3 py-2 font-semibold">$/ton</th>
                  <th className="px-3 py-2 font-semibold">Gross profit</th>
                  <th className="px-3 py-2 font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody>
                {sens.map((r) => {
                  const planned = Number(r.out) === Number(i.outputLbPerMH);
                  return (
                    <tr key={r.out} className={`border-t border-line ${planned ? "bg-rebar/[0.08]" : ""}`}>
                      <td className={`px-3 py-2.5 text-left font-display font-semibold ${planned ? "text-rebar" : "text-gunmetal"}`}>
                        {num(r.out)}
                        {planned && <span className="ml-1.5 align-middle text-[9px] uppercase tracking-eyebrow text-rebar">Planned</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate2">{num(r.fieldMH, 1)}</td>
                      <td className="px-3 py-2.5 text-slate2">{num(r.totalMH, 1)}</td>
                      <td className="px-3 py-2.5">{usd(r.cost)}</td>
                      <td className="px-3 py-2.5 font-semibold">{usd(r.bid)}</td>
                      <td className="px-3 py-2.5">{cents(r.centsPerLb)}</td>
                      <td className="px-3 py-2.5">{usd(r.perTon)}</td>
                      <td className="px-3 py-2.5 text-good">{usd(r.profit)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.margin >= i.targetMarginPct ? "bg-good/[0.12] text-good" : "bg-warn/[0.12] text-warn"}`}>
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
            Cost uses the same compounding method as the headline estimate, so the planned-output row ties to the recommended bid.
          </p>
        </Section>

        {/* 7 — BID SUMMARY */}
        <Section index={7} title="Bid Summary">
          <div className="p-4">
            <div className="rounded-md border border-line bg-white">
              <SummaryRow k="Project" val={v.projectName || "—"} />
              {v.projectNumber && <SummaryRow k="Project #" val={v.projectNumber} />}
              {v.client && <SummaryRow k="Client / GC" val={v.client} />}
              <SummaryRow k="Type" val={v.projectType} />
              <SummaryRow k="Weight" val={`${num(i.weightLb)} lb · ${num(e.weightTons, 2)} tons`} />
              <SummaryRow k="Productivity" val={`${num(i.outputLbPerMH)} lb/MH`} />
              <SummaryRow k="Labor hours" val={`${num(e.totalMH, 1)} MH · ${num(e.crewDays, 1)} crew days`} />
              <SummaryRow k="Total cost" val={usd(e.totalCost)} />
              <SummaryRow k="Recommended bid" val={usd(e.bid)} strong />
              <SummaryRow k="Bid rate" val={`${cents(e.bidCentsPerLb)}/lb · ${usd(e.bidPerTon)}/ton`} />
              <SummaryRow k="Gross profit" val={usd(e.grossProfit)} />
              <SummaryRow k="Gross margin" val={pct(e.grossMargin)} last />
            </div>
            <button
              onClick={copySummary}
              className="mt-4 w-full rounded-md bg-rebar py-3 font-display font-semibold uppercase tracking-wide text-white transition hover:bg-rebarLite active:translate-y-px sm:w-auto sm:px-8"
            >
              {copied ? "Copied ✓" : "Copy to clipboard"}
            </button>
          </div>
        </Section>

        <footer className="mt-8 text-center text-[11px] text-slate2/60">
          Ammex Rebar Placers · Estimating assumptions are user-controlled · Calculator performs the math only
        </footer>
      </main>
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
