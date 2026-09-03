import { describe, expect, it } from "vitest";
import { PanelBoundary } from "@/components/admin/PanelBoundary";

describe("[UNIT] PanelBoundary", () => {
  it("captures the message of a thrown Error", () => {
    expect(PanelBoundary.getDerivedStateFromError(new RangeError("Invalid time value"))).toEqual({
      message: "Invalid time value",
    });
  });

  it("falls back to a generic message for non-Error throws", () => {
    expect(PanelBoundary.getDerivedStateFromError("boom")).toEqual({ message: "unknown error" });
  });
});
