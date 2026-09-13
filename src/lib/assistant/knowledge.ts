/**
 * Grounded strategy knowledge for the in-app assistant.
 *
 * [INVARIANT] Nothing here is generated. Every passage is the project's own
 * maintained documentation, embedded at BUILD time (`?raw`) because the server
 * runs on the edge and has no filesystem to read at runtime. The assistant
 * quotes these documents instead of improvising how P-Trades works, and outside
 * web material never overrides them.
 */
import signalsDoc from "../../../docs/SIGNALS-AND-GRADES.md?raw";
import alertsDoc from "../../../docs/ALERTS-AND-ELIGIBILITY.md?raw";
import sizingDoc from "../../../docs/RISK-SIZING.md?raw";
import journalDoc from "../../../docs/JOURNAL-AND-R.md?raw";
import guardianDoc from "../../../docs/RISK-GUARDIAN.md?raw";
import executionDoc from "../../../docs/EXECUTION.md?raw";
import executionQualityDoc from "../../../docs/EXECUTION-QUALITY.md?raw";
import lifecycleDoc from "../../../docs/INSTRUMENT-LIFECYCLE.md?raw";
import contextDoc from "../../../docs/MARKET-CONTEXT.md?raw";
import researchDoc from "../../../docs/RESEARCH-AND-SHADOW.md?raw";
import statsDoc from "../../../docs/PERFORMANCE-AND-STATISTICS.md?raw";
import scannerDoc from "../../../docs/SCANNER.md?raw";
import glossaryDoc from "../../../docs/GLOSSARY.md?raw";

export type KnowledgeDoc = { file: string; title: string; body: string };

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  { file: "docs/SIGNALS-AND-GRADES.md", title: "Setups and grading", body: signalsDoc },
  {
    file: "docs/ALERTS-AND-ELIGIBILITY.md",
    title: "Alerts, eligibility and caps",
    body: alertsDoc,
  },
  { file: "docs/RISK-SIZING.md", title: "Risk and position sizing", body: sizingDoc },
  { file: "docs/JOURNAL-AND-R.md", title: "Journal and R mathematics", body: journalDoc },
  { file: "docs/RISK-GUARDIAN.md", title: "Risk brakes and gates", body: guardianDoc },
  { file: "docs/EXECUTION.md", title: "Automatic execution semantics", body: executionDoc },
  { file: "docs/EXECUTION-QUALITY.md", title: "Execution quality", body: executionQualityDoc },
  { file: "docs/INSTRUMENT-LIFECYCLE.md", title: "Instrument lifecycle", body: lifecycleDoc },
  { file: "docs/MARKET-CONTEXT.md", title: "Market context (measurement only)", body: contextDoc },
  {
    file: "docs/RESEARCH-AND-SHADOW.md",
    title: "Research candidates and shadow replay",
    body: researchDoc,
  },
  {
    file: "docs/PERFORMANCE-AND-STATISTICS.md",
    title: "Performance and statistics",
    body: statsDoc,
  },
  { file: "docs/SCANNER.md", title: "Scanner pipeline", body: scannerDoc },
  { file: "docs/GLOSSARY.md", title: "Glossary", body: glossaryDoc },
];

type Section = { file: string; docTitle: string; heading: string; text: string };

/** Split each document into heading-scoped sections so passages stay quotable. */
function buildSections(): Section[] {
  const sections: Section[] = [];
  for (const doc of KNOWLEDGE_DOCS) {
    let heading = doc.title;
    let buffer: string[] = [];
    const flush = () => {
      const text = buffer.join("\n").trim();
      if (text.length > 0) sections.push({ file: doc.file, docTitle: doc.title, heading, text });
      buffer = [];
    };
    for (const line of doc.body.split("\n")) {
      if (/^#{1,4}\s+/.test(line)) {
        flush();
        heading = line.replace(/^#{1,4}\s+/, "").trim();
        continue;
      }
      buffer.push(line);
    }
    flush();
  }
  return sections;
}

const SECTIONS = buildSections();

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "is",
  "are",
  "on",
  "for",
  "how",
  "does",
  "do",
  "what",
  "why",
  "my",
  "me",
  "it",
  "that",
  "this",
  "with",
  "when",
  "you",
  "your",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

const MAX_PASSAGE_CHARS = 1400;

/**
 * Keyword search over the embedded documentation. Deterministic and read-only:
 * it can only return text that exists in the repository's docs.
 */
export function searchPlatformDocs(query: string, limit?: number) {
  const terms = tokenize(query ?? "");
  const take = Math.min(Math.max(limit ?? 3, 1), 6);

  if (terms.length === 0) {
    return {
      query: query ?? "",
      passages: [],
      available_documents: KNOWLEDGE_DOCS.map((d) => ({ file: d.file, title: d.title })),
      note: "No searchable terms in the query. Ask again with a concrete term, or pick a document from available_documents.",
    };
  }

  const scored = SECTIONS.map((section) => {
    const haystack = `${section.docTitle}\n${section.heading}\n${section.text}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const hits = haystack.split(term).length - 1;
      if (hits === 0) continue;
      score += Math.min(hits, 5);
      if (section.heading.toLowerCase().includes(term)) score += 4;
    }
    return { section, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, take);

  return {
    query,
    passages: scored.map((entry) => ({
      source: entry.section.file,
      document: entry.section.docTitle,
      heading: entry.section.heading,
      text:
        entry.section.text.length > MAX_PASSAGE_CHARS
          ? `${entry.section.text.slice(0, MAX_PASSAGE_CHARS)}…`
          : entry.section.text,
    })),
    available_documents: KNOWLEDGE_DOCS.map((d) => ({ file: d.file, title: d.title })),
    note:
      scored.length === 0
        ? "No passage matched. Say so plainly instead of improvising a rule, and offer a document from available_documents."
        : "These passages are P-Trades' own specification. Quote them with their source file. Outside web material never overrides them.",
  };
}
