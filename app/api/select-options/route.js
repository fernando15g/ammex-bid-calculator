/*
 * GET /api/select-options?prop=<Exact Property Name>
 * -----------------------------------------------------------------------------
 * Returns the current option names of a Bid Tracker multi-select property, read
 * live from Notion, so calculator dropdowns always mirror Notion. Read-only.
 * Used for "Project Type" and "GC".
 */

const NOTION_DB_API = "https://api.notion.com/v1/databases";
const NOTION_VERSION = "2022-06-28";
const ALLOWED = ["Project Type", "GC"]; // only these may be queried

export async function GET(request) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  const { searchParams } = new URL(request.url);
  const propName = searchParams.get("prop") || "";

  if (!ALLOWED.includes(propName)) {
    return Response.json({ ok: false, error: "Unknown property.", options: [] }, { status: 400 });
  }
  if (!token || !databaseId) {
    return Response.json({ ok: false, error: "Server is missing NOTION_TOKEN or NOTION_DATABASE_ID.", options: [] }, { status: 500 });
  }

  try {
    const res = await fetch(`${NOTION_DB_API}/${databaseId}`, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
      next: { revalidate: 60 }, // schema changes rarely; cache briefly
    });
    const data = await res.json();

    if (!res.ok) {
      return Response.json({ ok: false, error: data?.message || "Notion rejected the request.", options: [] }, { status: res.status });
    }

    const prop = data?.properties?.[propName];
    if (!prop || prop.type !== "multi_select") {
      return Response.json({ ok: false, error: `${propName} is not a multi-select property.`, options: [] }, { status: 200 });
    }

    const options = (prop.multi_select?.options || []).map((o) => o.name);
    return Response.json({ ok: true, options });
  } catch {
    return Response.json({ ok: false, error: "Could not reach Notion.", options: [] }, { status: 502 });
  }
}
