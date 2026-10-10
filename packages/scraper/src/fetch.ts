const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class BlockedError extends Error {}

/**
 * Polite fetch: one request at a time per caller. On 403/429 it waits once and retries,
 * then stops (never tries to evade). Challenge pages stop immediately. Transient 5xx back off.
 */
export async function politeGet(url: string, attempts = 3): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "pt-PT,pt;q=0.9", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 403 || res.status === 429) {
      // Edge CDNs occasionally refuse a single request. Wait once (honouring Retry-After), then stop for good.
      if (i === 0) {
        await sleep(Math.min(Number(res.headers.get("retry-after")) * 1000 || 30_000, 120_000));
        continue;
      }
      throw new BlockedError(`${res.status} from ${new URL(url).host}`);
    }
    if (res.status >= 500) {
      await sleep(2 ** i * 2000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const html = await res.text();
    if (/Just a moment\.\.\.|cf-challenge|datadome/i.test(html.slice(0, 5000))) throw new BlockedError(`challenge page from ${new URL(url).host}`);
    return html;
  }
  throw new Error(`gave up on ${url}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
