import { describe, expect, it } from "vitest";
import { cosine, jaroWinkler } from "../src/similarity";

describe("jaroWinkler", () => {
  it("matches reference values", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("dixon", "dicksonx")).toBeCloseTo(0.813, 3);
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 3);
  });

  it("handles identical, empty and disjoint strings", () => {
    expect(jaroWinkler("todoist", "todoist")).toBe(1);
    expect(jaroWinkler("", "")).toBe(0);
    expect(jaroWinkler("abc", "")).toBe(0);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("is symmetric", () => {
    expect(jaroWinkler("pomodoro", "pomodorofocus")).toBeCloseTo(jaroWinkler("pomodorofocus", "pomodoro"), 10);
  });
});

describe("cosine", () => {
  it("is 1 for parallel vectors and 0 for disjoint ones", () => {
    const a = new Map([
      ["x", 1],
      ["y", 2],
    ]);
    expect(cosine(a, new Map([["x", 2], ["y", 4]]))).toBeCloseTo(1, 10);
    expect(cosine(a, new Map([["z", 1]]))).toBe(0);
    expect(cosine(new Map(), a)).toBe(0);
  });
});
