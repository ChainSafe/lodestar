import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import yargs from "yargs";
import {defaultOptions} from "@lodestar/builder";
import {builderOptions} from "../../../../src/cmds/builder/options.js";
import {rcConfigOption} from "../../../../src/options/globalOptions.js";

describe("Builder CLI configuration", () => {
  it("loads nested common options through the real rc-config loader", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-options-"));
    try {
      const configPath = path.join(directory, "builder.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          keystore: "unused.json",
          keystorePassword: "unused.txt",
          executionFeeRecipient: "0x" + "22".repeat(20),
          execution: {urls: ["http://localhost:8551"], retries: 0},
          bidding: {shareBps: 8500, deadlineBps: 6000},
          reveal: {cutoffBps: 5000},
        })
      );
      const parsed = yargs(["--rcConfig", configPath])
        .exitProcess(false)
        .strict()
        .parserConfiguration({"dot-notation": false})
        .options(builderOptions)
        .config(...rcConfigOption)
        .parseSync();
      expect(parsed["execution.urls"]).toEqual(["http://localhost:8551"]);
      expect(parsed["execution.retries"]).toBe(0);
      expect(parsed["bidding.shareBps"]).toBe(8500);
      expect(parsed["bidding.deadlineBps"]).toBe(6000);
      expect(parsed["reveal.cutoffBps"]).toBe(5000);
      expect(parsed["bidding.getPayloadTimeout"]).toBe(defaultOptions.bidding.getPayloadTimeout);
    } finally {
      fs.rmSync(directory, {recursive: true});
    }
  });
});
