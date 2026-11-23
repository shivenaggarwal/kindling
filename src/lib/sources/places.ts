import { env } from "../config";
import { recordUsage } from "../log";

/** Google Places API (New) Text Search. Up to 20 per page, 60 per query. */

export type Place = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  types?: string[];
};

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.types",
  "nextPageToken",
].join(",");

export async function textSearch(
  query: string,
  ctx: { projectId: string; segmentId?: string | null },
  maxPages = 2,
): Promise<Place[]> {
  const out: Place[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": env.placesKey,
        "X-Goog-FieldMask": FIELDS,
      },
      body: JSON.stringify({ textQuery: query, pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Places ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { places?: Place[]; nextPageToken?: string };
    await recordUsage({
      projectId: ctx.projectId,
      segmentId: ctx.segmentId,
      provider: "places",
      operation: "searchText",
      units: 1,
      costUsd: env.cost.placesRequest,
      meta: { query },
    });
    out.push(...(data.places ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    // The next-page token takes a moment to become valid.
    await new Promise((r) => setTimeout(r, 1500));
  }
  return out.filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY");
}
