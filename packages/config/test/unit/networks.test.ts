import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {getEphemeryChainConfig} from "../../src/chainConfig/networks/ephemery.js";
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

describe("ephemery network", () => {
  // ephemery-genesis values.env, current published iteration (164)
  const RESET_INTERVAL_SECONDS = 2419200;
  const baseMinGenesisTime = 1790276400; // GENESIS_TIMESTAMP
  const baseDepositChainId = 39438164; // CHAIN_ID

  it("derives the published iteration values as whole-second integers", () => {
    const config = getEphemeryChainConfig(baseMinGenesisTime * 1000);

    expect(config.MIN_GENESIS_TIME).toBe(baseMinGenesisTime);
    expect(config.GENESIS_DELAY).toBe(600);
    expect(config.DEPOSIT_CHAIN_ID).toBe(baseDepositChainId);
    expect(config.DEPOSIT_NETWORK_ID).toBe(baseDepositChainId);

    // Regression (#10160): DEPOSIT_CHAIN_ID must be an integer, not fractional
    expect(Number.isInteger(config.DEPOSIT_CHAIN_ID)).toBe(true);
    expect(Number.isInteger(config.DEPOSIT_NETWORK_ID)).toBe(true);
    // Regression (#10160): MIN_GENESIS_TIME is in seconds, not ms (was ~Date.now())
    expect(Number.isInteger(config.MIN_GENESIS_TIME)).toBe(true);
    expect(config.MIN_GENESIS_TIME).toBeLessThan(1e11);
  });

  it("is identical for every process within an iteration, independent of start time", () => {
    // Two processes started far apart within the same iteration must agree. The
    // reported bug leaked per-process start time into MIN_GENESIS_TIME (#10160).
    const early = getEphemeryChainConfig((baseMinGenesisTime + 60) * 1000 + 123);
    const late = getEphemeryChainConfig((baseMinGenesisTime + RESET_INTERVAL_SECONDS - 60) * 1000 + 456);

    expect(early.MIN_GENESIS_TIME).toBe(baseMinGenesisTime);
    expect(late.MIN_GENESIS_TIME).toBe(baseMinGenesisTime);
    expect(early.DEPOSIT_CHAIN_ID).toBe(baseDepositChainId);
    expect(late.DEPOSIT_CHAIN_ID).toBe(baseDepositChainId);
  });

  it("rolls forward one iteration per reset interval", () => {
    const next = getEphemeryChainConfig((baseMinGenesisTime + RESET_INTERVAL_SECONDS) * 1000);
    expect(next.MIN_GENESIS_TIME).toBe(baseMinGenesisTime + RESET_INTERVAL_SECONDS);
    expect(next.DEPOSIT_CHAIN_ID).toBe(baseDepositChainId + 1);
    expect(next.DEPOSIT_NETWORK_ID).toBe(baseDepositChainId + 1);

    const inFive = getEphemeryChainConfig((baseMinGenesisTime + 5 * RESET_INTERVAL_SECONDS + 1000) * 1000);
    expect(inFive.MIN_GENESIS_TIME).toBe(baseMinGenesisTime + 5 * RESET_INTERVAL_SECONDS);
    expect(inFive.DEPOSIT_CHAIN_ID).toBe(baseDepositChainId + 5);
  });

  it("does not roll backwards before the bundled base iteration", () => {
    const before = getEphemeryChainConfig((baseMinGenesisTime - 10 * RESET_INTERVAL_SECONDS) * 1000);
    expect(before.MIN_GENESIS_TIME).toBe(baseMinGenesisTime);
    expect(before.DEPOSIT_CHAIN_ID).toBe(baseDepositChainId);
  });

  it("exposes whole-second genesis data wired to the chain config", () => {
    expect(genesisData.ephemery.genesisTime).toBe(
      networksChainConfig.ephemery.MIN_GENESIS_TIME + networksChainConfig.ephemery.GENESIS_DELAY
    );
    expect(Number.isInteger(genesisData.ephemery.genesisTime)).toBe(true);
    expect(genesisData.ephemery.genesisTime).toBeLessThan(1e11);
  });
});
