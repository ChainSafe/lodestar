import {Mocked, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool/index.js";
import {AttestationPool} from "../../../../../../src/chain/opPools/attestationPool.js";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "../../../../../../src/chain/opPools/types.js";
import {AttestationValidationResult} from "../../../../../../src/chain/validation/attestation.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

vi.mock("../../../../../../src/network/processor/gossipHandlers.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../../../src/network/processor/gossipHandlers.js")>();
  return {...mod, validateGossipFnRetryUnknownRoot: vi.fn()};
});

const {validateGossipFnRetryUnknownRoot} = await import("../../../../../../src/network/processor/gossipHandlers.js");

describe("api - beacon - submitPoolAttestationsV2", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
  });
  const subnet = 7;

  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconPoolApi>;
  let attestationPool: Pick<Mocked<AttestationPool>, "add" | "getAll">;

  beforeEach(() => {
    modules = getApiTestModules({config});
    attestationPool = {add: vi.fn().mockReturnValue(InsertOutcome.NewData), getAll: vi.fn()};
    Object.defineProperty(modules.chain, "attestationPool", {value: attestationPool});
    modules.network.publishBeaconAttestation = vi.fn().mockResolvedValue(1);
    // No aggregator duty registered for this (subnet, slot), ie. the validator client did not send
    // `is_aggregator: true` in `prepareBeaconCommitteeSubnet`
    modules.network.shouldAggregate = vi.fn().mockReturnValue(false);

    const validationResult: AttestationValidationResult = {
      attestation: ssz.electra.SingleAttestation.defaultValue(),
      indexedAttestation: ssz.electra.IndexedAttestation.defaultValue(),
      subnet,
      attDataRootHex: "0x00",
      committeeIndex: 0,
      validatorCommitteeIndex: 0,
      committeeSize: 64,
    };
    vi.mocked(validateGossipFnRetryUnknownRoot<AttestationValidationResult>).mockResolvedValue(validationResult);

    api = getBeaconPoolApi(modules);
  });

  it("adds the attestation to the pool even if we have no aggregator duty", async () => {
    const attestation = ssz.electra.SingleAttestation.defaultValue();

    await api.submitPoolAttestationsV2({signedAttestations: [attestation]});

    expect(attestationPool.add).toHaveBeenCalledOnce();
    // api attestations are always inserted with priority so they are not rejected for being late
    expect(attestationPool.add).toHaveBeenCalledWith(0, attestation, "0x00", 0, 64, true);
  });

  it("still publishes the attestation if it can not be added to the pool", async () => {
    const attestation = ssz.electra.SingleAttestation.defaultValue();
    attestationPool.add.mockImplementation(() => {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    });

    await expect(api.submitPoolAttestationsV2({signedAttestations: [attestation]})).resolves.not.toThrow();

    expect(modules.network.publishBeaconAttestation).toHaveBeenCalledWith(attestation, subnet);
  });

  it("publishes the attestation on the subnet", async () => {
    const attestation = ssz.electra.SingleAttestation.defaultValue();

    await api.submitPoolAttestationsV2({signedAttestations: [attestation]});

    expect(modules.network.publishBeaconAttestation).toHaveBeenCalledWith(attestation, subnet);
  });

  it("exposes a submitted single attestation through the filtered pool endpoint", async () => {
    const pool = new AttestationPool(config, modules.chain.clock);
    attestationPool.add.mockImplementation(pool.add.bind(pool));
    attestationPool.getAll.mockImplementation(pool.getAll.bind(pool));
    modules.chain.aggregatedAttestationPool.getAll = vi.fn().mockReturnValue([]);

    const committeeIndex = 3;
    const validatorCommitteeIndex = 2;
    const committeeSize = 64;
    const attestation = {...ssz.electra.SingleAttestation.defaultValue(), committeeIndex};
    const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestation.data);
    attestation.signature = SecretKey.fromBytes(Buffer.alloc(32, 1)).sign(dataRoot).toBytes();
    vi.mocked(validateGossipFnRetryUnknownRoot<AttestationValidationResult>).mockResolvedValue({
      attestation,
      indexedAttestation: ssz.electra.IndexedAttestation.defaultValue(),
      subnet,
      attDataRootHex: toRootHex(dataRoot),
      committeeIndex,
      validatorCommitteeIndex,
      committeeSize,
    });

    await api.submitPoolAttestationsV2({signedAttestations: [attestation]});

    expect(await api.getPoolAttestationsV2({slot: attestation.data.slot, committeeIndex})).toEqual({
      data: [
        {
          data: attestation.data,
          signature: attestation.signature,
          aggregationBits: BitArray.fromSingleBit(committeeSize, validatorCommitteeIndex),
          committeeBits: BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, committeeIndex),
        },
      ],
      meta: {version: ForkName.electra},
    });
  });
});
