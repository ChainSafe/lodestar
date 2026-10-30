import {createBeaconConfig} from "@lodestar/config";
import {
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  createCachedBeaconState,
  createEmptyEpochCacheImmutableData,
  processSlots,
  stateTransition,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {SecretKey} from "../src/blst.js";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";

describe("BeaconStateView proposerRewards", () => {
  it("should report the last block's rewards with Lodestar parity and reset them on cloning", () => {
    const value = ssz.altair.BeaconState.defaultValue();
    const validatorCount = 64;
    value.slot = 1;
    value.validators = Array.from({length: validatorCount}, (_, index) => {
      const secret = new Uint8Array(32);
      secret[31] = index + 1;
      return {
        ...ssz.phase0.Validator.defaultValue(),
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        effectiveBalance: 32_000_000_000,
        exitEpoch: Infinity,
        pubkey: SecretKey.fromBytes(secret).toPublicKey().toBytes(),
        withdrawableEpoch: Infinity,
      };
    });
    value.balances = Array.from({length: validatorCount}, () => 32_000_000_000);
    value.previousEpochParticipation = Array.from({length: validatorCount}, () => 0);
    value.currentEpochParticipation = Array.from({length: validatorCount}, () => 0);
    value.inactivityScores = Array.from({length: validatorCount}, () => 0);
    const committeeSize = value.currentSyncCommittee.pubkeys.length;
    value.currentSyncCommittee.pubkeys = Array.from(
      {length: committeeSize},
      (_, index) => value.validators[index % validatorCount].pubkey
    );
    value.currentSyncCommittee.aggregatePubkey = value.validators[0].pubkey;
    value.nextSyncCommittee = value.currentSyncCommittee;

    const config = createBeaconConfig(
      {
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: Infinity,
        CAPELLA_FORK_EPOCH: Infinity,
        DENEB_FORK_EPOCH: Infinity,
        ELECTRA_FORK_EPOCH: Infinity,
        FULU_FORK_EPOCH: Infinity,
        GLOAS_FORK_EPOCH: Infinity,
      },
      value.genesisValidatorsRoot
    );
    value.fork.currentVersion = config.ALTAIR_FORK_VERSION;
    const nativeConfig = new bindings.BeaconConfig(config, value.genesisValidatorsRoot);
    pubkeyCache.ensureCapacity(validatorCount);
    pubkeyCache.syncPubkeys(value.validators);

    const reference = createCachedBeaconState(
      ssz.altair.BeaconState.toViewDU(value),
      createEmptyEpochCacheImmutableData(config, value)
    );
    const native = bindings.BeaconStateView.createFromBytes(ssz.altair.BeaconState.serialize(value), nativeConfig);
    const prepared = processSlots(reference, 2);
    const block = ssz.altair.SignedBeaconBlock.defaultValue();
    block.message.slot = 2;
    block.message.proposerIndex = prepared.epochCtx.getBeaconProposer(2);
    block.message.parentRoot = prepared.latestBlockHeader.hashTreeRoot();
    block.message.body.syncAggregate.syncCommitteeBits.set(0, true);
    block.message.body.syncAggregate.syncCommitteeBits.set(validatorCount, true);

    const attestation = ssz.phase0.Attestation.defaultValue();
    attestation.data.slot = 1;
    attestation.data.beaconBlockRoot = prepared.blockRoots.get(1);
    attestation.data.target.root = prepared.blockRoots.get(0);
    const committee = prepared.epochCtx.getBeaconCommittee(1, 0);
    const aggregationBytes = new Uint8Array(Math.floor(committee.length / 8) + 1);
    for (let index = 0; index <= committee.length; index++) {
      aggregationBytes[Math.floor(index / 8)] |= 1 << (index % 8);
    }
    attestation.aggregationBits = ssz.phase0.Attestation.fields.aggregationBits.deserialize(aggregationBytes);
    block.message.body.attestations.push(attestation);

    for (let offset = 1; offset <= 2; offset++) {
      const slashing = ssz.phase0.ProposerSlashing.defaultValue();
      const slashedIndex = (block.message.proposerIndex + offset) % validatorCount;
      slashing.signedHeader1.message.proposerIndex = slashedIndex;
      slashing.signedHeader2.message.proposerIndex = slashedIndex;
      slashing.signedHeader2.message.bodyRoot[0] = 1;
      block.message.body.proposerSlashings.push(slashing);
    }

    const options = {
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    };
    const expected = stateTransition(reference, block, options);
    const actual = native.stateTransition(ssz.altair.SignedBeaconBlock.serialize(block), false, options);
    expect(expected.proposerRewards.attestations).toBeGreaterThan(0);
    expect(expected.proposerRewards.syncAggregate).toBeGreaterThan(0);
    expect(expected.proposerRewards.slashing).toBeGreaterThan(0);
    expect(actual.proposerRewards).toEqual(expected.proposerRewards);
    expect(actual.hashTreeRoot()).toEqual(expected.hashTreeRoot());
    expect(native.proposerRewards).toEqual({attestations: 0, slashing: 0, syncAggregate: 0});

    const nextReference = processSlots(expected, 3);
    const nextNative = actual.processSlots(3);
    expect(nextNative.proposerRewards).toEqual({attestations: 0, slashing: 0, syncAggregate: 0});
    expect(actual.proposerRewards).toEqual(expected.proposerRewards);

    const emptyBlock = ssz.altair.SignedBeaconBlock.defaultValue();
    emptyBlock.message.slot = 3;
    emptyBlock.message.proposerIndex = nextReference.epochCtx.getBeaconProposer(3);
    emptyBlock.message.parentRoot = nextReference.latestBlockHeader.hashTreeRoot();
    const expectedEmpty = stateTransition(expected, emptyBlock, options);
    const actualEmpty = actual.stateTransition(ssz.altair.SignedBeaconBlock.serialize(emptyBlock), false, options);
    expect(actualEmpty.proposerRewards).toEqual({attestations: 0, slashing: 0, syncAggregate: 0});
    expect(actualEmpty.proposerRewards).toEqual(expectedEmpty.proposerRewards);
    expect(actualEmpty.hashTreeRoot()).toEqual(expectedEmpty.hashTreeRoot());
  });
});
