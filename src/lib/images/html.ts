/** Read at most `maxBytes` of a response body, stopping early once `</head>` has been seen. */
export async function readHead(response: Response, maxBytes = 256 * 1024): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, Math.max(0, maxBytes - bytes)); // never keep more than the cap, even from one big chunk
      bytes += chunk.byteLength;
      html += decoder.decode(chunk, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return html;
}

const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((value) => value !== undefined);

const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/g, '"').trim();

/**
 * The page's own preview image: `og:image:secure_url`, `og:image` or `twitter:image`, resolved against the page URL.
 * Returns an absolute URL string (any scheme; the caller decides what to accept) or undefined.
 */
export function extractPageImage(html: string, pageUrl: string): string | undefined {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const wanted of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) {
    for (const tag of metas) {
      const name = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
      const content = attr(tag, "content");
      if (name === wanted && content) {
        try {
          return new URL(decode(content), pageUrl).toString();
        } catch {
          /* malformed value: try the next tag */
        }
      }
    }
  }
  return undefined;
}
