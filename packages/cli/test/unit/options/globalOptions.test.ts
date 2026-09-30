import {afterEach, describe, expect, it} from "vitest";
import yargs from "yargs";
import {globalOptions} from "../../../src/options/index.js";

describe("options / globalOptions", () => {
  afterEach(() => {
    delete process.env.LODESTAR_Z_NODE_POOL_CAPACITY;
  });

  it("Should accept LODESTAR_Z_NODE_POOL_CAPACITY in strict mode", async () => {
    process.env.LODESTAR_Z_NODE_POOL_CAPACITY = "0";

    const args = await yargs([])
      .env("LODESTAR")
      .options(globalOptions)
      .strict()
      .fail((msg, err) => {
        throw err ?? new Error(msg);
      })
      .parseAsync();

    expect(args.zNodePoolCapacity).toBe(0);
  });
});
