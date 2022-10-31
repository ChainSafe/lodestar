import {toHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {processSlots} from "@lodestar/state-transition";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {AttestationErrorCode} from "../../../../src/chain/errors/index.js";
import {validateGossipAggregateAndProof} from "../../../../src/chain/validation/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
// eslint-disable-next-line import/no-relative-packages
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {memoOnce} from "../../../utils/cache.js";
import {
  getAggregateAndProofValidData,
  AggregateAndProofValidDataOpts,
} from "../../../utils/validationData/aggregateAndProof.js";
import {IStateRegenerator} from "../../../../src/chain/regen/interface.js";

describe("chain / validation / aggregateAndProof", () => {
  const vc = 64;
  const stateSlot = 100;

  const UNKNOWN_ROOT = Buffer.alloc(32, 1);
  const KNOWN_TARGET_ROOT = Buffer.alloc(32, 0xd0);
  const KNOWN_BEACON_BLOCK_ROOT = Buffer.alloc(32, 0xd1);

  const getState = memoOnce(() => generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}));

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function getValidData(opts?: Partial<AggregateAndProofValidDataOpts>) {
    return getAggregateAndProofValidData({
      currentSlot: stateSlot,
      attSlot: opts?.currentSlot ?? stateSlot,
      attIndex: 1,
      bitIndex: 1,
      targetRoot: KNOWN_TARGET_ROOT,
      beaconBlockRoot: KNOWN_BEACON_BLOCK_ROOT,
      state: getState(),
      ...opts,
    });
  }

  it("Valid", async () => {
    const {chain, signedAggregateAndProof} = getValidData({});

    await validateGossipAggregateAndProof(chain, signedAggregateAndProof);
  });

  it("BAD_TARGET_EPOCH", async () => {
    const {chain, signedAggregateAndProof} = getValidData({});

    // Change target epoch to it doesn't match data.slot
    signedAggregateAndProof.message.aggregate.data.target.epoch += 1;

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.BAD_TARGET_EPOCH);
  });

  it("PAST_SLOT", async () => {
    // Set attestation at a very old slot
    const {chain, signedAggregateAndProof} = getValidData({attSlot: stateSlot - SLOTS_PER_EPOCH - 3});

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.PAST_SLOT);
  });

  it("FUTURE_SLOT", async () => {
    // Set attestation to a future slot
    const {chain, signedAggregateAndProof} = getValidData({attSlot: stateSlot + 2});

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.FUTURE_SLOT);
  });

  it("ATTESTING_INDICES_ALREADY_KNOWN", async () => {
    const {chain, signedAggregateAndProof} = getValidData();
    const {aggregationBits} = signedAggregateAndProof.message.aggregate;
    const attData = signedAggregateAndProof.message.aggregate.data;
    // Register attester as already seen
    chain.seenAggregatedAttestations.add(
      attData.target.epoch,
      toHexString(ssz.phase0.AttestationData.hashTreeRoot(attData)),
      {aggregationBits, trueBitCount: aggregationBits.getTrueBitIndexes().length},
      false
    );

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.ATTESTERS_ALREADY_KNOWN);
  });

  it("AGGREGATOR_ALREADY_KNOWN", async () => {
    const {chain, signedAggregateAndProof} = getValidData();
    // Register attester as already seen
    chain.seenAggregators.add(
      signedAggregateAndProof.message.aggregate.data.target.epoch,
      signedAggregateAndProof.message.aggregatorIndex
    );

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN);
  });

  it("UNKNOWN_BEACON_BLOCK_ROOT", async () => {
    const {chain, signedAggregateAndProof} = getValidData();
    // Set beaconBlockRoot to a root not known by the fork choice
    signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = UNKNOWN_ROOT;

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT);
  });

  it("INVALID_TARGET_ROOT", async () => {
    const {chain, signedAggregateAndProof} = getValidData();
    // Set target.root to an unknown root
    signedAggregateAndProof.message.aggregate.data.target.root = UNKNOWN_ROOT;

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.INVALID_TARGET_ROOT);
  });

  it("NO_COMMITTEE_FOR_SLOT_AND_INDEX", async () => {
    const {chain, signedAggregateAndProof} = getValidData();
    // slot is out of the commitee range
    // simulate https://github.com/ChainSafe/lodestar/issues/4396
    // this way we cannot get committeeIndices
    const committeeState = processSlots(
      getState(),
      signedAggregateAndProof.message.aggregate.data.slot + 2 * SLOTS_PER_EPOCH
    );
    (chain as {regen: IStateRegenerator}).regen = ({
      getState: async () => committeeState,
    } as Partial<IStateRegenerator>) as IStateRegenerator;

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX);
  });

  it("EMPTY_AGGREGATION_BITFIELD", async () => {
    const {chain, signedAggregateAndProof} = getValidData();
    // Unset all aggregationBits
    const {aggregationBits} = signedAggregateAndProof.message.aggregate;
    for (let i = 0, len = aggregationBits.bitLen; i < len; i++) {
      aggregationBits.set(i, false);
    }

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.EMPTY_AGGREGATION_BITFIELD);
  });

  // TODO: Need to manipulate state quite a bit to force modulo > 1. When the state has a low validator count
  // all validators are aggregators.
  it.skip("INVALID_AGGREGATOR", async () => {
    const {chain, signedAggregateAndProof} = getValidData();

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.INVALID_AGGREGATOR);
  });

  it("AGGREGATOR_NOT_IN_COMMITTEE", async () => {
    const attIndex = 1;
    const {chain, signedAggregateAndProof} = getValidData({attIndex});
    // Change the attestation index so the aggregator is not longer in the valid committee
    signedAggregateAndProof.message.aggregate.data.index = attIndex - 1;

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE);
  });

  it("INVALID_SIGNATURE - selection proof sig", async () => {
    const bitIndex = 1;
    const {chain, signedAggregateAndProof} = getValidData({bitIndex});
    // Swap the selectionProof signature with the overall sig of the object
    signedAggregateAndProof.message.selectionProof = signedAggregateAndProof.signature;

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.INVALID_SIGNATURE);
  });

  it("INVALID_SIGNATURE - aggregate sig", async () => {
    const bitIndex = 1;
    const {chain, signedAggregateAndProof} = getValidData({bitIndex});
    // Swap the selectionProof signature with the overall sig of the object
    signedAggregateAndProof.signature = signedAggregateAndProof.message.selectionProof;

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.INVALID_SIGNATURE);
  });

  it("INVALID_SIGNATURE - attestation sig", async () => {
    const bitIndex = 1;
    const {chain, signedAggregateAndProof} = getValidData({bitIndex});
    // Change the bit index so the signature is validated against a different pubkey
    signedAggregateAndProof.message.aggregate.aggregationBits.set(bitIndex, false);
    signedAggregateAndProof.message.aggregate.aggregationBits.set(bitIndex + 1, true);

    await expectError(chain, signedAggregateAndProof, AttestationErrorCode.INVALID_SIGNATURE);
  });

  /** Alias to reduce code duplication */
  async function expectError(
    chain: IBeaconChain,
    signedAggregateAndProof: phase0.SignedAggregateAndProof,
    errorCode: AttestationErrorCode
  ): Promise<void> {
    await expectRejectedWithLodestarError(validateGossipAggregateAndProof(chain, signedAggregateAndProof), errorCode);
  }
});
