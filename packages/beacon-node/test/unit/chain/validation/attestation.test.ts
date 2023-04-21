import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BitArray} from "@chainsafe/ssz";
import {processSlots} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {AttestationErrorCode, GossipErrorCode} from "../../../../src/chain/errors/index.js";
import {AttestationOrBytes, validateGossipAttestation} from "../../../../src/chain/validation/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {memoOnce} from "../../../utils/cache.js";
import {getAttestationValidData, AttestationValidDataOpts} from "../../../utils/validationData/attestation.js";
import {IStateRegenerator} from "../../../../src/chain/regen/interface.js";

describe("chain / validation / attestation", () => {
  const vc = 64;
  const stateSlot = 100;

  const UNKNOWN_ROOT = Buffer.alloc(32, 1);
  const KNOWN_TARGET_ROOT = Buffer.alloc(32, 0xd0);
  const KNOWN_BEACON_BLOCK_ROOT = Buffer.alloc(32, 0xd1);

  const getState = memoOnce(() => generateTestCachedBeaconStateOnlyValidators({vc, slot: stateSlot}));

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function getValidData(opts?: Partial<AttestationValidDataOpts>) {
    return getAttestationValidData({
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
    const {chain, attestation, subnet} = getValidData();

    await validateGossipAttestation(chain, {attestation, serializedData: null}, subnet);
  });

  it("INVALID_SERIALIZED_BYTES_ERROR_CODE", async () => {
    const {chain, subnet} = getValidData();
    await expectError(
      chain,
      {attestation: null, serializedData: Buffer.alloc(0), attSlot: 0},
      subnet,
      GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE
    );
  });

  it("BAD_TARGET_EPOCH", async () => {
    const {chain, attestation, subnet} = getValidData();

    // Change target epoch to it doesn't match data.slot
    attestation.data.target.epoch += 1;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(chain, {attestation, serializedData: null}, subnet, AttestationErrorCode.BAD_TARGET_EPOCH);
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.BAD_TARGET_EPOCH
    );
  });

  it("PAST_SLOT", async () => {
    // Set attestation at a very old slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot - SLOTS_PER_EPOCH - 3});
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(chain, {attestation, serializedData: null}, subnet, AttestationErrorCode.PAST_SLOT);
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.PAST_SLOT
    );
  });

  it("FUTURE_SLOT", async () => {
    // Set attestation to a future slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot + 2});
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(chain, {attestation, serializedData: null}, subnet, AttestationErrorCode.FUTURE_SLOT);
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.FUTURE_SLOT
    );
  });

  it("NOT_EXACTLY_ONE_AGGREGATION_BIT_SET - 0 bits", async () => {
    // Unset the single aggregationBits
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    attestation.aggregationBits.set(bitIndex, false);
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(
      chain,
      {attestation, serializedData: null},
      subnet,
      AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET
    );
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET
    );
  });

  it("NOT_EXACTLY_ONE_AGGREGATION_BIT_SET - 2 bits", async () => {
    // Set an extra bit in the attestation
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    attestation.aggregationBits.set(bitIndex + 1, true);
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET
    );
  });

  it("UNKNOWN_BEACON_BLOCK_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set beaconBlockRoot to a root not known by the fork choice
    attestation.data.beaconBlockRoot = UNKNOWN_ROOT;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(
      chain,
      {attestation, serializedData: null},
      subnet,
      AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT
    );
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT
    );
  });

  it("INVALID_TARGET_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set target.root to an unknown root
    attestation.data.target.root = UNKNOWN_ROOT;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(chain, {attestation, serializedData: null}, subnet, AttestationErrorCode.INVALID_TARGET_ROOT);
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.INVALID_TARGET_ROOT
    );
  });

  it("NO_COMMITTEE_FOR_SLOT_AND_INDEX", async () => {
    const {chain, attestation, subnet} = getValidData();
    // slot is out of the commitee range
    // simulate https://github.com/ChainSafe/lodestar/issues/4396
    // this way we cannot get committeeIndices
    const committeeState = processSlots(getState(), attestation.data.slot + 2 * SLOTS_PER_EPOCH);
    (chain as {regen: IStateRegenerator}).regen = {
      getState: async () => committeeState,
    } as Partial<IStateRegenerator> as IStateRegenerator;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(
      chain,
      {attestation, serializedData: null},
      subnet,
      AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX
    );
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX
    );
  });

  it("WRONG_NUMBER_OF_AGGREGATION_BITS", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Increase the length of aggregationBits beyond the committee size
    attestation.aggregationBits = new BitArray(
      attestation.aggregationBits.uint8Array,
      attestation.aggregationBits.bitLen + 1
    );
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(
      chain,
      {attestation, serializedData: null},
      subnet,
      AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS
    );
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS
    );
  });

  it("INVALID_SUBNET_ID", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Pass a different subnet value than the correct one
    const invalidSubnet = subnet === 0 ? 1 : 0;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(
      chain,
      {attestation, serializedData: null},
      invalidSubnet,
      AttestationErrorCode.INVALID_SUBNET_ID
    );
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      invalidSubnet,
      AttestationErrorCode.INVALID_SUBNET_ID
    );
  });

  it("ATTESTATION_ALREADY_KNOWN", async () => {
    const {chain, attestation, subnet, validatorIndex} = getValidData();
    // Register attester as already seen
    chain.seenAttesters.add(attestation.data.target.epoch, validatorIndex);
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(
      chain,
      {attestation, serializedData: null},
      subnet,
      AttestationErrorCode.ATTESTATION_ALREADY_KNOWN
    );
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.ATTESTATION_ALREADY_KNOWN
    );
  });

  it("INVALID_SIGNATURE", async () => {
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    // Change the bit index so the signature is validated against a different pubkey
    attestation.aggregationBits.set(bitIndex, false);
    attestation.aggregationBits.set(bitIndex + 1, true);
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectError(chain, {attestation, serializedData: null}, subnet, AttestationErrorCode.INVALID_SIGNATURE);
    await expectError(
      chain,
      {attestation: null, serializedData, attSlot: attestation.data.slot},
      subnet,
      AttestationErrorCode.INVALID_SIGNATURE
    );
  });

  /** Alias to reduce code duplication */
  async function expectError(
    chain: IBeaconChain,
    attestationOrBytes: AttestationOrBytes,
    subnet: number,
    errorCode: string
  ): Promise<void> {
    await expectRejectedWithLodestarError(validateGossipAttestation(chain, attestationOrBytes, subnet), errorCode);
  }
});
