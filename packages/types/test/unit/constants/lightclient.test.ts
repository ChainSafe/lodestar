import {describe, expect, it} from "vitest";
import * as constants from "@lodestar/params";
import {ssz} from "../../../src/index.js";

// NOTE: This test is here and not in lodestar-params, to prevent lodestar-params depending on SSZ
// Since lodestar-params and lodestar-types are in the same mono-repo, running this test here is enough
// guarantee that these constants are correct.

describe(`${constants.ACTIVE_PRESET}/ Lightclient pre-computed constants`, () => {
  const correctConstants = {
    ...stateConstants("altair", ""),
    ...stateConstants("electra", "_ELECTRA"),
    ...stateConstants("gloas", "_GLOAS"),
    ...gindexConstants(
      "BLOCK_BODY_EXECUTION_PAYLOAD",
      bnToNum(ssz.capella.BeaconBlockBody.getPathInfo(["executionPayload"]).gindex)
    ),
    ...gindexConstants(
      "EXECUTION_BLOCK_HASH",
      bnToNum(ssz.capella.BeaconBlockBody.getPathInfo(["executionPayload", "blockHash"]).gindex)
    ),
    ...gindexConstants(
      "EXECUTION_BLOCK_HASH",
      bnToNum(ssz.deneb.BeaconBlockBody.getPathInfo(["executionPayload", "blockHash"]).gindex),
      "_DENEB"
    ),
    ...gindexConstants(
      "EXECUTION_BLOCK_HASH",
      bnToNum(
        ssz.gloas.BeaconBlockBody.getPathInfo(["signedExecutionPayloadBid", "message", "parentBlockHash"]).gindex
      ),
      "_GLOAS"
    ),
  };

  for (const [key, expectedValue] of Object.entries(correctConstants)) {
    it(key, () => {
      expect((constants as unknown as Record<string, number>)[key]).toBe(expectedValue);
    });
  }
});

function stateConstants(
  fork: "altair" | "electra" | "gloas",
  suffix: "" | "_ELECTRA" | "_GLOAS"
): Record<string, number> {
  return {
    ...gindexConstants(
      "FINALIZED_ROOT",
      bnToNum(ssz[fork].BeaconState.getPathInfo(["finalizedCheckpoint", "root"]).gindex),
      suffix
    ),
    ...gindexConstants(
      "CURRENT_SYNC_COMMITTEE",
      bnToNum(ssz[fork].BeaconState.getPathInfo(["currentSyncCommittee"]).gindex),
      suffix
    ),
    ...gindexConstants(
      "NEXT_SYNC_COMMITTEE",
      bnToNum(ssz[fork].BeaconState.getPathInfo(["nextSyncCommittee"]).gindex),
      suffix
    ),
  };
}

function gindexConstants(name: string, gindex: number, suffix = ""): Record<string, number> {
  const depth = floorlog2(gindex);

  return {
    [`${name}_GINDEX${suffix}`]: gindex,
    [`${name}_DEPTH${suffix}`]: depth,
    [`${name}_INDEX${suffix}`]: gindex % 2 ** depth,
  };
}

function floorlog2(num: number): number {
  return Math.floor(Math.log2(num));
}

/** Type safe wrapper for Number constructor that takes a bigint */
function bnToNum(bn: bigint): number {
  return Number(bn);
}
