import BN from "bn.js";
import { assert } from "chai";

import { Fork } from "../../../../../../types";
import {
  GENESIS_SLOT,
  SLOTS_PER_HISTORICAL_ROOT,
} from "../../../../../constants";

import {
  getBeaconProposerIndex,
  getBlockRootAtSlot,
  getBlockRoot,
  getDomain,
  getChurnLimit,
} from "../../../../../chain/stateTransition/util/misc";

import { generateState } from "../../../../utils/state";


describe("getDomain", () => {
  const state = generateState();
  const fork: Fork = {
    epoch: 12,
    previousVersion: Buffer.from([4, 0, 0, 0]),
    currentVersion: Buffer.from([5, 0, 0, 0]),
  };
  state.fork = fork;

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(state, 4, 8);
    assert.equal(result.toString('hex'), '0000000400000004');
  });

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(state, 5, 13);
    assert.equal(result.toString('hex'), '0000000500000005');
  });

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(state, 5, 12);
    assert.equal(result.toString('hex'), '0000000500000005');
  });
});

describe("getBlockRoot", () => {
  it("should return first block root for genesis slot", () => {
    const state = generateState({
      slot:  GENESIS_SLOT + 1,
      latestBlockRoots: Array.from({ length: SLOTS_PER_HISTORICAL_ROOT }, () => Buffer.from([0xAB])),
    });
    const res = getBlockRoot(state, GENESIS_SLOT);
    assert((new BN(res)).eq(new BN(0xAB)),
      `got: ${new BN(res)}, expected: ${0xAB}`);
  });
  it("should fail if slot is current slot", () => {
    const state = generateState({ slot: GENESIS_SLOT });
    assert.throws(() => getBlockRoot(state, GENESIS_SLOT), "");
  });
  it("should fail if slot is not within SLOTS_PER_HISTORICAL_ROOT of current slot", () => {
    const state = generateState({ slot: GENESIS_SLOT + SLOTS_PER_HISTORICAL_ROOT + 1 });
    assert.throws(() => getBlockRoot(state, GENESIS_SLOT), "");
  });
});
