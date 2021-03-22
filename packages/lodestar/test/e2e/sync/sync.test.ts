import {IBeaconParams} from "@chainsafe/lodestar-params";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";
import {phase0} from "@chainsafe/lodestar-types";
import assert from "assert";
import {getDevValidators} from "../../utils/node/validator";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ChainEvent} from "../../../src/chain";
import {Network} from "../../../src/network";
import {connect} from "../../utils/network";
import {testLogger, LogLevel} from "../../utils/logger";

describe("sync", function () {
  const validatorCount = 8;
  const beaconParams: Partial<IBeaconParams> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SLOTS_PER_EPOCH: 8,
  };

  it("should sync from other BN", async function () {
    this.timeout("10 min");

    const loggerNodeA = testLogger("Node-A", LogLevel.info);
    const loggerNodeB = testLogger("Node-B", LogLevel.info);
    const loggerValiA = testLogger("Vali-A", LogLevel.info);

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {minPeers: 0}},
      validatorCount,
      logger: loggerNodeA,
    });
    const finalizationEventListener = waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, 240000);
    const validators = getDevValidators({
      node: bn,
      count: 8,
      validatorClientCount: 1,
      useRestApi: false,
      logger: loggerValiA,
    });

    await Promise.all(validators.map((validator) => validator.start()));

    try {
      await finalizationEventListener;
      loggerNodeA.important("Node A emitted finalized endpoint");
    } catch (e) {
      assert.fail("Failed to reach finalization");
    }

    const bn2 = await getDevBeaconNode({
      params: beaconParams,
      validatorCount,
      genesisTime: bn.chain.getHeadState().genesisTime,
      logger: loggerNodeB,
    });
    const head = await bn.chain.getHeadBlock()!;
    const waitForSynced = waitForEvent<phase0.SignedBeaconBlock>(bn2.chain.emitter, ChainEvent.block, 100000, (block) =>
      config.types.phase0.SignedBeaconBlock.equals(block, head!)
    );
    await connect(bn2.network as Network, bn.network.peerId, bn.network.localMultiaddrs);
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
