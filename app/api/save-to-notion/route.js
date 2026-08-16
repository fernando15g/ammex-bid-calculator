/*
 * Server-side route: POST /api/save-to-notion
 * -----------------------------------------------------------------------------
 * Creates one new row in the existing Notion Bid Tracker database.
 * Runs only on the server (Vercel), so the Notion secret is never exposed to the
 * browser. Reads two environment variables:
 *   NOTION_TOKEN        - Internal Integration Secret from notion.so/my-integrations
 *   NOTION_DATABASE_ID  - the Bid Tracker database ID
 *
 * Only the raw inputs are written; all other columns are left for the user to
 * fill or for Notion's own formulas to compute.
 */

const NOTION_API = "https://api.notion.com/v1/pages";
const NOTION_VERSION = "2022-06-28";

// Helpers to shape values into Notion's property format.
const titleProp = (s) => ({ title: [{ text: { content: String(s || "") } }] });
const textProp = (s) =>
  String(s || "").trim() === "" ? { rich_text: [] } : { rich_text: [{ text: { content: String(s) } }] };
const numProp = (n) => {
  const v = Number(n);
  return { number: isFinite(v) ? v : null };
};
// Notion date wants ISO (YYYY-MM-DD from the date input); empty -> cleared.
const dateProp = (s) => {
  const v = String(s || "").trim();
  return { date: v ? { start: v } : null };
};
// Notion multi-select wants a list of { name }; reuses existing tags by name.
const multiProp = (arr) => {
  const flat = (Array.isArray(arr) ? arr : [arr]).flat(Infinity);
  return {
    multi_select: flat
      .filter(Boolean)
      // Notion forbids commas in multi-select option names — strip to avoid 400s.
      .map((name) => ({ name: String(name).replace(/,/g, " ").trim() }))
      .filter((o) => o.name !== ""),
  };
};

export async function POST(request) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    return Response.json(
      { ok: false, error: "Server is missing NOTION_TOKEN or NOTION_DATABASE_ID. Add them in Vercel → Settings → Environment Variables." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const {
    projectName, estimatedLbs, lbsPerMH, crewSize, laborRate, bidRatePerLb, notes,
    gc, cityCounty, bidDueDate, fabricator, projectType,
    // computed dollars/margin (from the active/rounded bid)
    operatingProfit, operatingMargin, fullyLoadedCost, burdenedLaborCost,
    // assumptions used on this bid
    burdenPct, toolsPct, contingencyPct, mobilizationHrs, targetMarginPct,
    // specialty scope
    rebarRevenue, specialtyRevenue, specialtyCost, specialtyHours, specialtyTypes,
  } = body || {};

  if (!projectName || String(projectName).trim() === "") {
    return Response.json({ ok: false, error: "Enter a Project Name before saving to Notion." }, { status: 400 });
  }

  // Map calculator outputs -> exact Notion property names (character-for-character).
  const properties = {
    "Project Name": titleProp(projectName),
    "Estimated LBS": numProp(estimatedLbs),
    "Estimated LBS/MH": numProp(lbsPerMH),
    "Estimated Crew Size": numProp(crewSize),
    "Base Wage Rate": numProp(laborRate),
    "Bid Rate ($/LB)": numProp(bidRatePerLb),
    "GC": multiProp(gc),
    "City/County": textProp(cityCounty),
    "Bid Due Date": dateProp(bidDueDate),
    "Fabricator": multiProp(fabricator),
    "Project Type": multiProp(projectType ? [projectType] : []),
    "Notes": textProp(notes),
    // Authoritative computed values from this bid (Number columns)
    "Operating Profit (calc)": numProp(operatingProfit),
    "Operating Margin (calc)": numProp(operatingMargin), // ratio; column formatted as Percent
    "Fully-Loaded Cost (calc)": numProp(fullyLoadedCost),
    "Burdened Labor Cost (calc)": numProp(burdenedLaborCost),
    // Assumptions used on this bid (percent columns store ratios; format as Percent)
    "Burden/OH % (calc)": numProp(burdenPct),
    "Tools % (calc)": numProp(toolsPct),
    "Contingency % (calc)": numProp(contingencyPct),
    "Mobilization Hrs (calc)": numProp(mobilizationHrs),
    "Target Margin % (calc)": numProp(targetMarginPct),
    // Specialty scope (labor-only)
    "Rebar Revenue (calc)": numProp(rebarRevenue),
    "Specialty Revenue (calc)": numProp(specialtyRevenue),
    "Specialty Cost (calc)": numProp(specialtyCost),
    "Specialty Hours (calc)": numProp(specialtyHours),
    "Specialty Type": multiProp(specialtyTypes),
  };

  try {
    const res = await fetch(NOTION_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    });

    const data = await res.json();

    if (!res.ok) {
      // Surface Notion's own message so property-name mismatches are easy to spot.
      return Response.json(
        { ok: false, error: data?.message || "Notion rejected the request.", code: data?.code },
        { status: res.status }
      );
    }

    return Response.json({ ok: true, id: data.id, url: data.url });
  } catch (err) {
    return Response.json({ ok: false, error: "Could not reach Notion. Check your connection and try again." }, { status: 502 });
  }
}
