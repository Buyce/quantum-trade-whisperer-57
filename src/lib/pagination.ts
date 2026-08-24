/**
 * Collect a bounded population page-by-page. Reaching the guard is an error,
 * never a plausible-looking partial result.
 */
export async function collectCompletePages<T>(input: {
  fetchPage: (from: number, to: number) => Promise<T[]>;
  pageSize: number;
  maxPages: number;
  overflowMessage: string;
}): Promise<T[]> {
  if (!Number.isInteger(input.pageSize) || input.pageSize <= 0) {
    throw new Error("pageSize must be a positive integer");
  }
  if (!Number.isInteger(input.maxPages) || input.maxPages <= 0) {
    throw new Error("maxPages must be a positive integer");
  }

  const rows: T[] = [];
  for (let page = 0; page < input.maxPages; page += 1) {
    const from = page * input.pageSize;
    const pageRows = await input.fetchPage(from, from + input.pageSize - 1);
    rows.push(...pageRows);
    if (pageRows.length < input.pageSize) return rows;
  }
  throw new Error(input.overflowMessage);
}
