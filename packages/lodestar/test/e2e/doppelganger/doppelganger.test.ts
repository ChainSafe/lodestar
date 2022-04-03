import {expect} from "chai";
import {phase0} from "@chainsafe/lodestar-types";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {getAndInitDevValidators} from "../../utils/node/validator";
import {ChainEvent} from "../../../src/chain";
import {Network} from "../../../src/network";
import {connect} from "../../utils/network";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";

/* eslint-disable @typescript-eslint/no-unsafe-call */
describe("doppelganger / doppelganger test", function () {
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const validatorCount = 1;
  const beaconParams: Partial<IChainConfig> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
  };

  it("should shut down validator if same key is active", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
    const doppelgangerEpochsToCheck = 2;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("Node-B", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    const {validators: validatorsWithDoppelganger} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
      enableDoppelganger,
      doppelgangerEpochsToCheck,
    });
    afterEachCallbacks.push(() => Promise.all(validatorsWithDoppelganger.map((v) => v.stop())));

    const bn2 = await getDevBeaconNode({
      params: beaconParams,
      options: {api: {rest: {enabled: false}}},
      validatorCount,
      genesisTime: bn.chain.getHeadState().genesisTime,
      logger: loggerNodeB,
    });
    afterEachCallbacks.push(() => bn2.close());

    const {validators} = await getAndInitDevValidators({
      node: bn2,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.stop())));

    await connect(bn2.network as Network, bn.network.peerId, bn.network.localMultiaddrs);

    await Promise.all([...validatorsWithDoppelganger, ...validators].map((validator) => validator.start()));

    expect(validators[0].getStatus()).to.be.equals(
      "running",
      "validator without doppelganger protection should be running"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equals(
      "running",
      "validator with doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.clockEpoch, 240000);
    // After first checkpoint doppelganger protection should have stopped the validatorsWithDoppelganger
    expect(validators[0].getStatus()).to.be.equals(
      "running",
      "validator without doppelganger protection should still be running after first epoch"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equals(
      "stopped",
      "validator with doppelganger protection should be stopped after first epoch"
    );
  });
  it("should not shut down validator if key is different", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
    const doppelgangerEpochsToCheck = 2;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("Node-B", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    const {validators: validatorsWithDoppelganger} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
      enableDoppelganger,
      doppelgangerEpochsToCheck,
    });
    afterEachCallbacks.push(() => Promise.all(validatorsWithDoppelganger.map((v) => v.stop())));

    const bn2 = await getDevBeaconNode({
      params: beaconParams,
      options: {api: {rest: {enabled: false}}},
      validatorCount,
      genesisTime: bn.chain.getHeadState().genesisTime,
      logger: loggerNodeB,
    });
    afterEachCallbacks.push(() => bn2.close());

    const {validators} = await getAndInitDevValidators({
      node: bn2,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 1,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.stop())));

    await connect(bn2.network as Network, bn.network.peerId, bn.network.localMultiaddrs);

    await Promise.all([...validatorsWithDoppelganger, ...validators].map((validator) => validator.start()));

    expect(validators[0].getStatus()).to.be.equals(
      "running",
      "validator without doppelganger protection should be running"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equals(
      "running",
      "validator with doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.clockEpoch, 240000);
    expect(validators[0].getStatus()).to.be.equals(
      "running",
      "validator without doppelganger protection should still be running after first epoch"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equals(
      "running",
      "validator with doppelganger protection should still be active after first epoch"
    );
  });
});
