import {describe, expect, it} from "vitest";
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
});
