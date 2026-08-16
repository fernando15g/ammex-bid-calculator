/*
 * GET /api/project-types
 * -----------------------------------------------------------------------------
 * Returns the current option names of the Bid Tracker's "Project Type"
 * multi-select, read live from Notion, so the calculator's dropdown always
 * mirrors Notion. Read-only: retrieves the database schema, never writes.
 */

const NOTION_DB_API = "https://api.notion.com/v1/databases";
const NOTION_VERSION = "2022-06-28";

export async function GET() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    return Response.json(
      { ok: false, error: "Server is missing NOTION_TOKEN or NOTION_DATABASE_ID.", options: [] },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${NOTION_DB_API}/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
      // Notion schema changes rarely; let the platform cache briefly.
      next: { revalidate: 60 },
    });
    const data = await res.json();

    if (!res.ok) {
      return Response.json({ ok: false, error: data?.message || "Notion rejected the request.", options: [] }, { status: res.status });
    }

    const prop = data?.properties?.["Project Type"];
    if (!prop || prop.type !== "multi_select") {
      return Response.json({ ok: false, error: "Project Type is not a multi-select property.", options: [] }, { status: 200 });
    }

    const options = (prop.multi_select?.options || []).map((o) => o.name);
    return Response.json({ ok: true, options });
  } catch {
    return Response.json({ ok: false, error: "Could not reach Notion.", options: [] }, { status: 502 });
  }
}
