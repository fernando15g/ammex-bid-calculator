"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  SPECIALTY_TYPES,
  newSpecialtyLine,
  computeSpecialtyRollup,
} from "@/lib/calc";
import { usd, num, pct, cents } from "@/lib/format";

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
      client: [],
      cityCounty: "",
      bidDueDate: "",
      fabricator: [],
      projectType: "Other",
      notes: "",
      weightLb: "",
      outputLbPerMH: "",
      specialtyLines: [],
    }));
    setBidOverride("");
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

  // Specialty scope rollup (labor-only). Rebar side comes from the active bid.
  const sp = useMemo(
    () => computeSpecialtyRollup(v.specialtyOn ? v.specialtyLines : [], i,
      { revenue: d.bid, cost: e.totalCost, hours: e.totalMH }),
    [v.specialtyOn, v.specialtyLines, i, d.bid, e.totalCost, e.totalMH]
  );
  const hasSpecialty = v.specialtyOn && v.specialtyLines.length > 0;

  const toggleLine = (t) => setV((s) => {
    const has = s.specialtyLines.some((l) => l.type === t);
    return {
      ...s,
      specialtyLines: has
        ? s.specialtyLines.filter((l) => l.type !== t)
        : [...s.specialtyLines, newSpecialtyLine(t)],
    };
  });
  const removeLine = (id) => setV((s) => ({ ...s, specialtyLines: s.specialtyLines.filter((l) => l.id !== id) }));
  const updLine = (id, patch) => setV((s) => ({
    ...s, specialtyLines: s.specialtyLines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }));

  const marginTone = d.grossMargin >= i.targetMarginPct ? "good" : "bad";

  // Save the bid's raw inputs as a new row in the Notion Bid Tracker.
  const [notionStatus, setNotionStatus] = useState("idle"); // idle | saving | saved | error
  const [notionMsg, setNotionMsg] = useState("");

  // Live option lists, pulled from Notion so the dropdowns always match.
  const [projectTypeOptions, setProjectTypeOptions] = useState(null); // null = loading
  const [gcOptions, setGcOptions] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = (prop, set) =>
      fetch(`/api/select-options?prop=${encodeURIComponent(prop)}`)
        .then((r) => r.json())
        .then((d) => { if (alive) set(d.ok ? d.options : []); })
        .catch(() => { if (alive) set([]); });
    load("Project Type", setProjectTypeOptions);
    load("GC", setGcOptions);
    return () => { alive = false; };
  }, []);

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
          gc: Array.isArray(v.client) ? v.client : (v.client ? [v.client] : []),
          cityCounty: v.cityCounty,
          bidDueDate: v.bidDueDate,
          fabricator: v.fabricator,
          projectType: v.projectType,
          notes: v.notes,
          // computed from the active bid (what you actually see/save)
          operatingProfit: Number(sp.totalProfit.toFixed(2)),
          operatingMargin: Number(sp.totalMargin.toFixed(4)), // ratio, combined
          fullyLoadedCost: Number(sp.totalCost.toFixed(2)),
          burdenedLaborCost: Number(e.directLabor.toFixed(2)),
          rebarRevenue: Number(d.bid.toFixed(2)),
          specialtyRevenue: Number(sp.specRevenue.toFixed(2)),
          specialtyCost: Number(sp.specCost.toFixed(2)),
          specialtyHours: Number(sp.specHours.toFixed(2)),
          specialtyTypes: hasSpecialty ? [...new Set(v.specialtyLines.map((l) => l.type))] : [],
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
      (Array.isArray(v.client) ? v.client.length : v.client) ? `GC: ${Array.isArray(v.client) ? v.client.join(", ") : v.client}` : null,
      v.fabricator && v.fabricator.length ? `Fabricator: ${v.fabricator.join(", ")}` : null,
      v.cityCounty ? `City/County: ${v.cityCounty}` : null,
      v.bidDueDate ? `Bid due: ${v.bidDueDate}` : null,
      `Project type: ${v.projectType}`,
      ``,
      `Weight: ${num(i.weightLb)} lb (${num(e.weightTons, 2)} tons)`,
      `Productivity: ${num(i.outputLbPerMH)} lb/MH`,
      `Crew: ${num(i.crewSize)} @ ${num(i.hoursPerDay)} hrs/day`,
      `Labor hours: ${num(e.totalMH, 1)} MH (${num(e.crewDays, 1)} crew days)`,
      `Fully-loaded cost: ${usd(e.totalCost)}`,
      ``,
      `FINAL BID: ${usd(d.bid)}`,
      `Bid rate: ${cents(activeCents)}/lb  •  ${usd(d.perTon)}/ton`,
      `Operating profit: ${usd(d.grossProfit)}`,
      `Operating margin: ${pct(d.grossMargin)}`,
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
            <SearchSelect label="GC" value={v.client} onChange={set("client")} options={gcOptions} multi placeholder="Select GC(s)" addLabel="+ Add new GC" />
            <Field label="City / County" type="text" value={v.cityCounty} onChange={set("cityCounty")} placeholder="e.g. Maricopa County" />
            <Field label="Bid due date" type="date" value={v.bidDueDate} onChange={set("bidDueDate")} />
            <SearchSelect label="Project type" value={v.projectType} onChange={set("projectType")} options={projectTypeOptions} placeholder="Select a type" addLabel="+ Add new type" />
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
              label="Burden, Field & Company Overhead %"
              value={pctIn(v.burdenPct)}
              onChange={(x) => set("burdenPct")(pctOut(x))}
              step="any"
              suffix="%"
              hint="Payroll tax, comp, insurance, tools/vehicle allocation, misc field OH"
            />
            <Field label="Small tools / consumables %" value={pctIn(v.toolsPct)} onChange={(x) => set("toolsPct")(pctOut(x))} step="any" suffix="%" />
            <Field label="Contingency %" value={pctIn(v.contingencyPct)} onChange={(x) => set("contingencyPct")(pctOut(x))} step="any" suffix="%" />
            <Field label="Target margin %" value={pctIn(v.targetMarginPct)} onChange={(x) => set("targetMarginPct")(pctOut(x))} step="any" suffix="%" />
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

        {/* 3 — SPECIALTY SCOPE */}
        <Section index={3} title="Specialty Scope" subtitle="PT and mesh, priced labor-only on the same cost stack as rebar. Material is not included here.">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={!!v.specialtyOn}
                onChange={(ev) => set("specialtyOn")(ev.target.checked)}
                className="h-4 w-4 accent-rebar"
              />
              <span className="text-sm font-semibold text-gunmetal">Add specialty scope to this bid</span>
            </label>
            {v.specialtyOn && (
              <div className="flex flex-wrap gap-1.5">
                {SPECIALTY_TYPES.map((t) => {
                  const on = v.specialtyLines.some((l) => l.type === t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleLine(t)}
                      className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition active:translate-y-px ${
                        on
                          ? "border-rebar bg-rebar text-white"
                          : "border-line bg-white text-slate2 hover:border-rebar hover:text-rebar"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {v.specialtyOn && (
            <div className="border-t border-line p-4">
              {v.specialtyLines.length === 0 ? (
                <p className="text-sm text-slate2/70">Add a line above to price PT or mesh alongside the rebar.</p>
              ) : (
                <div className="space-y-3">
                  {v.specialtyLines.map((l) => {
                    const r = sp.rows.find((x) => x.id === l.id) || {};
                    return (
                      <div key={l.id} className="rounded-md border border-line bg-white p-3.5">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="rounded bg-rebar/[0.10] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-rebar">{l.type}</span>
                          <button type="button" onClick={() => removeLine(l.id)} className="text-[11px] font-semibold uppercase tracking-wide text-slate2/50 hover:text-bad">Remove</button>
                        </div>

                        <div
                          className={`grid gap-3 ${
                            l.type === "PT Bridge"
                              ? "grid-cols-1 sm:grid-cols-2"
                              : l.type === "Mesh"
                              ? "grid-cols-2 sm:grid-cols-3"
                              : "grid-cols-2 sm:grid-cols-4"
                          }`}
                        >
                          {l.type === "PT Building" && (
                            <>
                              <Field label="Tons" value={l.tons} step="any" suffix="tn"
                                onChange={(x) => updLine(l.id, { tons: x, lbs: x === "" ? "" : Number(x) * 2000 })} />
                              <Field label="Pounds" value={l.lbs} step="any" suffix="lb"
                                onChange={(x) => updLine(l.id, { lbs: x, tons: x === "" ? "" : Number(x) / 2000 })} />
                              <Field label="Productivity" value={l.prodLbPerMH} step="any" suffix="lb/MH"
                                onChange={(x) => updLine(l.id, { prodLbPerMH: x })} />
                              <Field label="Your rate" value={l.rateCentsPerLb} step="any" suffix="¢/lb"
                                placeholder={r.recommendedRate ? r.recommendedRate.toFixed(2) : ""}
                                hint={r.recommendedRate ? `Recommended ${cents(r.recommendedRate)}/lb` : "Enter productivity for a recommendation"}
                                onChange={(x) => updLine(l.id, { rateCentsPerLb: x })} />
                            </>
                          )}
                          {l.type === "PT Bridge" && (
                            <>
                              <Field label="Hours (from fabricator)" value={l.hours} step="any" suffix="hrs"
                                onChange={(x) => updLine(l.id, { hours: x })} />
                              <Field label="Your rate" value={l.ratePerHour} step="any" prefix="$" suffix="/hr"
                                placeholder={r.recommendedRate ? r.recommendedRate.toFixed(2) : ""}
                                hint={r.recommendedRate ? `Recommended ${usd(r.recommendedRate, 2)}/hr` : ""}
                                onChange={(x) => updLine(l.id, { ratePerHour: x })} />
                              <Field label="Feet (optional)" value={l.feet} step="any" suffix="ft"
                                hint="For cross-checking only"
                                onChange={(x) => updLine(l.id, { feet: x })} />
                              <Field label="Productivity (optional)" value={l.prodFtPerMH} step="any" suffix="ft/MH"
                                hint="Fill in once you know your rate"
                                onChange={(x) => updLine(l.id, { prodFtPerMH: x })} />
                            </>
                          )}
                          {l.type === "Mesh" && (
                            <>
                              <Field label="Square feet" value={l.sqft} step="any" suffix="sqft"
                                onChange={(x) => updLine(l.id, { sqft: x })} />
                              <Field label="Productivity (optional)" value={l.prodSqftPerMH} step="any" suffix="sqft/MH"
                                hint="Blank = revenue only, no cost basis"
                                onChange={(x) => updLine(l.id, { prodSqftPerMH: x })} />
                              <Field label="Your rate" value={l.rateCentsPerSqft} step="any" suffix="¢/sqft"
                                placeholder={r.recommendedRate ? r.recommendedRate.toFixed(2) : ""}
                                hint={r.recommendedRate ? `Recommended ${cents(r.recommendedRate)}/sqft` : "Enter productivity for a recommendation"}
                                onChange={(x) => updLine(l.id, { rateCentsPerSqft: x })} />
                            </>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-2.5 text-[11px] text-slate2">
                          <span className="tnum">{r.qtyLabel}</span>
                          {r.hasCostBasis ? (
                            <>
                              <span className="tnum">{num(r.hours, 1)} MH</span>
                              {r.impliedHours != null && (
                                <span className={`tnum ${r.impliedHours < r.hours ? "text-good" : "text-warn"}`}>
                                  your pace ≈ {num(r.impliedHours, 1)} MH
                                </span>
                              )}
                              <span className="tnum">cost {usd(r.cost)}</span>
                              <span className="tnum">revenue {usd(r.revenue)}</span>
                              <span className={`tnum font-semibold ${r.margin >= i.targetMarginPct ? "text-good" : "text-warn"}`}>
                                {pct(r.margin)} margin
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="tnum">revenue {usd(r.revenue)}</span>
                              <span className="font-semibold text-warn">▲ no cost basis — add productivity</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Rebar vs specialty vs combined */}
              {v.specialtyLines.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-md border border-line bg-white">
                  <table className="tnum w-full min-w-[420px] border-collapse text-right text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-eyebrow text-slate2">
                        <th className="px-3 py-2 text-left font-semibold">Scope</th>
                        <th className="px-3 py-2 font-semibold">Hours</th>
                        <th className="px-3 py-2 font-semibold">Cost</th>
                        <th className="px-3 py-2 font-semibold">Revenue</th>
                        <th className="px-3 py-2 font-semibold">Op. profit</th>
                        <th className="px-3 py-2 font-semibold">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-line">
                        <td className="px-3 py-2.5 text-left font-semibold text-gunmetal">Rebar</td>
                        <td className="px-3 py-2.5 text-slate2">{num(e.totalMH, 1)}</td>
                        <td className="px-3 py-2.5">{usd(e.totalCost)}</td>
                        <td className="px-3 py-2.5">{usd(d.bid)}</td>
                        <td className="px-3 py-2.5">{usd(d.grossProfit)}</td>
                        <td className="px-3 py-2.5">{pct(d.grossMargin)}</td>
                      </tr>
                      <tr className="border-t border-line">
                        <td className="px-3 py-2.5 text-left font-semibold text-gunmetal">Specialty</td>
                        <td className="px-3 py-2.5 text-slate2">{num(sp.specHours, 1)}</td>
                        <td className="px-3 py-2.5">{usd(sp.specCost)}</td>
                        <td className="px-3 py-2.5">{usd(sp.specRevenue)}</td>
                        <td className="px-3 py-2.5">{usd(sp.specProfit)}</td>
                        <td className="px-3 py-2.5">{sp.specRevenue > 0 ? pct(sp.specMargin) : "—"}</td>
                      </tr>
                      <tr className="border-t-2 border-gunmetal/20 bg-rebar/[0.06]">
                        <td className="px-3 py-2.5 text-left font-display font-semibold text-rebar">Combined</td>
                        <td className="px-3 py-2.5 font-semibold">{num(sp.totalHours, 1)}</td>
                        <td className="px-3 py-2.5 font-semibold">{usd(sp.totalCost)}</td>
                        <td className="px-3 py-2.5 font-semibold">{usd(sp.totalRevenue)}</td>
                        <td className="px-3 py-2.5 font-semibold">{usd(sp.totalProfit)}</td>
                        <td className={`px-3 py-2.5 font-semibold ${sp.totalMargin >= i.targetMarginPct ? "text-good" : "text-warn"}`}>
                          {pct(sp.totalMargin)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {sp.missingBasis > 0 && (
                    <p className="border-t border-line px-3 py-2 text-[11px] text-warn">
                      ▲ {sp.missingBasis} line{sp.missingBasis > 1 ? "s" : ""} booking revenue with no cost basis — combined margin is overstated until productivity is entered.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* 4 — COST BREAKDOWN */}
        <Section index={4} title="Cost Breakdown">
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Weight" value={`${num(i.weightLb)} lb`} sub={`${num(e.weightTons, 2)} tons`} />
            <StatCard label="Field man-hours" value={num(e.fieldMH, 1)} sub="weight ÷ productivity" />
            <StatCard label="Total man-hours" value={num(e.totalMH, 1)} sub="incl. mobilization" />
            <StatCard label="Crew days" value={num(e.crewDays, 1)} sub={`${num(i.crewSize)} × ${num(i.hoursPerDay)} hrs`} />
            <StatCard label="Loaded labor rate" value={usd(e.loadedRate, 2)} sub="wage + burden" />
            <StatCard label="Burdened labor cost" value={usd(e.directLabor)} />
            <StatCard label="Tools / consumables" value={usd(e.tools)} />
            <StatCard label="Contingency" value={usd(e.contingency)} />
            <StatCard label="Fully-loaded cost" value={usd(e.totalCost)} tone="dark" />
            <StatCard label="Breakeven / ton" value={usd(e.breakevenPerTon)} />
          </div>
        </Section>

        {/* 5 — RECOMMENDED BID RESULTS */}
        <Section index={5} title="Recommended Bid" subtitle={`Priced to your ${pct(i.targetMarginPct, 0)} target margin, then rounded to the nearest quarter-cent.`}>
          {/* Hero */}
          <div className="border-b border-line bg-steel p-5 sm:p-6">
            <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <div className="eyebrow text-[10px] text-white/55">{bidOverridden ? "Final bid (override)" : "Recommended bid"}</div>
                <div className="tnum font-display text-5xl font-bold leading-none text-white sm:text-6xl">{usd(d.bid)}</div>
                <div className="mt-1 text-[11px] italic text-white/40">also known as Contract Value</div>
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
            <StatCard label="Operating profit" value={usd(d.grossProfit)} sub="after costs & overhead, pre-tax" tone={d.grossProfit >= 0 ? "good" : "bad"} />
            <StatCard label="Operating margin" value={pct(d.grossMargin)} tone={marginTone} />
            <StatCard label="Revenue / labor hr" value={usd(d.revenuePerMH, 2)} sub="rate × productivity" />
            <StatCard label="Profit / labor hr" value={usd(d.profitPerMH, 2)} sub="less loaded rate" />
          </div>
        </Section>

        {/* 6 — REVERSE BID ANALYSIS */}
        <Section index={6} title="Reverse Bid Analysis" subtitle="Enter a market bid rate to see the margin it implies — and the productivity your crew would need to hit at that price.">
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
                <StatCard label="Operating profit" value={usd(rev.impliedProfit)} tone={rev.impliedProfit >= 0 ? "good" : "bad"} />
                <StatCard label="Operating margin" value={pct(rev.impliedMargin)} tone={rev.atOrAboveTarget ? "good" : "bad"} />
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

        {/* 7 — SENSITIVITY ANALYSIS */}
        <Section index={7} title="Sensitivity Analysis" subtitle="Centered on your Section 2 productivity, ±5 rows. Holds your bid fixed and shows how margin moves as production runs faster or slower. Your planned row is highlighted.">
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
                  <th className="px-3 py-2 font-semibold">Fully-loaded cost</th>
                  <th className="px-3 py-2 font-semibold">Operating profit</th>
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
            Bid price is held fixed across every row, so margin and operating profit show what you'd actually earn at each productivity level. Green meets or beats your {pct(i.targetMarginPct, 0)} target; amber falls below. Cost uses the same compounding method as the headline estimate.
          </p>
        </Section>

        {/* 8 — BID SUMMARY */}
        <Section index={8} title="Bid Summary">
          <div className="p-4">
            <div className="rounded-md border border-line bg-white">
              <SummaryRow k="Project" val={v.projectName || "—"} />
              {(Array.isArray(v.client) ? v.client.length > 0 : !!v.client) && <SummaryRow k="GC" val={Array.isArray(v.client) ? v.client.join(", ") : v.client} />}
              {v.fabricator && v.fabricator.length > 0 && <SummaryRow k="Fabricator" val={v.fabricator.join(", ")} />}
              {v.cityCounty && <SummaryRow k="City / County" val={v.cityCounty} />}
              {v.bidDueDate && <SummaryRow k="Bid due" val={v.bidDueDate} />}
              <SummaryRow k="Type" val={v.projectType} />
              <SummaryRow k="Weight" val={`${num(i.weightLb)} lb · ${num(e.weightTons, 2)} tons`} />
              <SummaryRow k="Productivity" val={`${num(i.outputLbPerMH)} lb/MH`} />
              <SummaryRow k="Labor hours" val={`${num(e.totalMH, 1)} MH · ${num(e.crewDays, 1)} crew days`} />
              <SummaryRow k="Fully-loaded cost" val={usd(e.totalCost)} />
              <SummaryRow k={bidOverridden ? "Final bid" : "Recommended bid"} val={usd(d.bid)} strong />
              <SummaryRow k="Bid rate" val={`${cents(activeCents)}/lb · ${usd(d.perTon)}/ton`} />
              <SummaryRow k="Operating profit" val={usd(d.grossProfit)} />
              <SummaryRow k="Operating margin" val={pct(d.grossMargin)} last />
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

function SearchSelect({ label, value, onChange, options, multi = false, placeholder = "Select", addLabel = "+ Add new" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const boxRef = useRef(null);

  const loading = options === null;
  const list = Array.isArray(options) ? options : [];
  const selected = multi ? (Array.isArray(value) ? value : value ? [value] : []) : value ? [value] : [];
  // ensure current selections always show even if not (yet) in Notion's list
  const full = [...new Set([...selected, ...list])];
  const filtered = full.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setAdding(false); setQ(""); } };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const close = () => { setOpen(false); setAdding(false); setQ(""); };
  const pick = (o) => {
    if (multi) {
      const has = selected.includes(o);
      if (has) {
        onChange(selected.filter((x) => x !== o)); // deselect: keep open
      } else {
        onChange([...selected, o]); close(); // add: close (reopen to add another)
      }
    } else {
      onChange(o); close();
    }
  };
  const commitNew = () => {
    const t = draft.trim();
    if (t) onChange(multi ? [...selected, t] : t);
    setDraft(""); close();
  };

  const summary = selected.length === 0 ? "" : multi ? selected.join(", ") : selected[0];

  return (
    <div className="block" ref={boxRef}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate2">{label}</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => !loading && setOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-md border border-line bg-white px-3 py-2.5 text-left text-[15px] text-gunmetal outline-none focus:border-rebar focus:ring-2 focus:ring-rebar/20"
        >
          <span className={summary ? "" : "text-slate2/50"}>{loading ? "Loading…" : summary || placeholder}</span>
          <span className="text-slate2">▾</span>
        </button>

        {open && !loading && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-line bg-white shadow-lg">
            <div className="border-b border-line p-2">
              <input
                autoFocus
                className="w-full rounded border border-line px-2.5 py-1.5 text-sm outline-none focus:border-rebar"
                placeholder="Search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 && !adding && (
                <div className="px-3 py-2 text-sm text-slate2/60">No matches</div>
              )}
              {filtered.map((o) => {
                const on = selected.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => pick(o)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper ${on ? "text-rebar font-semibold" : "text-gunmetal"}`}
                  >
                    <span>{o}</span>
                    {on && <span>✓</span>}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-line p-2">
              {adding ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    className="w-full rounded border border-line px-2.5 py-1.5 text-sm outline-none focus:border-rebar"
                    placeholder="New name"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitNew(); if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
                  />
                  <button type="button" onClick={commitNew} className="rounded bg-rebar px-3 text-[11px] font-semibold uppercase tracking-wide text-white">Add</button>
                </div>
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="w-full rounded px-2 py-1.5 text-left text-[13px] font-semibold text-rebar hover:bg-paper">
                  {addLabel}
                </button>
              )}
            </div>

          </div>
        )}
      </div>
      <span className="mt-1 block text-[11px] text-slate2/70">
        {loading ? "Pulling options from Notion…" : "Pulled live from Notion · search or add new"}
      </span>
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
