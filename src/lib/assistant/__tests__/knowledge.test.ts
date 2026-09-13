import { describe, expect, it } from "vitest";
import { KNOWLEDGE_DOCS, searchPlatformDocs } from "../knowledge";

describe("platform documentation search", () => {
  it("[INVARIANT] every embedded document carries real content and a source name", () => {
    expect(KNOWLEDGE_DOCS.length).toBeGreaterThan(5);
    for (const doc of KNOWLEDGE_DOCS) {
      expect(doc.source).toMatch(/\.md$/);
      expect(doc.sections.length).toBeGreaterThan(0);
    }
  });

  it("returns passages with their source file so answers can be attributed", () => {
    const result = searchPlatformDocs("grade");
    expect(result.passages.length).toBeGreaterThan(0);
    for (const passage of result.passages) {
      expect(passage.source).toMatch(/\.md$/);
      expect(passage.text.length).toBeGreaterThan(0);
    }
  });

  it("[INVARIANT] says nothing matched rather than inventing a rule", () => {
    const result = searchPlatformDocs("zzzqqqnotarealtopicxyz");
    expect(result.passages).toHaveLength(0);
    expect(JSON.stringify(result).toLowerCase()).toContain("no ");
  });
});
