import {IBeaconParams} from "@chainsafe/lodestar-params";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {Checkpoint} from "@chainsafe/lodestar-types";
import * as assert from "assert";
import {getDevValidators} from "../utils/node/validator";

describe("beacon node", function () {

  const beaconParams: Partial<IBeaconParams> = {
    SECONDS_PER_SLOT: 2,
    SLOTS_PER_EPOCH: 8
  };

  it("should justify block - 8 vc - 8validators", async function () {
    this.timeout(120000);
    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {minPeers: 0}}
    });
    const justificationEventListener = waitForEvent<Checkpoint>(bn.chain, "justifiedCheckpoint", 110000);
    const validators = getDevValidators(bn, 8, 8);
    await bn.start();
    validators.forEach((v) => v.start());
    try {
      await justificationEventListener;
    } catch (e) {
      assert.fail("Failed to reach justification");
    }
    await Promise.all(validators.map((v) => v.stop()));
    await bn.stop();
  });

  it.only("should justify block - 1 vc - 32 validators", async function () {
    this.timeout(120000);
    const bn = await getDevBeaconNode({
      params: {SECONDS_PER_SLOT: 2, SLOTS_PER_EPOCH: 8, TARGET_AGGREGATORS_PER_COMMITTEE: 1},
      options: {sync: {minPeers: 0}},
      validatorCount: 32,
    });
    const justificationEventListener = waitForEvent<Checkpoint>(bn.chain, "justifiedCheckpoint", 110000);
    const validators = getDevValidators(bn, 32, 1);
    await bn.start();
    validators.forEach((v) => v.start());
    try {
      await justificationEventListener;
    } catch (e) {
      await Promise.all(validators.map((v) => v.stop()));
      await bn.stop();
      assert.fail("Failed to reach justification");
    }
    await Promise.all(validators.map((v) => v.stop()));
    await bn.stop();
  });

  it("should finalize block - 8 vc", async function () {
    this.timeout(120000);
    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {minPeers: 0}}
    });
    const finalizationEventListener = waitForEvent<Checkpoint>(bn.chain, "finalizedCheckpoint", 110000);
    const validators = getDevValidators(bn, 8, 8);
    await bn.start();
    validators.forEach((v) => v.start());
    try {
      await finalizationEventListener;
    } catch (e) {
      assert.fail("Failed to reach finalization");
    }
    await Promise.all(validators.map((v) => v.stop()));
    await bn.stop();
  });

});
