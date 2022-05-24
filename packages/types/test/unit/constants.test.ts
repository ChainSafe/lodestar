import * as constants from "@chainsafe/lodestar-params";
import {ssz} from "../../src/index.js";
import {expect} from "chai";

/* eslint-disable @typescript-eslint/naming-convention */

// NOTE: This test is here and not in lodestar-params, to prevent lodestar-params depending on SSZ
// Since lodestar-params and lodestar-types are in the same mono-repo, running this test here is enough
// guarantee that these constants are correct.

describe("Lightclient pre-computed constants", () => {
  const FINALIZED_ROOT_GINDEX = bnToNum(ssz.altair.BeaconState.getPathInfo(["finalizedCheckpoint", "root"]).gindex);
  const FINALIZED_ROOT_DEPTH = floorlog2(FINALIZED_ROOT_GINDEX);
  const FINALIZED_ROOT_INDEX = FINALIZED_ROOT_GINDEX % 2 ** FINALIZED_ROOT_DEPTH;

  const NEXT_SYNC_COMMITTEE_GINDEX = bnToNum(ssz.altair.BeaconState.getPathInfo(["nextSyncCommittee"]).gindex);
  const NEXT_SYNC_COMMITTEE_DEPTH = floorlog2(NEXT_SYNC_COMMITTEE_GINDEX);
  const NEXT_SYNC_COMMITTEE_INDEX = NEXT_SYNC_COMMITTEE_GINDEX % 2 ** NEXT_SYNC_COMMITTEE_DEPTH;

  const correctConstants = {
    FINALIZED_ROOT_GINDEX,
    FINALIZED_ROOT_DEPTH,
    FINALIZED_ROOT_INDEX,
    NEXT_SYNC_COMMITTEE_GINDEX,
    NEXT_SYNC_COMMITTEE_DEPTH,
    NEXT_SYNC_COMMITTEE_INDEX,
  };

  for (const [key, expectedValue] of Object.entries(correctConstants)) {
    it(key, () => {
      expect(((constants as unknown) as Record<string, number>)[key]).to.equal(expectedValue);
    });
  }
});

function floorlog2(num: number): number {
  return Math.floor(Math.log2(num));
}

/** Type safe wrapper for Number constructor that takes 'any' */
function bnToNum(bn: bigint): number {
  return Number(bn);
}
