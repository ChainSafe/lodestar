import {describe, expect, it, vi} from "vitest";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {invalidateForkchoiceHeadFromFcuInvalid} from "../../../../../src/chain/blocks/utils/forkchoiceUpdateInvalid.js";
import type {BeaconChain} from "../../../../../src/chain/chain.js";
import {ForkchoiceUpdateError, ForkchoiceUpdateErrorCode} from "../../../../../src/execution/engine/interface.js";

describe("chain / blocks / utils / invalidateForkchoiceHeadFromFcuInvalid", () => {
  const headBlockRoot = "0xbeac0a000000000000000000000000000000000000000000000000000000000a";
  const headBlockHash = "0x19dc0a000000000000000000000000000000000000000000000000000000000a";
  const lvh = "0x05a771b000000000000000000000000000000000000000000000000000000a05";

  function makeChain(): {chain: BeaconChain; validateLatestHash: ReturnType<typeof vi.fn>} {
    const validateLatestHash = vi.fn();
    const logger = {warn: vi.fn(), error: vi.fn()};
    const chain = {
      forkChoice: {validateLatestHash},
      logger,
    } as unknown as BeaconChain;
    return {chain, validateLatestHash};
  }

  it("calls forkChoice.validateLatestHash with the head as the invalid block and EL LVH", () => {
    const {chain, validateLatestHash} = makeChain();
    const e = new ForkchoiceUpdateError({
      code: ForkchoiceUpdateErrorCode.INVALID,
      headBlockHash,
      latestValidHash: lvh,
      validationError: "HeaderGasUsedMismatch",
    });

    invalidateForkchoiceHeadFromFcuInvalid(chain, headBlockRoot, headBlockHash, e);

    expect(validateLatestHash).toHaveBeenCalledTimes(1);
    expect(validateLatestHash).toHaveBeenCalledWith({
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: lvh,
      invalidateFromParentBlockRoot: headBlockRoot,
      invalidateFromParentBlockHash: headBlockHash,
    });
  });

  it("forwards null LVH unchanged so protoArray can apply its 'unknown LVH' policy", () => {
    const {chain, validateLatestHash} = makeChain();
    const e = new ForkchoiceUpdateError({
      code: ForkchoiceUpdateErrorCode.INVALID,
      headBlockHash,
      latestValidHash: null,
      validationError: null,
    });

    invalidateForkchoiceHeadFromFcuInvalid(chain, headBlockRoot, headBlockHash, e);

    expect(validateLatestHash).toHaveBeenCalledWith(
      expect.objectContaining({
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: null,
        invalidateFromParentBlockRoot: headBlockRoot,
        invalidateFromParentBlockHash: headBlockHash,
      })
    );
  });

  it("swallows validateLatestHash failures so the FCU catch handler does not crash the import path", () => {
    const {chain, validateLatestHash} = makeChain();
    validateLatestHash.mockImplementationOnce(() => {
      throw new Error("invalidateFromParentBlockRoot not in forkchoice");
    });
    const e = new ForkchoiceUpdateError({
      code: ForkchoiceUpdateErrorCode.INVALID,
      headBlockHash,
      latestValidHash: lvh,
      validationError: null,
    });

    expect(() => invalidateForkchoiceHeadFromFcuInvalid(chain, headBlockRoot, headBlockHash, e)).not.toThrow();
  });
});
