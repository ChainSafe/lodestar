import {BitArray} from "@chainsafe/ssz";
import type {PublicKey, SecretKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {EpochDifference, ProtoBlock} from "@lodestar/fork-choice";
import {EpochShuffling, SignatureSetType, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
// eslint-disable-next-line import/no-relative-packages
import {generateTestCachedBeaconStateOnlyValidators} from "../../../../../state-transition/test/perf/util.js";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {
  AttestationError,
  AttestationErrorCode,
  GossipAction,
  GossipErrorCode,
} from "../../../../src/chain/errors/index.js";
import {
  ApiAttestation,
  GossipAttestation,
  validateApiAttestation,
  Step0Result,
  validateAttestation,
  validateGossipAttestationsSameAttData,
  getShufflingForAttestationVerification,
} from "../../../../src/chain/validation/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {memoOnce} from "../../../utils/cache.js";
import {getAttestationValidData, AttestationValidDataOpts} from "../../../utils/validationData/attestation.js";
import {RegenCaller} from "../../../../src/chain/regen/interface.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/constants.js";

import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/singleThread.js";
import {SeenAttesters} from "../../../../src/chain/seenCache/seenAttesters.js";
import {getAttDataBase64FromAttestationSerialized} from "../../../../src/util/sszBytes.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../__mocks__/mockedBeaconChain.js";

describe("validateGossipAttestationsSameAttData", () => {
  // phase0Result specifies whether the attestation is valid in phase0
  // phase1Result specifies signature verification
  const testCases: {phase0Result: boolean[]; phase1Result: boolean[]; seenAttesters: number[]}[] = [
    {
      phase0Result: [true, true, true, true, true],
      phase1Result: [true, true, true, true, true],
      seenAttesters: [0, 1, 2, 3, 4],
    },
    {
      phase0Result: [false, true, true, true, true],
      phase1Result: [true, false, true, true, true],
      seenAttesters: [2, 3, 4],
    },
    {
      phase0Result: [false, false, true, true, true],
      phase1Result: [true, false, false, true, true],
      seenAttesters: [3, 4],
    },
    {
      phase0Result: [false, false, true, true, true],
      phase1Result: [true, false, false, true, false],
      seenAttesters: [3],
    },
    {
      phase0Result: [false, false, true, true, true],
      phase1Result: [true, true, false, false, false],
      seenAttesters: [],
    },
  ];

  type Keypair = {publicKey: PublicKey; secretKey: SecretKey};
  const keypairs = new Map<number, Keypair>();
  function getKeypair(i: number): Keypair {
    let keypair = keypairs.get(i);
    if (!keypair) {
      const bytes = new Uint8Array(32);
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      dataView.setUint32(0, i + 1, true);
      const secretKey = bls.SecretKey.fromBytes(bytes);
      const publicKey = secretKey.toPublicKey();
      keypair = {secretKey, publicKey};
      keypairs.set(i, keypair);
    }
    return keypair;
  }

  let chain: IBeaconChain;
  const signingRoot = Buffer.alloc(32, 1);

  beforeEach(() => {
    chain = {
      bls: new BlsSingleThreadVerifier({metrics: null}),
      seenAttesters: new SeenAttesters(),
      opts: {
        minSameMessageSignatureSetsToBatch: 2,
      } as IBeaconChain["opts"],
    } as Partial<IBeaconChain> as IBeaconChain;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  for (const [testCaseIndex, testCase] of testCases.entries()) {
    const {phase0Result, phase1Result, seenAttesters} = testCase;
    it(`test case ${testCaseIndex}`, async () => {
      const phase0Results: Promise<Step0Result>[] = [];
      for (const [i, isValid] of phase0Result.entries()) {
        const signatureSet = {
          type: SignatureSetType.single,
          pubkey: getKeypair(i).publicKey,
          signingRoot,
          signature: getKeypair(i).secretKey.sign(signingRoot).toBytes(),
        };
        if (isValid) {
          if (!phase1Result[i]) {
            // invalid signature
            signatureSet.signature = getKeypair(2023).secretKey.sign(signingRoot).toBytes();
          }
          phase0Results.push(
            Promise.resolve({
              attestation: ssz.phase0.Attestation.defaultValue(),
              signatureSet,
              validatorIndex: i,
            } as Partial<Step0Result> as Step0Result)
          );
        } else {
          phase0Results.push(
            Promise.reject(
              new AttestationError(GossipAction.REJECT, {
                code: AttestationErrorCode.BAD_TARGET_EPOCH,
              })
            )
          );
        }
      }

      let callIndex = 0;
      const phase0ValidationFn = (): Promise<Step0Result> => {
        const result = phase0Results[callIndex];
        callIndex++;
        return result;
      };
      await validateGossipAttestationsSameAttData(ForkName.phase0, chain, new Array(5).fill({}), 0, phase0ValidationFn);
      for (let validatorIndex = 0; validatorIndex < phase0Result.length; validatorIndex++) {
        if (seenAttesters.includes(validatorIndex)) {
          expect(chain.seenAttesters.isKnown(0, validatorIndex)).toBe(true);
        } else {
          expect(chain.seenAttesters.isKnown(0, validatorIndex)).toBe(false);
        }
      }
    }); // end test case
  }
});

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

describe("getShufflingForAttestationVerification", () => {
  let regenStub: MockedBeaconChain["regen"];
  let forkchoiceStub: MockedBeaconChain["forkChoice"];
  let shufflingCacheStub: MockedBeaconChain["shufflingCache"];
  let chain: MockedBeaconChain;

  beforeEach(() => {
    chain = getMockedBeaconChain();
    regenStub = chain.regen;
    forkchoiceStub = chain.forkChoice;
    shufflingCacheStub = chain.shufflingCache;
    vi.spyOn(regenStub, "getBlockSlotState");
    vi.spyOn(regenStub, "getState");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const attEpoch = 1000;
  const blockRoot = "0xd76aed834b4feef32efb53f9076e407c0d344cfdb70f0a770fa88416f70d304d";

  it("block epoch is the same to attestation epoch", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock> as ProtoBlock;
    const previousDependentRoot = "0xa916b57729dbfb89a082820e0eb2b669d9d511a675d3d8c888b2f300f10b0bdf";
    forkchoiceStub.getDependentRoot.mockImplementationOnce((block, epochDiff) => {
      if (block === attHeadBlock && epochDiff === EpochDifference.previous) {
        return previousDependentRoot;
      } else {
        throw new Error("Unexpected input");
      }
    });
    const expectedShuffling = {epoch: attEpoch} as EpochShuffling;
    shufflingCacheStub.get.mockImplementationOnce((epoch, root) => {
      if (epoch === attEpoch && root === previousDependentRoot) {
        return Promise.resolve(expectedShuffling);
      } else {
        return Promise.resolve(null);
      }
    });
    const resultShuffling = await getShufflingForAttestationVerification(
      chain,
      attEpoch,
      attHeadBlock,
      RegenCaller.validateGossipAttestation
    );
    expect(resultShuffling).to.be.deep.equal(expectedShuffling);
  });

  it("block epoch is previous attestation epoch", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch - 1);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock> as ProtoBlock;
    const currentDependentRoot = "0xa916b57729dbfb89a082820e0eb2b669d9d511a675d3d8c888b2f300f10b0bdf";
    forkchoiceStub.getDependentRoot.mockImplementationOnce((block, epochDiff) => {
      if (block === attHeadBlock && epochDiff === EpochDifference.current) {
        return currentDependentRoot;
      } else {
        throw new Error("Unexpected input");
      }
    });
    const expectedShuffling = {epoch: attEpoch} as EpochShuffling;
    shufflingCacheStub.get.mockImplementationOnce((epoch, root) => {
      if (epoch === attEpoch && root === currentDependentRoot) {
        return Promise.resolve(expectedShuffling);
      } else {
        return Promise.resolve(null);
      }
    });
    const resultShuffling = await getShufflingForAttestationVerification(
      chain,
      attEpoch,
      attHeadBlock,
      RegenCaller.validateGossipAttestation
    );
    expect(resultShuffling).to.be.deep.equal(expectedShuffling);
  });

  it("block epoch is attestation epoch - 2", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch - 2);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock> as ProtoBlock;
    const expectedShuffling = {epoch: attEpoch} as EpochShuffling;
    let callCount = 0;
    shufflingCacheStub.get.mockImplementationOnce((epoch, root) => {
      if (epoch === attEpoch && root === blockRoot) {
        if (callCount === 0) {
          callCount++;
          return Promise.resolve(null);
        } else {
          return Promise.resolve(expectedShuffling);
        }
      } else {
        return Promise.resolve(null);
      }
    });
    chain.regenStateForAttestationVerification.mockImplementationOnce(() => Promise.resolve(expectedShuffling));

    const resultShuffling = await getShufflingForAttestationVerification(
      chain,
      attEpoch,
      attHeadBlock,
      RegenCaller.validateGossipAttestation
    );
    // sandbox.assert.notCalled(forkchoiceStub.getDependentRoot);
    expect(forkchoiceStub.getDependentRoot).not.toHaveBeenCalledTimes(1);
    expect(resultShuffling).to.be.deep.equal(expectedShuffling);
  });

  it("block epoch is attestation epoch + 1", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch + 1);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock> as ProtoBlock;
    try {
      await getShufflingForAttestationVerification(
        chain,
        attEpoch,
        attHeadBlock,
        RegenCaller.validateGossipAttestation
      );
      expect.fail("Expect error because attestation epoch is greater than block epoch");
    } catch (e) {
      expect(e instanceof Error).to.be.true;
    }
  });
});
