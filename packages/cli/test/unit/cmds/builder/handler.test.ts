import {describe, expect, it} from "vitest";
import {defaultOptions} from "@lodestar/builder";
import {chainConfig} from "@lodestar/config/default";
import {LogLevel} from "@lodestar/utils";
import {builderHandler} from "../../../../src/cmds/builder/handler.js";
import {IBuilderCliArgs} from "../../../../src/cmds/builder/options.js";
import {GlobalArgs} from "../../../../src/options/index.js";
import {testFilesDir} from "../../../utils.js";

describe("cmds / builder / args handler", () => {
  const ZERO_ADDRESS = "0x" + "0".repeat(40);
  const VALID_FEE_RECIPIENT = "0x" + "1".repeat(40);

  async function runBuilderHandler(
    args: Partial<IBuilderCliArgs & GlobalArgs> & Record<string, unknown>
  ): Promise<void> {
    return builderHandler({
      logLevel: LogLevel.info,
      logFileLevel: LogLevel.debug,
      dataDir: testFilesDir,
      executionFeeRecipient: VALID_FEE_RECIPIENT,
      ...args,
    } as unknown as IBuilderCliArgs & GlobalArgs);
  }

  it("Should reject unscheduled Gloas", async () => {
    await expect(runBuilderHandler({})).rejects.toThrow("Gloas must be scheduled via GLOAS_FORK_EPOCH");
  });

  it("Should reject zero executionFeeRecipient", async () => {
    // Rejecting with the fee recipient error rather than the Gloas error also proves the
    // fork guard read the epoch merged in from CLI args, not from the default config
    await expect(
      runBuilderHandler({
        "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
        executionFeeRecipient: ZERO_ADDRESS,
      })
    ).rejects.toThrow("Cannot put zero address as an executionFeeRecipient");
  });

  describe("bidding options", () => {
    const validArgs = {
      "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
      "bidding.shareBps": defaultOptions.bidding.shareBps,
      "bidding.fixedCostGwei": defaultOptions.bidding.fixedCostGwei,
      "bidding.minValueGwei": defaultOptions.bidding.minValueGwei,
      "bidding.deadlineBps": defaultOptions.bidding.deadlineBps,
      "bidding.getPayloadTimeout": defaultOptions.bidding.getPayloadTimeout,
      "bidding.minOperatingBalanceGwei": defaultOptions.bidding.minOperatingBalanceGwei,
    };

    it.each([
      {option: "bidding.deadlineBps", value: 0},
      {option: "bidding.deadlineBps", value: 10_000},
      {option: "bidding.deadlineBps", value: 9500.5},
      {option: "bidding.deadlineBps", value: chainConfig.PAYLOAD_ATTESTATION_DUE_BPS - 1},
      {option: "reveal.cutoffBps", value: 0},
      {option: "reveal.cutoffBps", value: 10_000},
      {option: "reveal.cutoffBps", value: Number.NaN},
      {option: "bidding.getPayloadTimeout", value: 0},
      {option: "bidding.getPayloadTimeout", value: chainConfig.SLOT_DURATION_MS + 1},
      {option: "bidding.minOperatingBalanceGwei", value: -1},
      {option: "bidding.shareBps", value: 10_001},
      {option: "bidding.fixedCostGwei", value: -1},
      {option: "bidding.maxValueGwei", value: defaultOptions.bidding.minValueGwei - 1},
    ])("Should reject $option=$value", async ({option, value}) => {
      // The bid policy reports its options without the group
      const name = option.split(".")[1];
      await expect(runBuilderHandler({...validArgs, [option]: value})).rejects.toThrow(
        new RegExp(`^Invalid.*${name}=${value}`)
      );
    });

    it("Should accept the default options", async () => {
      // Fails on the missing keystore, which is only loaded after the options are validated
      await expect(runBuilderHandler(validArgs)).rejects.not.toThrow(/^Invalid/);
    });

    it("Should accept a bid deadline at the payload attestation deadline", async () => {
      await expect(
        runBuilderHandler({...validArgs, "bidding.deadlineBps": chainConfig.PAYLOAD_ATTESTATION_DUE_BPS})
      ).rejects.not.toThrow(/^Invalid/);
    });
  });
});
