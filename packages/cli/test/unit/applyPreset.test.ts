import {afterEach, describe, expect, it, vi} from "vitest";
import {globalOptions} from "../../src/options/globalOptions.js";

describe("applyPreset", () => {
  const originalArgv = process.argv;
  const originalBlsImplementation = process.env.LODESTAR_BLS_IMPLEMENTATION;

  afterEach(() => {
    process.argv = originalArgv;
    if (originalBlsImplementation === undefined) {
      delete process.env.LODESTAR_BLS_IMPLEMENTATION;
    } else {
      process.env.LODESTAR_BLS_IMPLEMENTATION = originalBlsImplementation;
    }
  });

  it("selects lodestar-z before loading the CLI source tree", async () => {
    process.argv = [process.execPath, "lodestar", "beacon", "--zig-bls"];
    delete process.env.LODESTAR_BLS_IMPLEMENTATION;
    vi.resetModules();

    await import("../../src/applyPreset.js");
    const {ACTIVE_BLS_IMPLEMENTATION, BlsImplementation} = await import("@lodestar/state-transition/bls");

    expect(process.env.LODESTAR_BLS_IMPLEMENTATION).toBe("lodestar-z");
    expect(ACTIVE_BLS_IMPLEMENTATION).toBe(BlsImplementation.lodestarZ);
  });

  it("declares --zig-bls as a hidden CLI option", () => {
    expect(globalOptions["zig-bls"]).toMatchObject({hidden: true, type: "boolean"});
  });
});
