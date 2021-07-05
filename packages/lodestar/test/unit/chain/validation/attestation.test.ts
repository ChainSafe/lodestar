import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../../src/chain";
import {AttestationErrorCode} from "../../../../src/chain/errors";
import {validateGossipAttestation} from "../../../../src/chain/validation";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {generateTestCachedBeaconStateOnlyValidators} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {memoOnce} from "../../../utils/cache";
import {getAttestationValidData, AttestationValidDataOpts} from "../../../utils/validationData/attestation";

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

    await validateGossipAttestation(chain, attestation, subnet);
  });

  it("BAD_TARGET_EPOCH", async () => {
    const {chain, attestation, subnet} = getValidData();

    // Change target epoch to it doesn't match data.slot
    attestation.data.target.epoch += 1;

    await expectError(chain, attestation, subnet, AttestationErrorCode.BAD_TARGET_EPOCH);
  });

  it("PAST_SLOT", async () => {
    // Set attestation at a very old slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot - SLOTS_PER_EPOCH - 3});

    await expectError(chain, attestation, subnet, AttestationErrorCode.PAST_SLOT);
  });

  it("FUTURE_SLOT", async () => {
    // Set attestation to a future slot
    const {chain, attestation, subnet} = getValidData({attSlot: stateSlot + 2});

    await expectError(chain, attestation, subnet, AttestationErrorCode.FUTURE_SLOT);
  });

  it("NOT_EXACTLY_ONE_AGGREGATION_BIT_SET - 0 bits", async () => {
    // Unset the single aggregationBits
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    attestation.aggregationBits[bitIndex] = false;

    await expectError(chain, attestation, subnet, AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET);
  });

  it("NOT_EXACTLY_ONE_AGGREGATION_BIT_SET - 2 bits", async () => {
    // Set an extra bit in the attestation
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    attestation.aggregationBits[bitIndex + 1] = true;

    await expectError(chain, attestation, subnet, AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET);
  });

  it("UNKNOWN_BEACON_BLOCK_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set beaconBlockRoot to a root not known by the fork choice
    attestation.data.beaconBlockRoot = UNKNOWN_ROOT;

    await expectError(chain, attestation, subnet, AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT);
  });

  it("INVALID_TARGET_ROOT", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Set target.root to an unknown root
    attestation.data.target.root = UNKNOWN_ROOT;

    await expectError(chain, attestation, subnet, AttestationErrorCode.INVALID_TARGET_ROOT);
  });

  it("WRONG_NUMBER_OF_AGGREGATION_BITS", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Increase the length of aggregationBits beyond the committee size
    attestation.aggregationBits[attestation.aggregationBits.length] = false;

    await expectError(chain, attestation, subnet, AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS);
  });

  it("INVALID_SUBNET_ID", async () => {
    const {chain, attestation, subnet} = getValidData();
    // Pass a different subnet value than the correct one
    const invalidSubnet = subnet === 0 ? 1 : 0;

    await expectError(chain, attestation, invalidSubnet, AttestationErrorCode.INVALID_SUBNET_ID);
  });

  it("ATTESTATION_ALREADY_KNOWN", async () => {
    const {chain, attestation, subnet, validatorIndex} = getValidData();
    // Register attester as already seen
    chain.seenAttesters.add(attestation.data.target.epoch, validatorIndex);

    await expectError(chain, attestation, subnet, AttestationErrorCode.ATTESTATION_ALREADY_KNOWN);
  });

  it("INVALID_SIGNATURE", async () => {
    const bitIndex = 1;
    const {chain, attestation, subnet} = getValidData({bitIndex});
    // Change the bit index so the signature is validated against a different pubkey
    attestation.aggregationBits[bitIndex] = false;
    attestation.aggregationBits[bitIndex + 1] = true;

    await expectError(chain, attestation, subnet, AttestationErrorCode.INVALID_SIGNATURE);
  });

  /** Alias to reduce code duplication */
  async function expectError(
    chain: IBeaconChain,
    attestation: phase0.Attestation,
    subnet: number,
    errorCode: AttestationErrorCode
  ): Promise<void> {
    await expectRejectedWithLodestarError(validateGossipAttestation(chain, attestation, subnet), errorCode);
  }
});
