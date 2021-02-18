import {IBeaconParams} from "@chainsafe/lodestar-params";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";
import {Checkpoint, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import * as assert from "assert";
import {getDevValidators} from "../../utils/node/validator";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ChainEvent} from "../../../src/chain";
import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";

describe("syncing", function () {
  const validatorCount = 8;
  const beaconParams: Partial<IBeaconParams> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SLOTS_PER_EPOCH: 8,
  };

  it("should sync from other BN", async function () {
    this.timeout("10 min");

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {minPeers: 0}},
      validatorCount,
      logger: new WinstonLogger({level: LogLevel.debug, module: "BN"}),
    });
    const finalizationEventListener = waitForEvent<Checkpoint>(bn.chain.emitter, ChainEvent.finalized, 240000);
    const validators = getDevValidators(bn, 8);

    await Promise.all(validators.map((validator) => validator.start()));

    try {
      await finalizationEventListener;
    } catch (e) {
      assert.fail("Failed to reach finalization");
    }
    const bn2 = await getDevBeaconNode({
      params: beaconParams,
      validatorCount,
      genesisTime: bn.chain.getHeadState().genesisTime,
    });
    const head = await bn.chain.getHeadBlock()!;
    const waitForSynced = waitForEvent<SignedBeaconBlock>(bn2.chain.emitter, ChainEvent.block, 100000, (block) =>
      config.types.SignedBeaconBlock.equals(block, head!)
    );
    await bn2.network.connect(bn.network.peerId, bn.network.localMultiaddrs);
    try {
      await waitForSynced;
    } catch (e) {
      assert.fail("Failed to sync to other node in time");
    }
    await bn2.close();
    await Promise.all(validators.map((v) => v.stop()));
    await bn.close();
  });
});
