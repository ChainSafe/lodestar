import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {GossipValidationStatus} from "../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {AttestationError, AttestationErrorCode, GossipAction} from "../../../../src/chain/errors/index.js";
import {AttestationPool} from "../../../../src/chain/opPools/attestationPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import * as attestationValidation from "../../../../src/chain/validation/attestation.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {getApiTestModules} from "../../../utils/api.js";

describe("BeaconEngineCore gossip attestation aggregation", () => {
  let engine: BeaconEngineCore;

  beforeEach(() => {
    const config = createBeaconConfig({}, Buffer.alloc(32));
    const modules = getApiTestModules({config});
    engine = new BeaconEngineCore({
      config,
      opts: defaultChainOptions,
      logger: modules.logger,
      metricsEnabled: false,
      clock: modules.chain.clock,
      db: modules.db,
      dbName: "test",
      dataColumnDir: "test",
      pubkeyCache: modules.chain.pubkeyCache,
      cpStateDatastore: {write: vi.fn(), remove: vi.fn(), read: vi.fn(), readLatestSafe: vi.fn(), readKeys: vi.fn()},
      signal: new AbortController().signal,
      validatorMonitorOpts: null,
      isAnchorStateFinalized: true,
      executionEngine: new ExecutionEngineDisabled(),
    });
    engine.forkChoice = modules.chain.forkChoice;
    engine.forkChoice.onAttestation = vi.fn();
    engine.attestationPool = new AttestationPool(config, engine.clock);
    vi.spyOn(engine.attestationPool, "add").mockReturnValue(InsertOutcome.NewData);
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses subscriptions registered while validation is pending", async () => {
    let finishValidation!: (result: attestationValidation.BatchResult) => void;
    const validated = new Promise<attestationValidation.BatchResult>((resolve) => {
      finishValidation = resolve;
    });
    vi.spyOn(attestationValidation, "validateGossipAttestationsSameAttData").mockReturnValue(validated);
    const aggregator = validationResult(2, 4);
    const nonAggregator = validationResult(3, 4);
    const processing = engine.validateGossipAttestationsSameAttData(
      ForkName.electra,
      [gossipAttestation(aggregator), gossipAttestation(nonAggregator)],
      [1, 2]
    );

    await engine.prepareBeaconCommitteeSubnets([
      {validatorIndex: 1, subnet: 2, slot: 4, isAggregator: true},
      {validatorIndex: 2, subnet: 3, slot: 4, isAggregator: false},
    ]);
    finishValidation({
      results: [
        {err: null, result: aggregator},
        {err: null, result: nonAggregator},
      ],
      batchableBls: true,
    });
    const {results} = await processing;

    expect(results.map((result) => result.err)).toEqual([null, null]);
    expect(engine.attestationPool.add).toHaveBeenCalledExactlyOnceWith(
      aggregator.committeeIndex,
      aggregator.attestation,
      aggregator.attDataRootHex,
      aggregator.validatorCommitteeIndex,
      aggregator.committeeSize
    );
    expect(engine.forkChoice.onAttestation).toHaveBeenCalledTimes(2);
  });

  it("retains another validator's aggregator duty and excludes other slots and rejected attestations", async () => {
    await engine.prepareBeaconCommitteeSubnets([{validatorIndex: 1, subnet: 2, slot: 4, isAggregator: true}]);
    await engine.prepareBeaconCommitteeSubnets([{validatorIndex: 2, subnet: 2, slot: 4, isAggregator: false}]);
    const aggregator = validationResult(2, 4);
    const otherSlot = validationResult(2, 5);
    const rejected = validationResult(2, 4);
    vi.spyOn(attestationValidation, "validateGossipAttestationsSameAttData").mockResolvedValue({
      results: [
        {err: null, result: aggregator},
        {err: null, result: otherSlot},
        {err: new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE})},
      ],
      batchableBls: true,
    });

    const {results} = await engine.validateGossipAttestationsSameAttData(
      ForkName.electra,
      [gossipAttestation(aggregator), gossipAttestation(otherSlot), gossipAttestation(rejected)],
      [1, 2, 3]
    );

    expect(engine.attestationPool.add).toHaveBeenCalledOnce();
    expect(engine.attestationPool.add).toHaveBeenCalledWith(
      aggregator.committeeIndex,
      aggregator.attestation,
      aggregator.attDataRootHex,
      aggregator.validatorCommitteeIndex,
      aggregator.committeeSize
    );
    expect(engine.forkChoice.onAttestation).toHaveBeenCalledTimes(2);
    expect(results[2].err?.status).toBe(GossipValidationStatus.Reject);
  });
});

function validationResult(
  subnet: number,
  slot: number
): attestationValidation.AttestationValidationResult & {attestation: electra.SingleAttestation} {
  const attestation = ssz.electra.SingleAttestation.defaultValue();
  attestation.data.slot = slot;
  const indexedAttestation = ssz.electra.IndexedAttestation.defaultValue();
  indexedAttestation.data = attestation.data;
  return {
    attestation,
    indexedAttestation,
    subnet,
    attDataRootHex: toRootHex(ssz.phase0.AttestationData.hashTreeRoot(attestation.data)),
    committeeIndex: 0,
    validatorCommitteeIndex: 0,
    committeeSize: 64,
  };
}

function gossipAttestation(value: ReturnType<typeof validationResult>): attestationValidation.GossipAttestation {
  return {
    attestation: null,
    serializedData: ssz.electra.SingleAttestation.serialize(value.attestation),
    attSlot: value.indexedAttestation.data.slot,
    attDataBase64: "test",
    subnet: value.subnet,
  };
}
