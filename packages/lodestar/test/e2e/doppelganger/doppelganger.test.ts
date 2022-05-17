import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {createAttesterDuty, getAndInitDevValidators} from "../../utils/node/validator";
import {ChainEvent} from "../../../src/chain";
import {Network} from "../../../src/network";
import {connect} from "../../utils/network";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";
import {fromHexString} from "@chainsafe/ssz";
import {generateAttestationData} from "@chainsafe/lodestar-beacon-state-transition/test/utils/attestation";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

chai.use(chaiAsPromised);

/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
describe("doppelganger / doppelganger test", function () {
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const validatorCount = 1;
  const genesisSlotsDelay = 5;
  const beaconParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
  };

  const timeout = (SLOTS_PER_EPOCH + genesisSlotsDelay) * beaconParams.SECONDS_PER_SLOT * 1000;

  it("should not have doppelganger protection if started before genesis", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const committeeIndex = 0;
    const validatorIndex = 0;

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
    });
    afterEachCallbacks.push(() => Promise.all(validatorsWithDoppelganger.map((v) => v.stop())));

    await Promise.all(validatorsWithDoppelganger.map((validator) => validator.start()));

    const validatorUnderTest = validatorsWithDoppelganger[0];
    const pubKey = validatorUnderTest.validatorStore.votingPubkeys()[0];
    const beaconBlock = ssz.allForks.phase0.BeaconBlock.defaultValue();

    await expect(
      validatorUnderTest.validatorStore.signBlock(fromHexString(pubKey), beaconBlock, bn.chain.clock.currentSlot),
      "Signing should be possible if starting at genesis since doppelganger should be off"
    ).to.eventually.be.fulfilled;

    await expect(
      validatorUnderTest.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(pubKey), bn.chain.clock.currentSlot, committeeIndex, validatorIndex),
        generateAttestationData(
          bn.chain.clock.currentEpoch - 1,
          bn.chain.clock.currentEpoch,
          bn.chain.clock.currentSlot
        ),
        bn.chain.clock.currentEpoch
      ),
      "Signing should be possible if starting at genesis since doppelganger should be off"
    ).to.eventually.be.fulfilled;
  });

  it("should shut down validator if same key is active and started after genesis", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("Node-B", testLoggerOpts);

    // set genesis time 2 slots in the past
    const genesisTime = Math.floor(Date.now() / 1000) - 2 * beaconParams.SECONDS_PER_SLOT;
    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
      genesisTime,
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

    expect(validators[0].getStatus()).to.be.equal(
      "running",
      "validator without doppelganger protection should be running"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equal(
      "running",
      "validator with doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.clockEpoch, timeout);
    // After first epoch doppelganger protection should have stopped the validatorsWithDoppelganger
    expect(validators[0].getStatus()).to.be.equal(
      "running",
      "validator without doppelganger protection should still be running after first epoch"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equal(
      "stopped",
      "validator with doppelganger protection should be stopped after first epoch"
    );
  });

  it("should shut down validator if same key is active with same BN and started after genesis", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    // set genesis time 2 slots in the past
    const genesisTime = Math.floor(Date.now() / 1000) - 2 * beaconParams.SECONDS_PER_SLOT;
    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount: 1,
      logger: loggerNodeA,
      genesisTime,
    });
    afterEachCallbacks.push(() => bn.close());

    const {validators: validator0WithDoppelganger} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
      enableDoppelganger,
    });
    afterEachCallbacks.push(() => Promise.all(validator0WithDoppelganger.map((v) => v.stop())));

    const {validators: validator0WithoutDoppelganger} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
      enableDoppelganger: false,
    });
    afterEachCallbacks.push(() => Promise.all(validator0WithoutDoppelganger.map((v) => v.stop())));

    await Promise.all(
      [...validator0WithDoppelganger, ...validator0WithoutDoppelganger].map((validator) => validator.start())
    );

    expect(validator0WithDoppelganger[0].getStatus()).to.be.equal(
      "running",
      "validator with doppelganger protection should be running"
    );
    expect(validator0WithoutDoppelganger[0].getStatus()).to.be.equal(
      "running",
      "validator without doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout);
    //After first epoch doppelganger protection should have stopped the validator0WithDoppelganger
    expect(validator0WithoutDoppelganger[0].getStatus()).to.be.equal(
      "running",
      "validator without doppelganger protection should still be running after first epoch"
    );
    expect(validator0WithDoppelganger[0].getStatus()).to.be.equal(
      "stopped",
      "validator with doppelganger protection should be stopped after first epoch"
    );
  });

  it("should not shut down validator if key is different", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
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

    expect(validators[0].getStatus()).to.be.equal(
      "running",
      "validator without doppelganger protection should be running"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equal(
      "running",
      "validator with doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.clockEpoch, timeout);
    expect(validators[0].getStatus()).to.be.equal(
      "running",
      "validator without doppelganger protection should still be running after first epoch"
    );
    expect(validatorsWithDoppelganger[0].getStatus()).to.be.equal(
      "running",
      "validator with doppelganger protection should still be active after first epoch"
    );
  });

  it("should not sign block if doppelganger period has not passed and not started at genesis", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    // set genesis time 2 slots in the past
    const genesisTime = Math.floor(Date.now() / 1000) - 2 * beaconParams.SECONDS_PER_SLOT;
    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
      genesisTime,
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
    });
    afterEachCallbacks.push(() => Promise.all(validatorsWithDoppelganger.map((v) => v.stop())));

    await Promise.all(validatorsWithDoppelganger.map((validator) => validator.start()));

    const validatorUnderTest = validatorsWithDoppelganger[0];
    const pubKey = validatorUnderTest.validatorStore.votingPubkeys()[0];
    const beaconBlock = ssz.allForks.phase0.BeaconBlock.defaultValue();

    await expect(
      validatorUnderTest.validatorStore.signBlock(fromHexString(pubKey), beaconBlock, bn.chain.clock.currentSlot)
    ).to.eventually.be.rejectedWith("Doppelganger protection status is: Unknown");

    await expect(
      validatorUnderTest.validatorStore.signBlock(fromHexString(pubKey), beaconBlock, bn.chain.clock.currentSlot)
    ).to.eventually.be.rejectedWith("Doppelganger protection status is: Unverified");

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout);

    await expect(
      validatorUnderTest.validatorStore.signBlock(fromHexString(pubKey), beaconBlock, bn.chain.clock.currentSlot),
      "Signing should be possible after doppelganger check has elapsed"
    ).to.eventually.be.fulfilled;
  });

  it("should not sign attestations if doppelganger period has not passed and started after genesis", async function () {
    this.timeout("10 min");

    const enableDoppelganger = true;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);
    // set genesis time 2 slots in the past
    const genesisTime = Math.floor(Date.now() / 1000) - 2 * beaconParams.SECONDS_PER_SLOT;

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
      genesisTime,
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
    });
    afterEachCallbacks.push(() => Promise.all(validatorsWithDoppelganger.map((v) => v.stop())));

    await Promise.all(validatorsWithDoppelganger.map((validator) => validator.start()));

    const validatorUnderTest = validatorsWithDoppelganger[0];
    const pubKey = validatorUnderTest.validatorStore.votingPubkeys()[0];
    const committeeIndex = 0;
    const validatorIndex = 0;

    await expect(
      validatorUnderTest.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(pubKey), bn.chain.clock.currentSlot, committeeIndex, validatorIndex),
        generateAttestationData(bn.chain.clock.currentEpoch, bn.chain.clock.currentEpoch),
        bn.chain.clock.currentEpoch
      )
    ).to.eventually.be.rejectedWith("Doppelganger protection status is: Unknown");

    await expect(
      validatorUnderTest.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(pubKey), bn.chain.clock.currentSlot, committeeIndex, validatorIndex),
        generateAttestationData(bn.chain.clock.currentSlot, bn.chain.clock.currentEpoch),
        bn.chain.clock.currentEpoch
      )
    ).to.eventually.be.rejectedWith("Doppelganger protection status is: Unverified");

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout);

    await expect(
      validatorUnderTest.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(pubKey), bn.chain.clock.currentSlot, committeeIndex, validatorIndex),
        generateAttestationData(
          bn.chain.clock.currentEpoch - 1,
          bn.chain.clock.currentEpoch,
          bn.chain.clock.currentSlot
        ),
        bn.chain.clock.currentEpoch
      ),
      "Signing should be possible after doppelganger check has elapsed"
    ).to.eventually.be.fulfilled;
  });
});
