/**
 * Complete paged read for research/learning inputs.
 *
 * The Data API returns at most 1,000 rows per request whatever `.limit()` asks
 * for, so `limit(5000)` + "refuse at 5000" never refused: it silently returned
 * 1,000 rows. This pages in 1,000-row steps with a stable order supplied by the
 * caller and throws at a hard ceiling instead of returning a truncated set.
 */
export const DATA_API_PAGE = 1000;

export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
  ceiling = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += DATA_API_PAGE) {
    const { data, error } = await page(from, from + DATA_API_PAGE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < DATA_API_PAGE) return rows;
    if (rows.length >= ceiling)
      throw new Error(`${label} exceeded ${ceiling} rows; refusing a truncated computation`);
  }
}
