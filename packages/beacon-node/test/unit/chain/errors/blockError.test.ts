import {describe, expect, it} from "vitest";
import {BlockErrorCode, renderBlockErrorType} from "../../../../src/chain/errors/blockError.js";

describe("chain / errors / renderBlockErrorType", () => {
  // Guards against re-lumping PER_BLOCK_PROCESSING_ERROR back with the {code, error}-only cases, which
  // would silently drop the blockRoot from logs.
  it("includes blockRoot for PER_BLOCK_PROCESSING_ERROR", () => {
    const metadata = renderBlockErrorType({
      code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR,
      blockRoot: "0x1234",
      error: new Error("invalid attestation"),
    });

    expect(metadata).toEqual({
      code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR,
      blockRoot: "0x1234",
      error: "invalid attestation",
    });
  });
});
