import {describe, expect, it} from "vitest";
import {deterministicBenchmarkSeed} from "../perf/benchmarkSeed.js";

describe("deterministicBenchmarkSeed", () => {
  it("returns a stable domain-specific seed", () => {
    const seed = deterministicBenchmarkSeed("committee-indices:16384");

    expect(Buffer.from(seed).toString("hex")).toBe("613f0807059afde76412455148289789cdd14a3218f1024fb6fd7006d6dd38a7");
    expect(deterministicBenchmarkSeed("committee-indices:250000")).not.toEqual(seed);
  });
});
