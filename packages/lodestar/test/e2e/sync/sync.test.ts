import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";
import {Checkpoint, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import * as assert from "assert";
import {getDevValidators} from "../../utils/node/validator";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

describe("syncing", function () {

  it("should sync from other BN", async function () {
    this.timeout(0);
    const bn = await getDevBeaconNode({SECONDS_PER_SLOT: 2, SLOTS_PER_EPOCH: 8}, 8);
    const finalizationEventListener = waitForEvent<Checkpoint>(bn.chain, "finalizedCheckpoint", 240000);
    const validators = getDevValidators(bn, 8);
    await bn.start();
    validators.forEach((v) => v.start());
    try {
      await finalizationEventListener;
    } catch (e) {
      assert.fail("Failed to reach finalization");
    }
    const bn2 = await getDevBeaconNode(
      {SECONDS_PER_SLOT: 2, SLOTS_PER_EPOCH: 8},
      8,
      (await bn.chain.getHeadState()).genesisTime
    );
    await bn2.start();
    const head = await bn.chain.getHeadBlock();
    const waitForSynced = waitForEvent<SignedBeaconBlock>(
      bn2.chain,
      "processedBlock",
      100000,
      (block) => config.types.SignedBeaconBlock.equals(block, head)
    );
    await bn2.network.connect(bn.network.peerInfo);
    try {
      await waitForSynced;
    } catch (e) {
      assert.fail("Failed to sync to other node in time");
    }
    await bn2.stop();
    await Promise.all(validators.map((v) => v.stop()));
    await bn.stop();
  });

});
