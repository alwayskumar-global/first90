import type { PlaceCandidate } from "@/domain/types";

const API = "https://commons.wikimedia.org/w/api.php";
const UA = "First90/0.1 (Qloo hackathon demo; https://github.com/alwayskumar-global/first90)";
const STOP = new Set(["the", "and", "museum", "gallery", "center", "centre", "art", "history", "natural", "science", "of"]);

const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2);

export interface CommonsPage {
  title: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    mime?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * Choose a Commons file that is plainly of THIS venue: its title, object name or description must contain the venue's
 * distinctive name words. A file that is merely nearby is never used. Pure, so it is unit-tested.
 */
export function pickCommonsImage(venueName: string, pages: CommonsPage[]): { url: string; credit?: string; link?: string } | undefined {
  const all = words(venueName);
  const distinctive = all.filter((word) => !STOP.has(word));
  const need = distinctive.length > 0 ? distinctive : all;
  if (need.length === 0) return undefined;
  const required = Math.min(2, need.length);
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const url = info?.thumburl ?? info?.url;
    if (!info || !url || !/^image\/(jpeg|png|webp)$/.test(String(info.mime))) continue;
    if (!/^https:\/\/upload\.wikimedia\.org\//.test(url)) continue;
    const meta = info.extmetadata ?? {};
    const text = `${page.title} ${stripTags(meta["ObjectName"]?.value ?? "")} ${stripTags(meta["ImageDescription"]?.value ?? "")}`.toLowerCase();
    if (need.filter((word) => text.includes(word)).length < required) continue;
    const artist = stripTags(meta["Artist"]?.value ?? "");
    const licence = stripTags(meta["LicenseShortName"]?.value ?? "");
    const credit = [artist && artist.length <= 80 ? artist : "", licence].filter(Boolean).join(", ");
    const link = info.descriptionurl && /^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl) ? info.descriptionurl : undefined;
    return { url, ...(credit ? { credit: credit.slice(0, 160) } : {}), ...(link ? { link } : {}) };
  }
  return undefined;
}

/** Wikimedia Commons files within 150 m of the venue, then the one (if any) that names it. */
export async function findCommonsImage(
  candidate: Pick<PlaceCandidate, "name" | "location">,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<{ url: string; credit?: string; link?: string } | undefined> {
  const call = async (params: Record<string, string>) => {
    const response = await fetchImpl(`${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`commons ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  };
  const geo = (await call({
    action: "query", list: "geosearch", gsnamespace: "6", gsradius: "150", gslimit: "10",
    gscoord: `${candidate.location.lat}|${candidate.location.lon}`,
  })) as { query?: { geosearch?: { title: string }[] } };
  const titles = (geo.query?.geosearch ?? []).map((entry) => entry.title).slice(0, 10);
  if (titles.length === 0) return undefined;
  const info = (await call({
    action: "query", prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "800", titles: titles.join("|"),
  })) as { query?: { pages?: Record<string, CommonsPage> } };
  return pickCommonsImage(candidate.name, Object.values(info.query?.pages ?? {}));
}
