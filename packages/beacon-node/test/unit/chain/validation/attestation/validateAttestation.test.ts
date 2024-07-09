import {BitArray} from "@chainsafe/ssz";
import {describe, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
// eslint-disable-next-line import/no-relative-packages
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../../state-transition/test/perf/util.js";
import {AttestationErrorCode, GossipErrorCode} from "../../../../../src/chain/errors/index.js";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {
  ApiAttestation,
  GossipAttestation,
  validateApiAttestation,
  validateAttestation,
} from "../../../../../src/chain/validation/index.js";
import {getAttDataBase64FromAttestationSerialized} from "../../../../../src/util/sszBytes.js";
import {memoOnce} from "../../../../utils/cache.js";
import {expectRejectedWithLodestarError} from "../../../../utils/errors.js";
import {AttestationValidDataOpts, getAttestationValidData} from "../../../../utils/validationData/attestation.js";

describe("validateAttestation", () => {
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
    const {chain, attestation} = getValidData();

    const fork = chain.config.getForkName(stateSlot);
    await validateApiAttestation(fork, chain, {attestation, serializedData: null});
  });

  it("INVALID_SERIALIZED_BYTES_ERROR_CODE", async () => {
    const {chain, subnet} = getValidData();
    await expectGossipError(
      chain,
      {attestation: null, serializedData: Buffer.alloc(0), attSlot: 0, attDataBase64: "invalid"},
      subnet,
      GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE
    );
  });

  it("BAD_TARGET_EPOCH", async () => {
    const {chain, attestation, subnet} = getValidData();

    // Change target epoch to it doesn't match data.slot
    attestation.data.target.epoch += 1;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectApiError(chain, {attestation, serializedData: null}, AttestationErrorCode.BAD_TARGET_EPOCH);
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      subnet,
      AttestationErrorCode.BAD_TARGET_EPOCH
    );
  });

  it("PAST_SLOT", async () => {
    // Set attestation at a very old slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot - SLOTS_PER_EPOCH - 3});
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectApiError(chain, {attestation, serializedData: null}, AttestationErrorCode.PAST_SLOT);
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      subnet,
      AttestationErrorCode.PAST_SLOT
    );
  });

  it("FUTURE_SLOT", async () => {
    // Set attestation to a future slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot + 2});
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectApiError(chain, {attestation, serializedData: null}, AttestationErrorCode.FUTURE_SLOT);
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
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

    await expectApiError(
      chain,
      {attestation, serializedData: null},
      AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET
    );
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
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

    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      subnet,
      AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET
    );
  });

  it("UNKNOWN_BEACON_BLOCK_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set beaconBlockRoot to a root not known by the fork choice
    attestation.data.beaconBlockRoot = UNKNOWN_ROOT;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectApiError(
      chain,
      {attestation, serializedData: null},
      AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT
    );
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      subnet,
      AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT
    );
  });

  it("INVALID_TARGET_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set target.root to an unknown root
    attestation.data.target.root = UNKNOWN_ROOT;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectApiError(chain, {attestation, serializedData: null}, AttestationErrorCode.INVALID_TARGET_ROOT);
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      subnet,
      AttestationErrorCode.INVALID_TARGET_ROOT
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

    await expectApiError(
      chain,
      {attestation, serializedData: null},
      AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS
    );
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      subnet,
      AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS
    );
  });

  it("INVALID_SUBNET_ID", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Pass a different subnet value than the correct one
    const invalidSubnet = subnet === 0 ? 1 : 0;
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      invalidSubnet,
      AttestationErrorCode.INVALID_SUBNET_ID
    );
  });

  it("ATTESTATION_ALREADY_KNOWN", async () => {
    const {chain, attestation, subnet, validatorIndex} = getValidData();
    // Register attester as already seen
    chain.seenAttesters.add(attestation.data.target.epoch, validatorIndex);
    const serializedData = ssz.phase0.Attestation.serialize(attestation);

    await expectApiError(chain, {attestation, serializedData: null}, AttestationErrorCode.ATTESTATION_ALREADY_KNOWN);
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
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

    await expectApiError(chain, {attestation, serializedData: null}, AttestationErrorCode.INVALID_SIGNATURE);
    await expectGossipError(
      chain,
      {
        attestation: null,
        serializedData,
        attSlot: attestation.data.slot,
        attDataBase64: getAttDataBase64FromAttestationSerialized(serializedData),
      },
      subnet,
      AttestationErrorCode.INVALID_SIGNATURE
    );
  });

  /** Alias to reduce code duplication */
  async function expectApiError(
    chain: IBeaconChain,
    attestationOrBytes: ApiAttestation,
    errorCode: string
  ): Promise<void> {
    const fork = chain.config.getForkName(stateSlot);
    await expectRejectedWithLodestarError(validateApiAttestation(fork, chain, attestationOrBytes), errorCode);
  }

  async function expectGossipError(
    chain: IBeaconChain,
    attestationOrBytes: GossipAttestation,
    subnet: number,
    errorCode: string
  ): Promise<void> {
    const fork = chain.config.getForkName(stateSlot);
    await expectRejectedWithLodestarError(validateAttestation(fork, chain, attestationOrBytes, subnet), errorCode);
  }
});
