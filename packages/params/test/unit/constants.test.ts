import * as constants from "../../src";
import {ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";

/* eslint-disable @typescript-eslint/naming-convention */

describe("Lightclient pre-computed constants", () => {
  const FINALIZED_ROOT_INDEX = Number(ssz.altair.BeaconState.getPathGindex(["finalizedCheckpoint", "root"]));
  const NEXT_SYNC_COMMITTEE_INDEX = Number(ssz.altair.BeaconState.getPathGindex(["nextSyncCommittee"]));
  const FINALIZED_ROOT_INDEX_FLOORLOG2 = floorlog2(FINALIZED_ROOT_INDEX);
  const NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2 = floorlog2(NEXT_SYNC_COMMITTEE_INDEX);

  const correctConstants = {
    FINALIZED_ROOT_INDEX,
    NEXT_SYNC_COMMITTEE_INDEX,
    FINALIZED_ROOT_INDEX_FLOORLOG2,
    NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2,
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
