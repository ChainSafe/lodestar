import {expect} from "chai";
import {routes} from "@lodestar/api/beacon";
import {BLSPubkey, phase0, Slot, ssz} from "@lodestar/types";
import {IChainConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {fromHexString} from "@chainsafe/ssz";
import {Validator} from "@lodestar/validator";
import {PubkeyHex} from "@lodestar/validator/src/types";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {Network} from "../../../src/network/index.js";
import {connect} from "../../utils/network.js";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {generateAttestationData} from "../../utils/attestation.js";
import {BeaconNode} from "../../../src/node/index.js";

/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
// TODO: Reconsider this tests latter.
// Doppelganger testing can be split in two items:
// 1. Can a running beacon node detect liveness of the validator?
// 2. Does the validator use the liveness data to identify doppelganger correctly?
//
// Attempting to do both 1. and 2. in this e2e test more expensive than necessary.
// Unit tests in the validator cover 2., so some test in lodestar package should cover 1.
describe.skip("doppelganger / doppelganger test", function () {
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

  type TestConfig = {
    genesisTime?: number;
    doppelgangerProtectionEnabled?: boolean;
  };

  async function createBNAndVC(config?: TestConfig): Promise<{beaconNode: BeaconNode; validators: Validator[]}> {
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {
        sync: {isSingleNode: true},
        api: {rest: {enabled: false}},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      logger: loggerNodeA,
      genesisTime: config?.genesisTime,
    });

    afterEachCallbacks.push(() => bn.close());

    const {validators: validatorsWithDoppelganger} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
      doppelgangerProtectionEnabled: config?.doppelgangerProtectionEnabled,
    });
    afterEachCallbacks.push(() => Promise.all(validatorsWithDoppelganger.map((v) => v.close())));

    return {beaconNode: bn, validators: validatorsWithDoppelganger};
  }

  it("should not have doppelganger protection if started before genesis", async function () {
    this.timeout("10 min");

    const committeeIndex = 0;
    const validatorIndex = 0;

    const {beaconNode: bn, validators: validatorsWithDoppelganger} = await createBNAndVC({
      doppelgangerProtectionEnabled: true,
    });

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
          committeeIndex,
          bn.chain.clock.currentSlot
        ),
        bn.chain.clock.currentEpoch
      ),
      "Signing should be possible if starting at genesis since doppelganger should be off"
    ).to.eventually.be.fulfilled;
  });

  it("should shut down validator if same key is active and started after genesis", async function () {
    this.timeout("10 min");

    // set genesis time to allow at least an epoch
    const genesisTime = Math.floor(Date.now() / 1000) - SLOTS_PER_EPOCH * beaconParams.SECONDS_PER_SLOT;

    const {beaconNode: bn, validators: validatorsWithDoppelganger} = await createBNAndVC({
      genesisTime,
      doppelgangerProtectionEnabled: true,
    });

    const {beaconNode: bn2, validators: validators} = await createBNAndVC({
      genesisTime: bn.chain.getHeadState().genesisTime,
    });

    await connect(bn2.network as Network, bn.network.peerId, bn.network.localMultiaddrs);

    expect(validators[0].isRunning).to.be.equal(true, "validator without doppelganger protection should be running");
    expect(validatorsWithDoppelganger[0].isRunning).to.be.equal(
      true,
      "validator with doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.clockEpoch, timeout);
    // After first epoch doppelganger protection should have stopped the validatorsWithDoppelganger
    expect(validators[0].isRunning).to.be.equal(
      true,
      "validator without doppelganger protection should still be running after first epoch"
    );
    const pubkeyOfIndex: PubkeyHex = validatorsWithDoppelganger[0].validatorStore.getPubkeyOfIndex(0) as PubkeyHex;
    expect(validatorsWithDoppelganger[0].validatorStore.isDoppelgangerSafe(pubkeyOfIndex)).to.be.equal(
      false,
      "validator with doppelganger protection should be stopped after first epoch"
    );
  });

  it("should shut down validator if same key is active with same BN and started after genesis", async function () {
    this.timeout("10 min");

    const doppelgangerProtectionEnabled = true;
    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};

    // set genesis time to allow at least an epoch
    const genesisTime = Math.floor(Date.now() / 1000) - SLOTS_PER_EPOCH * beaconParams.SECONDS_PER_SLOT;

    const {beaconNode: bn, validators: validator0WithDoppelganger} = await createBNAndVC({
      genesisTime,
      doppelgangerProtectionEnabled,
    });

    const {validators: validator0WithoutDoppelganger} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
      doppelgangerProtectionEnabled: false,
    });
    afterEachCallbacks.push(() => Promise.all(validator0WithoutDoppelganger.map((v) => v.close())));

    expect(validator0WithDoppelganger[0].isRunning).to.be.equal(
      true,
      "validator with doppelganger protection should be running"
    );
    expect(validator0WithoutDoppelganger[0].isRunning).to.be.equal(
      true,
      "validator without doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout);
    //After first epoch doppelganger protection should have stopped the validator0WithDoppelganger
    expect(validator0WithoutDoppelganger[0].isRunning).to.be.equal(
      true,
      "validator without doppelganger protection should still be running after first epoch"
    );
    const pubkeyOfIndex: PubkeyHex = validator0WithDoppelganger[0].validatorStore.getPubkeyOfIndex(0) as PubkeyHex;
    expect(validator0WithDoppelganger[0].validatorStore.isDoppelgangerSafe(pubkeyOfIndex)).to.be.equal(
      false,
      "validator with doppelganger protection should be stopped after first epoch"
    );
  });

  it("should not shut down validator if key is different", async function () {
    this.timeout("10 min");

    const doppelgangerProtectionEnabled = true;

    const {beaconNode: bn, validators: validatorsWithDoppelganger} = await createBNAndVC({
      doppelgangerProtectionEnabled,
    });

    const {beaconNode: bn2, validators: validators} = await createBNAndVC({
      genesisTime: bn.chain.getHeadState().genesisTime,
      doppelgangerProtectionEnabled: false,
    });

    await connect(bn2.network as Network, bn.network.peerId, bn.network.localMultiaddrs);

    expect(validators[0].isRunning).to.be.equal(true, "validator without doppelganger protection should be running");
    expect(validatorsWithDoppelganger[0].isRunning).to.be.equal(
      true,
      "validator with doppelganger protection should be running before first epoch"
    );
    await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.clockEpoch, timeout);
    expect(validators[0].isRunning).to.be.equal(
      true,
      "validator without doppelganger protection should still be running after first epoch"
    );
    expect(validatorsWithDoppelganger[0].isRunning).to.be.equal(
      true,
      "validator with doppelganger protection should still be active after first epoch"
    );
  });

  it("should not sign block if doppelganger period has not passed and not started at genesis", async function () {
    this.timeout("10 min");

    const doppelgangerProtectionEnabled = true;

    // set genesis time to allow at least an epoch
    const genesisTime = Math.floor(Date.now() / 1000) - SLOTS_PER_EPOCH * beaconParams.SECONDS_PER_SLOT;

    const {beaconNode: bn, validators: validatorsWithDoppelganger} = await createBNAndVC({
      genesisTime,
      doppelgangerProtectionEnabled,
    });

    const validatorUnderTest = validatorsWithDoppelganger[0];
    const pubKey = validatorUnderTest.validatorStore.votingPubkeys()[0];
    const beaconBlock = ssz.allForks.phase0.BeaconBlock.defaultValue();

    await expect(
      validatorUnderTest.validatorStore.signBlock(fromHexString(pubKey), beaconBlock, bn.chain.clock.currentSlot)
    ).to.eventually.be.rejectedWith(`Doppelganger state for key ${pubKey} is not safe`);

    await expect(
      validatorUnderTest.validatorStore.signBlock(fromHexString(pubKey), beaconBlock, bn.chain.clock.currentSlot)
    ).to.eventually.be.rejectedWith(`Doppelganger state for key ${pubKey} is not safe`);

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout);

    await expect(
      validatorUnderTest.validatorStore.signBlock(fromHexString(pubKey), beaconBlock, bn.chain.clock.currentSlot),
      "Signing should be possible after doppelganger check has elapsed"
    ).to.eventually.be.fulfilled;
  });

  it("should not sign attestations if doppelganger period has not passed and started after genesis", async function () {
    this.timeout("10 min");

    const doppelgangerProtectionEnabled = true;

    // set genesis time to allow at least an epoch
    const genesisTime = Math.floor(Date.now() / 1000) - SLOTS_PER_EPOCH * beaconParams.SECONDS_PER_SLOT;

    const {beaconNode: bn, validators: validatorsWithDoppelganger} = await createBNAndVC({
      genesisTime,
      doppelgangerProtectionEnabled,
    });

    const validatorUnderTest = validatorsWithDoppelganger[0];
    const pubKey = validatorUnderTest.validatorStore.votingPubkeys()[0];
    const committeeIndex = 0;
    const validatorIndex = 0;

    await expect(
      validatorUnderTest.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(pubKey), bn.chain.clock.currentSlot, committeeIndex, validatorIndex),
        generateAttestationData(
          bn.chain.clock.currentEpoch,
          bn.chain.clock.currentEpoch,
          committeeIndex,
          bn.chain.clock.currentSlot
        ),
        bn.chain.clock.currentEpoch
      )
    ).to.eventually.be.rejectedWith(`Doppelganger state for key ${pubKey} is not safe`);

    await expect(
      validatorUnderTest.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(pubKey), bn.chain.clock.currentSlot, committeeIndex, validatorIndex),
        generateAttestationData(bn.chain.clock.currentSlot, bn.chain.clock.currentEpoch),
        bn.chain.clock.currentEpoch
      )
    ).to.eventually.be.rejectedWith(`Doppelganger state for key ${pubKey} is not safe`);

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout);

    await expect(
      validatorUnderTest.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(pubKey), bn.chain.clock.currentSlot, committeeIndex, validatorIndex),
        generateAttestationData(
          bn.chain.clock.currentEpoch - 1,
          bn.chain.clock.currentEpoch,
          committeeIndex,
          bn.chain.clock.currentSlot
        ),
        bn.chain.clock.currentEpoch
      ),
      "Signing should be possible after doppelganger check has elapsed"
    ).to.eventually.be.fulfilled;
  });
});

function createAttesterDuty(
  pubkey: BLSPubkey,
  currentSlot: Slot,
  committeeIndex: number,
  validatorIndex: number
): routes.validator.AttesterDuty {
  return {
    pubkey,
    validatorIndex,
    committeeIndex: committeeIndex,
    committeeLength: 1,
    committeesAtSlot: 1,
    validatorCommitteeIndex: 0,
    slot: currentSlot,
  };
}
