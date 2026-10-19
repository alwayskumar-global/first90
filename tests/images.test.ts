import { describe, expect, it, vi } from "vitest";
import { planSessionSchema } from "@/domain/schemas";
import type { PlaceCandidate, PlanSession } from "@/domain/types";
import { assertPublicUrl, isPrivateAddress, safeFetch, UnsafeUrlError } from "@/lib/images/guard";
import { extractPageImage, readHead } from "@/lib/images/html";
import { pickCommonsImage, type CommonsPage } from "@/lib/images/commons";
import { createImageResolver, noImages } from "@/lib/images/resolver";
import { normalizePlace } from "@/lib/qloo/normalizePlace";
import { buildPlan } from "@/lib/agent/workflow";
import { createGate, createLimits } from "@/server/limits";
import { handlePlan, type PlanApiDeps } from "@/server/planApi";
import { signSession, verifySession } from "@/server/sessionSigning";
import { BASE_INPUT, candidate, fakeClient, largeRaw, rawEntity } from "./helpers";

const PUBLIC = async () => ["93.184.216.34"];
const png = (init: ResponseInit = {}) => new Response("x", { status: 200, headers: { "content-type": "image/png" }, ...init });

describe("SSRF guard", () => {
  it("rejects loopback, private, link-local and metadata addresses in every common form", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("accepts only public http(s) URLs on ports 80/443 without credentials", async () => {
    await expect(assertPublicUrl("https://example.com/a", { lookup: PUBLIC })).resolves.toBeInstanceOf(URL);
    for (const bad of [
      "ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com", "https://example.com:8443/x",
      "http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "http://169.254.169.254/latest/meta-data", "http://intranet/x",
      "http://printer.local/x", "http://db.internal/x", "http://0x7f000001/x", "not a url",
    ]) {
      await expect(assertPublicUrl(bad, { lookup: PUBLIC }), bad).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("rejects a public-looking name that resolves to a private address (DNS pointing inward)", async () => {
    await expect(assertPublicUrl("https://sneaky.example.com/", { lookup: async () => ["10.0.0.5"] })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("https://mixed.example.com/", { lookup: async () => ["93.184.216.34", "127.0.0.1"] })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("https://gone.example.com/", { lookup: async () => { throw new Error("NXDOMAIN"); } })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("allows the local mock only when explicitly told to", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:4010/x", { allowLoopback: true })).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("http://127.0.0.1:4010/x")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("follows redirects by hand and refuses one that points inside", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://start.example.com")
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })
        : png(),
    ) as unknown as typeof fetch;
    await expect(safeFetch("https://start.example.com/", {}, { fetchImpl, lookup: PUBLIC, timeoutMs: 1000 })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the internal URL was never requested

    const ok = vi.fn(async (url: string) => (url.endsWith("/a") ? new Response(null, { status: 301, headers: { location: "/b" } }) : png())) as unknown as typeof fetch;
    const response = await safeFetch("https://good.example.com/a", {}, { fetchImpl: ok, lookup: PUBLIC, timeoutMs: 1000 });
    expect(response.status).toBe(200);
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://good.example.com/a" } })) as unknown as typeof fetch;
    await expect(safeFetch("https://good.example.com/a", {}, { fetchImpl: loop, lookup: PUBLIC, timeoutMs: 1000 })).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("page preview image", () => {
  const page = "https://venue.example.com/about/";
  it("reads og:image, then twitter:image, resolving relative URLs against the page", () => {
    expect(extractPageImage('<meta property="og:image" content="https://cdn.example.com/a.jpg">', page)).toBe("https://cdn.example.com/a.jpg");
    expect(extractPageImage("<meta content='/img/b.png' property='og:image'>", page)).toBe("https://venue.example.com/img/b.png");
    expect(extractPageImage('<meta name="twitter:image" content="c.png"><title>x</title>', page)).toBe("https://venue.example.com/about/c.png");
    expect(extractPageImage('<meta property="og:image:secure_url" content="https://s.example.com/s.jpg"><meta property="og:image" content="http://s.example.com/p.jpg">', page)).toBe("https://s.example.com/s.jpg");
    expect(extractPageImage('<meta property="og:image" content="https://x.example.com/?a=1&amp;b=2">', page)).toBe("https://x.example.com/?a=1&b=2");
  });
  it("returns nothing when the page declares no image", () => {
    expect(extractPageImage('<meta property="og:title" content="Hi"><meta name="description" content="d">', page)).toBeUndefined();
    expect(extractPageImage("", page)).toBeUndefined();
  });
  it("reads only the head, and never more than the byte cap", async () => {
    const head = '<html><head><meta property="og:image" content="https://i.example.com/x.jpg"></head><body>' + "x".repeat(10);
    expect(await readHead(new Response(head))).toContain("og:image");
    const huge = new Response("a".repeat(2_000_000));
    expect((await readHead(huge, 100_000)).length).toBeLessThanOrEqual(100_000);
  });
});

describe("Wikimedia Commons matching", () => {
  const file = (title: string, extra: Record<string, string> = {}): CommonsPage => ({
    title,
    imageinfo: [{
      thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/800px-x.jpg", mime: "image/jpeg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:X.jpg",
      extmetadata: { Artist: { value: '<a href="//x">Jane Doe</a>' }, LicenseShortName: { value: "CC BY-SA 4.0" }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])) },
    }],
  });

  it("uses a file that names the venue, with its author and licence", () => {
    const picked = pickCommonsImage("North Carolina Museum of Art", [file("File:North Carolina Museum of Art west building.jpg")]);
    expect(picked).toMatchObject({ credit: "Jane Doe, CC BY-SA 4.0", link: "https://commons.wikimedia.org/wiki/File:X.jpg" });
    expect(picked?.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
  });
  it("never uses a file that is merely nearby", () => {
    expect(pickCommonsImage("North Carolina Museum of Art", [file("File:Raleigh skyline at night.jpg"), file("File:Street corner.jpg")])).toBeUndefined();
    expect(pickCommonsImage("Mordecai House", [file("File:Raleigh house.jpg")])).toBeUndefined();
  });
  it("ignores non-photo types and files not served from Wikimedia", () => {
    const svg = file("File:Mordecai House logo.svg");
    svg.imageinfo![0]!.mime = "image/svg+xml";
    const foreign = file("File:Mordecai House.jpg");
    foreign.imageinfo![0]!.thumburl = "https://evil.example.com/x.jpg";
    expect(pickCommonsImage("Mordecai House", [svg, foreign])).toBeUndefined();
  });
});

describe("normalizing Qloo's image field", () => {
  const entity = (properties: Record<string, unknown>) => rawEntity({ id: "e1", genre: "Coffee shop" }) && { ...rawEntity({ id: "e1", genre: "Coffee shop" }), properties: { ...(rawEntity({ id: "e1", genre: "Coffee shop" }) as { properties: object }).properties, ...properties } };
  const ctx = { category: "cafe" as const, signalEntityIds: [], signalTagIds: [], filterTagIds: ["urn:tag:category:place:cafe"] };

  it("reads properties.image.url, or the first of properties.images, https only", () => {
    expect(normalizePlace(entity({ image: { url: "https://images.qloo.com/i/1" } }), ctx)).toMatchObject({ imageUrl: "https://images.qloo.com/i/1", imageSource: "qloo" });
    expect(normalizePlace(entity({ images: [{ url: "https://images.qloo.com/i/2", type: "urn:image:place:unknown" }] }), ctx)).toMatchObject({ imageUrl: "https://images.qloo.com/i/2" });
    for (const bad of ["http://images.qloo.com/i/3", "javascript:alert(1)", "https://u:p@images.qloo.com/i", "data:image/png;base64,AAAA", "https://x.example.com/" + "a".repeat(700)]) {
      expect(normalizePlace(entity({ image: { url: bad } }), ctx)?.imageUrl, bad).toBeUndefined();
    }
    expect(normalizePlace(entity({}), ctx)?.imageUrl).toBeUndefined();
  });
});

describe("session schema for images", () => {
  it("accepts https image fields on items and candidates, and rejects anything else", async () => {
    const { client } = fakeClient(largeRaw());
    const { session } = await buildPlan({ client }, BASE_INPUT);
    const first = session.plan.stages.first_week[0]!;
    const withImage = structuredClone(session);
    withImage.plan.stages.first_week[0] = { ...first, imageUrl: "https://images.qloo.com/i/1", imageSource: "qloo" };
    expect(planSessionSchema.safeParse(withImage).success).toBe(true);
    for (const bad of ["http://images.qloo.com/i/1", "javascript:alert(1)", "https://a:b@images.qloo.com/i"]) {
      const broken = structuredClone(session);
      broken.plan.stages.first_week[0] = { ...first, imageUrl: bad, imageSource: "qloo" };
      expect(planSessionSchema.safeParse(broken).success, bad).toBe(false);
    }
    const wrongSource = structuredClone(session);
    wrongSource.plan.stages.first_week[0] = { ...first, imageUrl: "https://images.qloo.com/i/1", imageSource: "stock" as never };
    expect(planSessionSchema.safeParse(wrongSource).success).toBe(false);
  });
});

describe("image resolver", () => {
  const place = (over: Partial<PlaceCandidate> & { id?: string } = {}) => candidate({ id: "p1", category: "cafe", imageUrl: "https://images.qloo.com/i/p1", imageSource: "qloo", ...over });
  const route = (map: Record<string, () => Response>) =>
    vi.fn(async (url: string) => {
      const hit = Object.entries(map).find(([prefix]) => url.startsWith(prefix));
      if (!hit) throw new Error(`unexpected request: ${url}`);
      return hit[1]();
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const make = (fetchImpl: typeof fetch, extra = {}) => createImageResolver({ fetchImpl, lookup: PUBLIC, ...extra });

  it("tier 1: keeps Qloo's image once it answers with an image", async () => {
    const f = route({ "https://images.qloo.com/": () => png() });
    expect(await make(f).resolve(place())).toEqual({ imageUrl: "https://images.qloo.com/i/p1", imageSource: "qloo" });
  });

  it("rejects non-images, errors, oversize files and slow hosts, then falls through", async () => {
    for (const response of [() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), () => png({ status: 404 }), () => png({ headers: { "content-type": "image/png", "content-length": "9000000" } }), () => new Response("x", { status: 200, headers: { "content-type": "image/svg+xml" } })]) {
      expect(await make(route({ "https://images.qloo.com/": response })).resolve(place())).toBeUndefined();
    }
    const hang = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("timeout"))))) as unknown as typeof fetch;
    expect(await make(hang).resolve(place())).toBeUndefined();
  }, 15_000);

  it("tier 2: a venue page's og:image, fetched only from the website Qloo returned", async () => {
    const f = route({
      "https://images.qloo.com/": () => png({ status: 404 }),
      "https://venue.example.com/hero.jpg": () => png(),
      "https://venue.example.com/": () => new Response('<head><meta property="og:image" content="/hero.jpg"></head>', { status: 200, headers: { "content-type": "text/html" } }),
    });
    const resolved = await make(f).resolve(place({ website: "https://venue.example.com/" }));
    expect(resolved).toEqual({ imageUrl: "https://venue.example.com/hero.jpg", imageSource: "website" });
    expect(f.mock.calls.map(([url]) => new URL(url as string).host)).toEqual(["images.qloo.com", "venue.example.com", "venue.example.com"]);
  });

  it("tier 2: refuses an og:image that is http, internal or not an image", async () => {
    const page = (content: string) => () => new Response(`<head><meta property="og:image" content="${content}"></head>`, { status: 200, headers: { "content-type": "text/html" } });
    for (const content of ["http://venue.example.com/h.jpg", "https://169.254.169.254/latest", "https://venue.example.com/page.html"]) {
      const f = route({ "https://images.qloo.com/": () => png({ status: 404 }), "https://venue.example.com/page.html": () => new Response("<p>", { headers: { "content-type": "text/html" } }), "https://venue.example.com/": page(content) });
      expect(await make(f).resolve(place({ website: "https://venue.example.com/" })), content).toBeUndefined();
    }
  });

  it("never fetches an internal website, whatever Qloo says", async () => {
    const f = route({ "https://images.qloo.com/": () => png({ status: 404 }) });
    expect(await make(f, { lookup: async () => ["10.0.0.9"] }).resolve(place({ website: "https://corp.example.com/" }))).toBeUndefined();
    expect(f.mock.calls.every(([url]) => String(url).startsWith("https://images.qloo.com/"))).toBe(true);
  });

  it("tier 2: a museum falls back to a Commons file that names it, with credit", async () => {
    const commons = (url: string) =>
      url.includes("list=geosearch")
        ? Response.json({ query: { geosearch: [{ title: "File:Test Museum front.jpg" }] } })
        : Response.json({ query: { pages: { 1: { title: "File:Test Museum front.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/t/800px-x.jpg", mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Test_Museum_front.jpg", extmetadata: { Artist: { value: "A. Photographer" }, LicenseShortName: { value: "CC BY 4.0" } } }] } } } });
    const f = vi.fn(async (url: string) => (url.startsWith("https://commons.wikimedia.org/") ? commons(url) : url.startsWith("https://upload.wikimedia.org/") ? png() : png({ status: 404 }))) as unknown as typeof fetch;
    const museum = place({ category: "museum", name: "Test Museum" });
    expect(await make(f).resolve(museum)).toMatchObject({ imageSource: "wikimedia", imageCredit: "A. Photographer, CC BY 4.0", imageLink: "https://commons.wikimedia.org/wiki/File:Test_Museum_front.jpg" });
    // other categories never use Commons
    const cafe = place({ id: "p2", category: "cafe", name: "Test Museum Cafe" });
    expect(await make(f).resolve(cafe)).toBeUndefined();
  });

  it("tier 3: nothing found means no image, and the answer is cached", async () => {
    const f = route({ "https://images.qloo.com/": () => png({ status: 404 }) });
    const resolver = make(f);
    expect(await resolver.resolve(place())).toBeUndefined();
    expect(await resolver.resolve(place())).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caches a found image so repeat builds are instant", async () => {
    const f = route({ "https://images.qloo.com/": () => png() });
    const resolver = make(f);
    await resolver.resolve(place());
    await resolver.resolve(place());
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("without verification it uses Qloo's https URL and touches no network", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const resolver = createImageResolver({ verify: false, fetchImpl: f });
    expect(await resolver.resolve(place())).toEqual({ imageUrl: "https://images.qloo.com/i/p1", imageSource: "qloo" });
    expect(await resolver.resolve(place({ id: "p2", imageUrl: undefined, website: "https://venue.example.com/" }))).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("attaching images to a plan", () => {
  async function plan(): Promise<PlanSession> {
    const { client } = fakeClient(largeRaw());
    const { session } = await buildPlan({ client }, BASE_INPUT);
    return session;
  }
  const items = (s: PlanSession) => Object.values(s.plan.stages).flat();

  it("copies verified images onto items and candidates, and clears every image that did not verify", async () => {
    const session = await plan();
    const [first, second] = items(session);
    for (const item of [first!, second!]) session.candidates[item.qlooEntityId]!.imageUrl = "https://images.qloo.com/claimed";
    const resolver = createImageResolver({
      fetchImpl: vi.fn(async (url: string) => (String(url).endsWith(first!.qlooEntityId) ? png() : png({ status: 404 }))) as unknown as typeof fetch,
      lookup: PUBLIC,
    });
    session.candidates[first!.qlooEntityId]!.imageUrl = `https://images.qloo.com/i/${first!.qlooEntityId}`;
    session.candidates[first!.qlooEntityId]!.imageSource = "qloo";
    session.candidates[second!.qlooEntityId]!.imageSource = "qloo";
    await resolver.attach(session);

    expect(session.plan.stages.first_week.concat(session.plan.stages.first_month, session.plan.stages.months_2_3).find((i) => i.qlooEntityId === first!.qlooEntityId)).toMatchObject({ imageSource: "qloo" });
    const itemFor = (id: string) => items(session).find((i) => i.qlooEntityId === id)!;
    expect(itemFor(first!.qlooEntityId).imageUrl).toContain(first!.qlooEntityId);
    expect(session.candidates[first!.qlooEntityId]!.imageUrl).toBe(itemFor(first!.qlooEntityId).imageUrl);
    expect(itemFor(second!.qlooEntityId).imageUrl).toBeUndefined();
    expect(session.candidates[second!.qlooEntityId]!.imageUrl).toBeUndefined(); // claimed, never verified: not shipped
  });

  it("stops at its time budget and leaves slow items without an image", async () => {
    const session = await plan();
    for (const item of items(session)) { const c = session.candidates[item.qlooEntityId]!; c.imageUrl = "https://images.qloo.com/slow"; c.imageSource = "qloo"; }
    const slow = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch; // never answers
    const started = Date.now();
    await createImageResolver({ fetchImpl: slow, lookup: PUBLIC, budgetMs: 150 }).attach(session);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(items(session).every((i) => i.imageUrl === undefined)).toBe(true);
    expect(Object.values(session.candidates).every((c) => c.imageUrl === undefined)).toBe(true);
  });

  it("keeps an item's verified image across revisions without refetching it", async () => {
    const session = await plan();
    const [first] = items(session);
    first!.imageUrl = "https://images.qloo.com/i/kept";
    first!.imageSource = "qloo";
    session.candidates[first!.qlooEntityId]!.imageUrl = "https://images.qloo.com/i/kept";
    const f = vi.fn(async () => png({ status: 404 })) as unknown as typeof fetch;
    await createImageResolver({ fetchImpl: f, lookup: PUBLIC }).attach(session);
    expect(items(session).find((i) => i.id === first!.id)!.imageUrl).toBe("https://images.qloo.com/i/kept");
  });
});

describe("images through the plan API", () => {
  const SECRET = "test-secret-at-least-16-chars";
  const post = (body: unknown) => new Request("http://x.test/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const deps = (images: PlanApiDeps["images"]): PlanApiDeps => {
    const limits = createLimits({ RATE_LIMIT_BUILDS_PER_MIN: "100", RATE_LIMIT_REVISIONS_PER_MIN: "100", RATE_LIMIT_GLOBAL_BUILDS_PER_MIN: "1000", RATE_LIMIT_GLOBAL_LOOKUPS_PER_MIN: "1000" });
    return { client: () => fakeClient(largeRaw()).client, limits, sessionSecret: () => SECRET, buildGate: createGate(4), images };
  };
  const stampImages: PlanApiDeps["images"] = {
    resolve: async () => undefined,
    attach: async (session) => {
      for (const item of Object.values(session.plan.stages).flat()) {
        if (item.imageUrl) continue;
        item.imageUrl = `https://images.qloo.com/i/${item.qlooEntityId}`;
        item.imageSource = "qloo";
        session.candidates[item.qlooEntityId]!.imageUrl = item.imageUrl;
      }
    },
  };
  const build = async (d: PlanApiDeps) => {
    const text = await (await handlePlan(post({ action: "build", input: BASE_INPUT }), d)).text();
    return JSON.parse(text.trim().split("\n").at(-1)!).session as PlanSession;
  };

  it("attaches images before signing, so the signature covers them", async () => {
    const session = await build(deps(stampImages));
    expect(Object.values(session.plan.stages).flat().every((i) => i.imageUrl?.startsWith("https://images.qloo.com/"))).toBe(true);
    expect(verifySession(session, SECRET)).toBe(true);
  });

  it("rejects a session whose image URL was swapped (400 bad_session)", async () => {
    const d = deps(stampImages);
    const session = await build(d);
    const tampered = structuredClone(session);
    tampered.plan.stages.first_week[0]!.imageUrl = "https://evil.example.com/tracker.png";
    const id = tampered.plan.stages.first_week[0]!.id;
    const res = await handlePlan(post({ action: "revise", session: tampered, feedback: { itemId: id, action: "replace", reason: "too_far" } }), d);
    expect(res.status).toBe(400);
    expect((await res.json()).kind).toBe("bad_session");
  });

  it("keeps images through save/replace revisions, gives a replacement its own image, and signs the result", async () => {
    const d = deps(stampImages);
    const session = await build(d);
    const target = session.plan.stages.first_week[0]!;
    const res = await handlePlan(post({ action: "revise", session, feedback: { itemId: target.id, action: "replace", reason: "too_far" } }), d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: PlanSession };
    expect(verifySession(body.session, SECRET)).toBe(true);
    const all = Object.values(body.session.plan.stages).flat();
    expect(all.every((i) => i.imageUrl)).toBe(true);
    const saved = await handlePlan(post({ action: "revise", session: body.session, feedback: { itemId: all[0]!.id, action: "save" } }), d);
    expect(verifySession(((await saved.json()) as { session: PlanSession }).session, SECRET)).toBe(true);
  });

  it("works with no images at all: tiles only, nothing broken", async () => {
    const session = await build(deps(noImages));
    expect(Object.values(session.plan.stages).flat().every((i) => i.imageUrl === undefined)).toBe(true);
    expect(verifySession(session, SECRET)).toBe(true);
  });

  it("a signed session still verifies when a client marks an item saved (status stays unsigned)", async () => {
    const session = await build(deps(stampImages));
    const marked = structuredClone(session);
    marked.plan.stages.first_week[0]!.status = "saved";
    expect(verifySession(signSession(session, SECRET), SECRET)).toBe(true);
    expect(verifySession(marked, SECRET)).toBe(true);
  });
});
