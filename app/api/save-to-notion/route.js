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
const LINE_ITEMS_DB = "3999aeba538380ae90b7f9f5da7365b9";
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
const boolProp = (b) => ({ checkbox: !!b });
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
  const wantDebug = (() => { try { return new URL(request.url).searchParams.get("debug") === "1"; } catch { return false; } })();
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
    gc, cityCounty, bidDueDate, submissionDate, fabricator, projectType,
    travelOn, hotelRooms, hotelNightlyRate, hotelNights, hotelTaxPct, hotelNightsBasis,
    fuelMiles, fuelTrips, fuelMPG, fuelPerGal, subsistenceRate, subsistenceInLabor,
    travelMarkupOn, travelMarkupPct, travelAddToBid, hotelCost, fuelCost, subsistenceCost, travelTotal, travelAddOnCents,
    // computed dollars/margin (from the active/rounded bid)
    operatingProfit, operatingMargin, fullyLoadedCost, burdenedLaborCost,
    // assumptions used on this bid
    burdenPct, toolsPct, contingencyPct, mobilizationHrs, targetMarginPct,
    // specialty scope
    rebarRevenue, specialtyRevenue, specialtyCost, specialtyHours, specialtyTypes, specialtyLineItems,
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
    "Submission Date": dateProp(submissionDate),
    // Out-of-town (travel) add-on
    "Travel On (calc)": boolProp(travelOn),
    "Hotel Rooms (calc)": numProp(hotelRooms),
    "Hotel Nightly Rate (calc)": numProp(hotelNightlyRate),
    "Hotel Nights (calc)": numProp(hotelNights),
    "Hotel Tax % (calc)": numProp(hotelTaxPct),
    "Hotel Nights Basis (calc)": numProp(hotelNightsBasis),
    "Fuel Miles (calc)": numProp(fuelMiles),
    "Fuel Trips (calc)": numProp(fuelTrips),
    "Fuel MPG (calc)": numProp(fuelMPG),
    "Fuel Per Gal (calc)": numProp(fuelPerGal),
    "Subsistence Rate (calc)": numProp(subsistenceRate),
    "Subsistence In Labor (calc)": boolProp(subsistenceInLabor),
    "Travel Markup On (calc)": boolProp(travelMarkupOn),
    "Travel Add To Bid (calc)": boolProp(travelAddToBid),
    "Travel Markup % (calc)": numProp(travelMarkupPct),
    "Hotel Cost (calc)": numProp(hotelCost),
    "Fuel Cost (calc)": numProp(fuelCost),
    "Subsistence Cost (calc)": numProp(subsistenceCost),
    "Travel Total (calc)": numProp(travelTotal),
    "Travel Add-On Cents (calc)": numProp(travelAddOnCents),
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

    // --- Write per-line specialty rows into the Line Items DB (for OS breakdown) ---
    // The bid page now exists (data.id); relate each line to it. Best-effort: a line
    // failure is reported but does not fail the whole save (the bid + aggregates are saved).
    let lineItemsWritten = 0;
    const lineItemErrors = [];
    if (Array.isArray(specialtyLineItems) && specialtyLineItems.length > 0 && data.id) {
      for (const li of specialtyLineItems) {
        const props = {
          "Description": { title: [{ text: { content: String(li.type || "") } }] },
          "Bid": { relation: [{ id: data.id }] },
          "Specialty Type": { select: { name: String(li.type) } },
          "Unit": { select: { name: String(li.unit) } },
          "Quantity": { number: Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0 },
          "Unit Price": { number: Number.isFinite(Number(li.unitPrice)) ? Number(li.unitPrice) : 0 },
          "Line Type": { select: { name: "Standard" } },
          "Status": { select: { name: "Proposed" } },
        };
        // Productivity is optional (blank for PT Bridge)
        if (li.productivity !== "" && li.productivity != null && Number.isFinite(Number(li.productivity))) {
          props["Productivity"] = { number: Number(li.productivity) };
        }
        try {
          const liRes = await fetch(NOTION_API, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "Notion-Version": NOTION_VERSION,
            },
            body: JSON.stringify({ parent: { database_id: LINE_ITEMS_DB }, properties: props }),
          });
          if (liRes.ok) lineItemsWritten += 1;
          else {
            const liErr = await liRes.json().catch(() => ({}));
            lineItemErrors.push(`${li.type}: ${liErr?.message || liRes.status}`);
          }
        } catch (e) {
          lineItemErrors.push(`${li.type}: request failed`);
        }
      }
    }

    return Response.json({
      ok: true, id: data.id, url: data.url,
      lineItemsWritten,
      ...(lineItemErrors.length ? { lineItemErrors } : {}),
      ...(wantDebug ? { _debug: {
        received: { gc: body?.gc, cityCounty: body?.cityCounty, fabricator: body?.fabricator, projectType: body?.projectType },
        sentGC: properties["GC"],
        sentCity: properties["City/County"],
        sentFab: properties["Fabricator"],
        sentType: properties["Project Type"],
        notionReturnedProps: Object.keys(data?.properties || {}),
      } } : {}),
    });
  } catch (err) {
    return Response.json({ ok: false, error: "Could not reach Notion. Check your connection and try again." }, { status: 502 });
  }
}
