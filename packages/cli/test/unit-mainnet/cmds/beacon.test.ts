import {LogLevel} from "@lodestar/utils";
import {describe, expect, it} from "vitest";
import {beaconHandlerInit} from "../../../src/cmds/beacon/handler.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {GlobalArgs} from "../../../src/options/globalOptions.js";
import {testFilesDir} from "../../utils.js";

describe("cmds / beacon / args handler", () => {
  // Make tests faster skipping a network call
  process.env.SKIP_FETCH_NETWORK_BOOTNODES = "true";

  it("Set known deposit contract", async () => {
    const {options} = await runBeaconHandlerInit({
      network: "mainnet",
    });

    // Okay to hardcode, since this value will never change
    expect(options.eth1.depositContractDeployBlock).toBe(11052984);
  });
});

async function runBeaconHandlerInit(args: Partial<BeaconArgs & GlobalArgs>) {
  return beaconHandlerInit({
    logLevel: LogLevel.info,
    logFileLevel: LogLevel.debug,
    dataDir: testFilesDir,
    ...args,
  } as BeaconArgs & GlobalArgs);
}
