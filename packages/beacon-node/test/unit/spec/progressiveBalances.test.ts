import {beforeEach, describe, expect, it, vi} from "vitest";
import {
  createSpecTestMetrics,
  expectInvalidStateTransitionWithNoProgressiveBalancesMismatches,
  expectNoProgressiveBalancesMismatches,
  progressiveBalancesMismatchesMetricName as name,
  readNativeProgressiveBalancesMismatches,
} from "../../spec/utils/progressiveBalances.js";

const {scrapeMetrics} = vi.hoisted(() => ({scrapeMetrics: vi.fn<() => string>()}));
vi.mock("@chainsafe/lodestar-z/metrics", () => ({init: vi.fn(), scrapeMetrics}));
vi.mock("../../spec/utils/stateTransition.js", () => ({nativeStateTransition: true}));

describe("native progressive balance assertion", () => {
  const declaration = `# TYPE ${name} counter\n`;

  beforeEach(() => scrapeMetrics.mockReturnValue(declaration));

  it.each([
    "OutOfMemory",
    "PoolExhausted",
    "RefCountOverflow",
    "InvalidPoolCapacity",
    "SystemResources",
    "ThreadQuotaExceeded",
    "ConcurrencyUnavailable",
  ])("rejects %s as infrastructure failure in an invalid fixture", async (message) => {
    const {register} = createSpecTestMetrics();
    const failure = new Error(message);
    await expect(
      expectInvalidStateTransitionWithNoProgressiveBalancesMismatches(
        () => {
          throw failure;
        },
        register,
        message
      )
    ).rejects.toBe(failure);
  });

  it("rejects a native mismatch even when the TypeScript counter is zero", async () => {
    scrapeMetrics.mockReturnValue(`${declaration}${name}{target="current"} 7\n`);
    const {register} = createSpecTestMetrics();
    await expectNoProgressiveBalancesMismatches(register, "baseline");
    scrapeMetrics.mockReturnValue(`${declaration}${name}{target="current"} 8\n`);
    await expect(expectNoProgressiveBalancesMismatches(register, "injected mismatch")).rejects.toThrow(
      `injected mismatch incremented native ${name}`
    );
  });

  it("rejects a missing native counter at initialization and assertion", async () => {
    scrapeMetrics.mockReturnValue("");
    expect(createSpecTestMetrics).toThrow("did not register");
    scrapeMetrics.mockReturnValue(declaration);
    const {register} = createSpecTestMetrics();
    scrapeMetrics.mockReturnValue("");
    await expect(expectNoProgressiveBalancesMismatches(register, "missing counter")).rejects.toThrow(
      "did not register"
    );
  });

  it("requires the native counter to be registered", () => {
    expect(() => readNativeProgressiveBalancesMismatches("")).toThrow("did not register");
    expect(readNativeProgressiveBalancesMismatches(declaration)).toBe(0);
  });

  it("detects mismatches for both target epochs", () => {
    const text = `${declaration}${name}{target="current"} 2\n${name}{target="previous"} 1\n`;
    expect(readNativeProgressiveBalancesMismatches(text)).toBe(3);
    expect(() => expect(readNativeProgressiveBalancesMismatches(text)).toBe(0)).toThrow();
  });

  it.each(["NaN", "+Inf", "-1", "0.5"])("rejects corrupt native counter %s", (value) => {
    expect(() => readNativeProgressiveBalancesMismatches(`${declaration}${name}{target="current"} ${value}\n`)).toThrow(
      "Invalid native mismatch counter"
    );
  });
});
