import type { ImageSource, PlaceCandidate, PlanItem, PlanSession } from "@/domain/types";
import { createTtlCache } from "@/lib/qloo/cache";
import { findCommonsImage } from "./commons";
import { safeFetch, type HostLookup } from "./guard";
import { extractPageImage, readHead } from "./html";

/**
 * The image waterfall (CR-010), server side only:
 *   1. the image URL Qloo returned for the place, if it really serves an image;
 *   2. the venue's own page preview image (`og:image` / `twitter:image`), fetched only from the website Qloo returned;
 *      for museums, a Wikimedia Commons file that names the venue;
 *   3. nothing: the card keeps the category tile.
 * A URL is kept only after the server has seen it answer with an image. Nothing is ever a stock photo.
 */
export interface ResolvedImage {
  imageUrl: string;
  imageSource: ImageSource;
  imageCredit?: string;
  imageLink?: string;
}

export interface ImageResolver {
  resolve(candidate: PlaceCandidate): Promise<ResolvedImage | undefined>;
  /** Fill in (or clear) images for every plan item, within a time budget, before the session is signed. */
  attach(session: PlanSession): Promise<void>;
}

export interface ImageResolverOptions {
  /** Check that URLs answer with an image, and try tiers 2 and 3. Off only in the end-to-end tests. */
  verify?: boolean;
  /** Tests only: allow the local mock server. */
  allowLoopback?: boolean;
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  /** Whole-attach time budget; items still unresolved when it ends simply keep the tile. */
  budgetMs?: number;
  now?: () => number;
}

const UA = "First90/0.1 (Qloo hackathon demo; https://github.com/alwayskumar-global/first90)";
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)\b/i;
const MAX_IMAGE_BYTES = 5_000_000;
function clearImage(target: PlanItem | PlaceCandidate): void {
  delete target.imageUrl;
  delete target.imageSource;
  delete target.imageCredit;
  delete target.imageLink;
}

const SHORT_NAP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isHttps = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= 600;
  } catch {
    return false;
  }
};

export function createImageResolver(options: ImageResolverOptions = {}): ImageResolver {
  const { verify = true, allowLoopback = false, fetchImpl, lookup, budgetMs = 4_000, now } = options;
  const found = createTtlCache({ ttlMs: 60 * 60_000, maxEntries: 400, ...(now ? { now } : {}) });
  const missed = createTtlCache({ ttlMs: 10 * 60_000, maxEntries: 400, ...(now ? { now } : {}) });
  const guard = { ...(fetchImpl ? { fetchImpl } : {}), ...(lookup ? { lookup } : {}), allowLoopback };

  /** Does this URL answer with an actual, reasonably small image? Headers only; the body is dropped. */
  async function servesImage(url: string): Promise<boolean> {
    try {
      const response = await safeFetch(url, { headers: { "user-agent": UA, accept: "image/*" } }, { ...guard, timeoutMs: 2_000 });
      await response.body?.cancel().catch(() => undefined);
      const length = Number(response.headers.get("content-length") ?? 0);
      return response.status === 200 && IMAGE_TYPES.test(response.headers.get("content-type") ?? "") && !(length > MAX_IMAGE_BYTES);
    } catch {
      return false;
    }
  }

  /** The venue page's own preview image. Fetches only the website URL Qloo returned. */
  async function pageImage(website: string): Promise<string | undefined> {
    try {
      const response = await safeFetch(website, { headers: { "user-agent": UA, accept: "text/html" } }, { ...guard, timeoutMs: 1_500 });
      if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const image = extractPageImage(await readHead(response), response.url || website);
      return isHttps(image) ? image : undefined;
    } catch {
      return undefined;
    }
  }

  async function resolveUncached(candidate: PlaceCandidate): Promise<ResolvedImage | undefined> {
    // Tier 1: Qloo's image.
    if (isHttps(candidate.imageUrl) && (!verify || (await servesImage(candidate.imageUrl)))) {
      return { imageUrl: candidate.imageUrl, imageSource: "qloo" };
    }
    if (!verify) return undefined; // no network in this mode: nothing else to try
    // Tier 2a: the venue website's preview image.
    if (candidate.website) {
      const image = await pageImage(candidate.website);
      if (image && (await servesImage(image))) return { imageUrl: image, imageSource: "website" };
    }
    // Tier 2b: a Wikimedia Commons file that names the venue (museums and cultural venues).
    if (candidate.category === "museum") {
      try {
        const file = await findCommonsImage(candidate, fetchImpl);
        if (file && (await servesImage(file.url))) {
          return {
            imageUrl: file.url,
            imageSource: "wikimedia",
            ...(file.credit ? { imageCredit: file.credit } : {}),
            ...(file.link ? { imageLink: file.link } : {}),
          };
        }
      } catch {
        /* Commons unreachable: fall through to the tile */
      }
    }
    return undefined; // Tier 3: the category tile
  }

  async function resolve(candidate: PlaceCandidate): Promise<ResolvedImage | undefined> {
    const key = candidate.qlooEntityId;
    const hit = found.get<ResolvedImage>(key);
    if (hit) return hit;
    if (missed.get<true>(key)) return undefined;
    const result = await resolveUncached(candidate);
    if (result) found.set(key, result);
    else missed.set(key, true);
    return result;
  }

  async function attach(session: PlanSession): Promise<void> {
    const items: PlanItem[] = Object.values(session.plan.stages).flat();
    let closed = false; // nothing may change the session once the budget ends: it is about to be signed
    const apply = (item: PlanItem, candidate: PlaceCandidate, image: ResolvedImage | undefined) => {
      if (closed) return;
      for (const target of [item, candidate] as (PlanItem | PlaceCandidate)[]) {
        clearImage(target);
        if (image) Object.assign(target, image);
      }
    };
    const work = items
      .filter((item) => !item.imageUrl) // an item that already carries a verified image keeps it across revisions
      .map(async (item) => {
        const candidate = session.candidates[item.qlooEntityId];
        if (candidate) apply(item, candidate, await resolve(candidate).catch(() => undefined));
      });
    await Promise.race([Promise.allSettled(work), SHORT_NAP(budgetMs)]);
    closed = true;
    // An image Qloo merely claimed, and that was never verified for a plan item, must not ship.
    for (const candidate of Object.values(session.candidates)) {
      const verified = items.find((item) => item.qlooEntityId === candidate.qlooEntityId && item.imageUrl);
      if (!verified) clearImage(candidate);
    }
  }

  return { resolve, attach };
}

/** A resolver that never finds an image (unit tests of other behavior; the plan keeps its category tiles). */
export { clearImage };
export const noImages: ImageResolver = {
  resolve: async () => undefined,
  attach: async (session) => {
    for (const candidate of Object.values(session.candidates)) clearImage(candidate);
  },
};
