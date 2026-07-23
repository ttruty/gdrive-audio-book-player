/** Called as bytes arrive. `total` is 0 when the size is genuinely unknown. */
export type ProgressFn = (loaded: number, total: number) => void;

/** Don't fire more often than this — a fast link delivers hundreds of chunks/sec. */
const TICK_MS = 100;

/**
 * Drain a response body chunk by chunk, reporting how much has arrived.
 *
 * `Content-Length` is the honest total when the server sends one; `expectedBytes`
 * (the size Drive reported when the book was catalogued) covers the case where
 * it doesn't, so the percentage still works. The final callback always reports
 * the real byte count, whatever the header claimed.
 *
 * Bodies that can't be streamed fall back to a single read, which still yields
 * one honest 100% callback.
 */
export async function readWithProgress(
  res: Response,
  onProgress: ProgressFn,
  expectedBytes = 0,
  now: () => number = Date.now
): Promise<Blob> {
  const declared = Number(res.headers.get('Content-Length')) || 0;
  const total = declared || expectedBytes;
  const type = res.headers.get('Content-Type') ?? '';

  if (!res.body) {
    const blob = await res.blob();
    onProgress(blob.size, blob.size);
    return blob;
  }

  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  let lastTick = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;

    const t = now();
    if (t - lastTick >= TICK_MS) {
      lastTick = t;
      onProgress(loaded, total);
    }
  }

  onProgress(loaded, loaded);
  return new Blob(chunks, { type });
}
