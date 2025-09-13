import {BitArray, toHexString} from "@chainsafe/ssz";
import {ForkSeq, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Attestation, IndexedAttestation} from "@lodestar/types/lib/electra";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getStateResponseWithRegen} from "../../../../../src/api/impl/beacon/state/utils.js";
import {getLodestarApi} from "../../../../../src/api/impl/lodestar/index.js";
import {toIndexedAttestationBigint} from "../../../../../src/api/impl/utils.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

vi.mock("../../../../../src/api/impl/beacon/state/utils.js", () => ({
  getStateResponseWithRegen: vi.fn(),
}));

vi.mock("@lodestar/state-transition", async (importActual) => {
  const mod = await importActual<typeof import("@lodestar/state-transition")>();
  return {
    ...mod,
    createCachedBeaconState: vi.fn(),
  };
});

describe("getAttesterSlashingsFromBlocks - verify attester slashings", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getLodestarApi>;

  beforeEach(() => {
    modules = getApiTestModules();
    api = getLodestarApi(modules);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return the correct slashings from a mocked API", async () => {
    const attestation1 = electraAttestationFromValues(1, 1);
    const attestation2 = electraAttestationFromValues(1, 2);

    const indexedAttestation1 = electraIndexedAttestationFromAttestation(attestation1, [1, 2, 3]);
    const indexedAttestation2 = electraIndexedAttestationFromAttestation(attestation2, [2, 3, 4]);

    const mockBlock = ssz.electra.SignedBeaconBlock.defaultValue();
    mockBlock.message.body.attestations = [attestation1, attestation2];
    const mockedBlocks = [mockBlock];

    const mockState = {
      epochCtx: {
        getIndexedAttestation: vi.fn((_fork, attestation) => {
          if (attestation.signature === attestation1.signature) {
            return indexedAttestation1;
          }
          if (attestation.signature === attestation2.signature) {
            return indexedAttestation2;
          }
          return undefined;
        }),
      },
      fork: ForkSeq.electra,
      clone: vi.fn(() => mockState),
    };

    vi.mocked(createCachedBeaconState).mockReturnValue(mockState);
    vi.mocked(getStateResponseWithRegen).mockResolvedValue({state: mockState});

    const attesterSlashings = await api.getAttesterSlashingsFromBlocks({signedBlocks: mockedBlocks});

    const indexedAttestationBigint1 = toIndexedAttestationBigint(indexedAttestation1);
    const indexedAttestationBigint2 = toIndexedAttestationBigint(indexedAttestation2);

    const expectedAttesterSlashings = [
      {
        attestation1: {...indexedAttestationBigint1, attestingIndices: [1, 2, 3]},
        attestation2: {...indexedAttestationBigint2, attestingIndices: [2, 3, 4]},
      },
    ];

    expect(attesterSlashings.data).toEqual(expect.objectContaining(expectedAttesterSlashings));
  });

  function electraAttestationFromValues(targetEpoch: number, randomNumber: number): Attestation {
    const attestation = ssz.electra.Attestation.defaultValue();
    attestation.data.target.epoch = targetEpoch;
    attestation.data.beaconBlockRoot = Buffer.alloc(32, randomNumber);
    attestation.signature = Buffer.alloc(96, randomNumber);
    attestation.committeeBits = BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, 1);
    return attestation;
  }

  function electraIndexedAttestationFromAttestation(
    attestation: Attestation,
    attestingIndices: number[]
  ): IndexedAttestation {
    const indexedAttestation: IndexedAttestation = {
      attestingIndices: attestingIndices,
      data: attestation.data,
      signature: attestation.signature,
    };
    return indexedAttestation;
  }
});
