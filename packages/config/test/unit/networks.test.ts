import {describe, expect, it} from "vitest";
import {EPHEMERY_RESET_INTERVAL_SECONDS, getEphemeryChainConfig} from "../../src/chainConfig/networks/ephemery.js";
import {ephemeryChainConfig, genesisData} from "../../src/networks.js";

describe("networks", () => {
  it("clamps ephemery iteration before genesis", () => {
    const config = getEphemeryChainConfig(1638471599);

    expect(config.MIN_GENESIS_TIME).toBe(1638471600);
    expect(config.DEPOSIT_CHAIN_ID).toBe(39438000);
    expect(config.DEPOSIT_NETWORK_ID).toBe(39438000);
  });

  it("advances ephemery resets in whole-second intervals", () => {
    const config = getEphemeryChainConfig(1638471600 + 2 * EPHEMERY_RESET_INTERVAL_SECONDS + 1);

    expect(config.MIN_GENESIS_TIME).toBe(1638471600 + 2 * EPHEMERY_RESET_INTERVAL_SECONDS);
    expect(config.DEPOSIT_CHAIN_ID).toBe(39438002);
    expect(config.DEPOSIT_NETWORK_ID).toBe(39438002);
  });

  it("tracks dynamic ephemery genesis data without a static validators root", () => {
    expect(genesisData.ephemery.genesisTime).toBe(
      ephemeryChainConfig.MIN_GENESIS_TIME + ephemeryChainConfig.GENESIS_DELAY
    );
    expect(genesisData.ephemery.genesisValidatorsRoot).toBeNull();
  });
});
