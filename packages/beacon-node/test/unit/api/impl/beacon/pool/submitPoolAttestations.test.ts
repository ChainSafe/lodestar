import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool/index.js";
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
  let attestationPool: {add: ReturnType<typeof vi.fn>};
  let validationResult: AttestationValidationResult;

  beforeEach(() => {
    modules = getApiTestModules({config});
    attestationPool = {add: vi.fn().mockReturnValue(InsertOutcome.NewData)};
    Object.defineProperty(modules.chain, "attestationPool", {value: attestationPool});
    modules.network.publishBeaconAttestation = vi.fn().mockResolvedValue(1);
    // No aggregator duty registered for this (subnet, slot), ie. the validator client did not send
    // `is_aggregator: true` in `prepareBeaconCommitteeSubnet`
    modules.network.shouldAggregate = vi.fn().mockReturnValue(false);

    validationResult = {
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

  it("adds the attestation to fork choice", async () => {
    const attestation = ssz.electra.SingleAttestation.defaultValue();

    await api.submitPoolAttestationsV2({signedAttestations: [attestation]});

    expect(modules.forkChoice.onAttestation).toHaveBeenCalledWith(validationResult.indexedAttestation, "0x00");
  });

  it("still publishes the attestation if fork choice rejects it", async () => {
    const attestation = ssz.electra.SingleAttestation.defaultValue();
    modules.forkChoice.onAttestation.mockImplementation(() => {
      throw new Error("Unknown target root");
    });

    await expect(api.submitPoolAttestationsV2({signedAttestations: [attestation]})).resolves.not.toThrow();

    expect(modules.network.publishBeaconAttestation).toHaveBeenCalledWith(attestation, subnet);
  });

  it("publishes the attestation on the subnet", async () => {
    const attestation = ssz.electra.SingleAttestation.defaultValue();

    await api.submitPoolAttestationsV2({signedAttestations: [attestation]});

    expect(modules.network.publishBeaconAttestation).toHaveBeenCalledWith(attestation, subnet);
  });
});
