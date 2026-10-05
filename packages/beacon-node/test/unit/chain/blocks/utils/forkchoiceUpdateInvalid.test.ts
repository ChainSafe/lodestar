import {describe, expect, it, vi} from "vitest";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {invalidateForkchoiceHeadFromFcuInvalid} from "../../../../../src/chain/blocks/utils/forkchoiceUpdateInvalid.js";
import type {BeaconChain} from "../../../../../src/chain/chain.js";
import {ForkchoiceCaller} from "../../../../../src/chain/forkChoice/index.js";
import {ForkchoiceUpdateError, ForkchoiceUpdateErrorCode} from "../../../../../src/execution/engine/interface.js";

describe("chain / blocks / utils / invalidateForkchoiceHeadFromFcuInvalid", () => {
  const headBlockRoot = "0xbeac0a000000000000000000000000000000000000000000000000000000000a";
  const headBlockHash = "0x19dc0a000000000000000000000000000000000000000000000000000000000a";
  const lvh = "0x05a771b000000000000000000000000000000000000000000000000000000a05";
  const newHeadBlockRoot = "0xbeac12e000000000000000000000000000000000000000000000000000000a12";

  function makeChain(): {
    chain: BeaconChain;
    validateLatestHash: ReturnType<typeof vi.fn>;
    recomputeForkChoiceHead: ReturnType<typeof vi.fn>;
    logger: {warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>};
  } {
    const validateLatestHash = vi.fn();
    const recomputeForkChoiceHead = vi.fn().mockReturnValue({blockRoot: newHeadBlockRoot, slot: 5598});
    const logger = {warn: vi.fn(), error: vi.fn(), info: vi.fn()};
    const chain = {
      forkChoice: {validateLatestHash},
      logger,
      recomputeForkChoiceHead,
    } as unknown as BeaconChain;
    return {chain, validateLatestHash, recomputeForkChoiceHead, logger};
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

  it("recomputes head after invalidation so attestations and proposals see the corrected head", () => {
    const {chain, recomputeForkChoiceHead, logger} = makeChain();
    const e = new ForkchoiceUpdateError({
      code: ForkchoiceUpdateErrorCode.INVALID,
      headBlockHash,
      latestValidHash: lvh,
      validationError: null,
    });

    invalidateForkchoiceHeadFromFcuInvalid(chain, headBlockRoot, headBlockHash, e);

    expect(recomputeForkChoiceHead).toHaveBeenCalledTimes(1);
    expect(recomputeForkChoiceHead).toHaveBeenCalledWith(ForkchoiceCaller.forkchoiceUpdateInvalid);
    // head changed → info log noting the switch
    expect(logger.info).toHaveBeenCalledWith(
      "Switched head after FCU INVALID invalidation",
      expect.objectContaining({
        oldHeadBlockRoot: headBlockRoot,
        newHeadBlockRoot,
      })
    );
  });

  it("does not log a switch if head recompute returns the same root (no descendant alternative)", () => {
    const {chain, recomputeForkChoiceHead, logger} = makeChain();
    recomputeForkChoiceHead.mockReturnValueOnce({blockRoot: headBlockRoot, slot: 5597});
    const e = new ForkchoiceUpdateError({
      code: ForkchoiceUpdateErrorCode.INVALID,
      headBlockHash,
      latestValidHash: lvh,
      validationError: null,
    });

    invalidateForkchoiceHeadFromFcuInvalid(chain, headBlockRoot, headBlockHash, e);

    expect(recomputeForkChoiceHead).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
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

  it("swallows validateLatestHash failures and skips head recompute so the FCU catch handler does not crash the import path", () => {
    const {chain, validateLatestHash, recomputeForkChoiceHead} = makeChain();
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
    expect(recomputeForkChoiceHead).not.toHaveBeenCalled();
  });

  it("swallows recomputeForkChoiceHead failures so the FCU catch handler does not crash the import path", () => {
    const {chain, recomputeForkChoiceHead} = makeChain();
    recomputeForkChoiceHead.mockImplementationOnce(() => {
      throw new Error("findHead failed");
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
