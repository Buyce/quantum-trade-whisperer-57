import { describe, expect, it } from "vitest";

import { computeSlippage, slippageUnavailableCopy } from "../slippage";

describe("computeSlippage", () => {
  it("[UNIT] prefers the published entry and signs a long fill worse-is-positive", () => {
    const result = computeSlippage({
      direction: "long",
      publishedEntry: 1.1,
      submittedEntry: 1.09,
      fillPrice: 1.1002,
    });
    expect(result.basis).toBe("published");
    expect(result.publishedEntry).toBe(1.1);
    expect(result.availability).toBe("available");
    expect(result.price).toBeCloseTo(0.0002, 10);
  });

  it("[UNIT] falls back to the submitted price and labels the basis", () => {
    const result = computeSlippage({
      direction: "short",
      publishedEntry: null,
      submittedEntry: 1.88955,
      fillPrice: 1.88956,
    });
    expect(result.basis).toBe("submitted");
    // A short filled HIGHER than requested is better, so slippage is negative.
    expect(result.price).toBeCloseTo(-0.00001, 10);
  });

  it("[INVARIANT] declares slippage unavailable when no order record survives", () => {
    const result = computeSlippage({
      direction: "short",
      publishedEntry: null,
      submittedEntry: null,
      fillPrice: 2400.5,
    });
    expect(result).toEqual({
      publishedEntry: null,
      price: null,
      availability: "unavailable_no_submitted_record",
      basis: null,
    });
  });

  it("[INVARIANT] never estimates when the broker reported no fill", () => {
    const result = computeSlippage({
      direction: "long",
      publishedEntry: 1.1,
      submittedEntry: null,
      fillPrice: null,
    });
    expect(result.price).toBeNull();
    expect(result.availability).toBe("unavailable_no_fill");
  });

  it("[INVARIANT] refuses to sign slippage without a broker direction", () => {
    const result = computeSlippage({
      direction: null,
      publishedEntry: 1.1,
      submittedEntry: null,
      fillPrice: 1.2,
    });
    expect(result.price).toBeNull();
    expect(result.availability).toBe("unavailable_no_direction");
  });

  it("[UNIT] explains every unavailable reason", () => {
    for (const reason of [
      "unavailable_no_submitted_record",
      "unavailable_no_fill",
      "unavailable_no_direction",
    ]) {
      expect(slippageUnavailableCopy(reason)).toBeTruthy();
    }
    expect(slippageUnavailableCopy("available")).toBeNull();
  });
});
