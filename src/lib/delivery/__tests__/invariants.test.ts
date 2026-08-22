/**
 * Structural invariant: delivery can never influence publication.
 *
 * The scanner pipeline decides what gets published, graded, enrolled and
 * measured. If it could import the risk or execution modules, a broker bridge
 * failure or a sizing guardrail could silently change which setups exist — which
 * would corrupt every statistic derived from them. The dependency direction is
 * enforced here rather than by convention.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SCANNER_DIR = join(process.cwd(), "src/lib/scanner");

const FORBIDDEN = [
  "@/lib/delivery/execution",
  "@/lib/delivery/exposure",
  "@/lib/delivery/dispatch.server",
  "@/lib/delivery/revalidate.server",
  "@/lib/delivery/outbound-url.server",
  "@/lib/delivery/hmac",
  "@/lib/risk",
  "@/lib/sizing/service.server",
  "@/lib/broker/sizing.server",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("scanner independence", () => {
  it("[INVARIANT] no scanner module imports a risk or execution module", () => {
    const offenders: string[] = [];
    for (const file of walk(SCANNER_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const spec of FORBIDDEN) {
        if (source.includes(`"${spec}"`) || source.includes(`'${spec}'`)) {
          offenders.push(`${file} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("[INVARIANT] publication enqueues deliveries in SQL, so no scanner code calls the dispatcher", () => {
    const offenders = walk(SCANNER_DIR).filter((file) =>
      readFileSync(file, "utf8").includes("processNextDelivery"),
    );
    expect(offenders).toEqual([]);
  });
});
