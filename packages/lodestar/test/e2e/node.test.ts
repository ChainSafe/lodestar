import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {Checkpoint} from "@chainsafe/lodestar-types";
import * as assert from "assert";
import {getDevValidators} from "../utils/node/validator";

describe("beacon node", function () {

  it("should justify block", async function () {
    this.timeout(120000);
    const bn = await getDevBeaconNode({SECONDS_PER_SLOT: 2, SLOTS_PER_EPOCH: 8});
    const justificationEventListener = waitForEvent<Checkpoint>(bn.chain, "justifiedCheckpoint", 110000);
    const validators = getDevValidators(bn, 8);
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

  it("should finalize block", async function () {
    this.timeout(120000);
    const bn = await getDevBeaconNode({SECONDS_PER_SLOT: 2, SLOTS_PER_EPOCH: 8});
    const finalizationEventListener = waitForEvent<Checkpoint>(bn.chain, "finalizedCheckpoint", 110000);
    const validators = getDevValidators(bn, 8);
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
