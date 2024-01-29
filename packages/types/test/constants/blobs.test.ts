import {describe, it, expect} from "vitest";
import * as constants from "@lodestar/params";
import {ssz} from "../../src/index.js";

// NOTE: This test is here and not in lodestar-params, to prevent lodestar-params depending on SSZ
// Since lodestar-params and lodestar-types are in the same mono-repo, running this test here is enough
// guarantee that these constants are correct.

describe(`${constants.ACTIVE_PRESET}/ blobs pre-computed constants`, () => {
  const BLOBSIDECAR_FIXED_SIZE = ssz.deneb.BlobSidecars.elementType.fixedSize;
  const KZG_COMMITMENT_GINDEX0 = Number(ssz.deneb.BeaconBlockBody.getPathInfo(["blobKzgCommitments", 0]).gindex);
  const KZG_COMMITMENT_SUBTREE_INDEX0 = KZG_COMMITMENT_GINDEX0 - 2 ** constants.KZG_COMMITMENT_INCLUSION_PROOF_DEPTH;

  const correctConstants = {
    BLOBSIDECAR_FIXED_SIZE,
    KZG_COMMITMENT_GINDEX0,
    KZG_COMMITMENT_SUBTREE_INDEX0,
  };

  for (const [key, expectedValue] of Object.entries(correctConstants)) {
    it(key, () => {
      expect((constants as unknown as Record<string, number>)[key]).toEqual(expectedValue);
    });
  }
});
