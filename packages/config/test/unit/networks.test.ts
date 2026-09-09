import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {createForkConfig} from "../../src/index.js";
import {genesisData, networksChainConfig} from "../../src/networks.js";

describe("plataberget network", () => {
  it("has the expected genesis identity and schedules", () => {
    const config = createForkConfig(networksChainConfig.plataberget);

    expect(genesisData.plataberget).toEqual({
      genesisTime: 1786622400,
      genesisValidatorsRoot: "0xbb4a1a9e3f7f4e10edcd734e4acc3b5ffd4f830efe0af2748fa458cfee5d2658",
    });
    expect(config.getForkName(0)).toBe(ForkName.fulu);
    expect(config.getForkInfoAtEpoch(1536).name).toBe(ForkName.gloas);
    expect(config.getMaxBlobsPerBlock(0)).toBe(21);
    expect(config.getScheduledGasLimit(1565)).toBeUndefined();
    expect(config.getScheduledGasLimit(1566)).toBe(200000000);
  });
});
