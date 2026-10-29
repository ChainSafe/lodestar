import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "../../../../src/chain/opPools/types.js";
import {AttestationValidationResult} from "../../../../src/chain/validation/attestation.js";
import {ValidationEngine} from "../../../../src/chain/validationEngine/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("chain / validationEngine / ValidationEngine.importAttestation", () => {
  const result: AttestationValidationResult = {
    attestation: ssz.electra.SingleAttestation.defaultValue(),
    indexedAttestation: ssz.electra.IndexedAttestation.defaultValue(),
    subnet: 3,
    attDataRootHex: "0xaa",
    committeeIndex: 1,
    validatorCommitteeIndex: 2,
    committeeSize: 64,
  };

  function getChain(add: () => InsertOutcome): {
    chain: IBeaconChain;
    add: ReturnType<typeof vi.fn>;
    onAttestation: ReturnType<typeof vi.fn>;
  } {
    const addFn = vi.fn(add);
    const onAttestation = vi.fn();
    const chain = {
      attestationPool: {add: addFn},
      forkChoice: {onAttestation},
      logger: getMockedLogger(),
    } as unknown as IBeaconChain;
    return {chain, add: addFn, onAttestation};
  }

  it("pools with priority and votes in fork choice", () => {
    const {chain, add, onAttestation} = getChain(() => InsertOutcome.NewData);

    const outcome = new ValidationEngine(chain).importAttestation(result, {
      addToPool: true,
      addToForkChoice: true,
      priority: true,
    });

    expect(outcome).toBe(InsertOutcome.NewData);
    expect(add).toHaveBeenCalledWith(1, result.attestation, "0xaa", 2, 64, true);
    expect(onAttestation).toHaveBeenCalledWith(result.indexedAttestation, "0xaa");
  });

  it("still votes in fork choice when pool insertion fails", () => {
    const {chain, onAttestation} = getChain(() => {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    });

    const outcome = new ValidationEngine(chain).importAttestation(result, {addToPool: true, addToForkChoice: true});

    expect(outcome).toBeNull();
    expect(onAttestation).toHaveBeenCalledOnce();
  });

  it("skips both writes when not requested", () => {
    const {chain, add, onAttestation} = getChain(() => InsertOutcome.NewData);

    const outcome = new ValidationEngine(chain).importAttestation(result, {addToPool: false, addToForkChoice: false});

    expect(outcome).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(onAttestation).not.toHaveBeenCalled();
  });
});

describe("chain / validationEngine / ValidationEngine clock hooks", () => {
  it("prunes the pools and seen caches of its topics", () => {
    const chain = {
      attestationPool: {prune: vi.fn()},
      aggregatedAttestationPool: {prune: vi.fn()},
      syncCommitteeMessagePool: {prune: vi.fn()},
      syncContributionAndProofPool: {prune: vi.fn()},
      payloadAttestationPool: {prune: vi.fn()},
      executionPayloadBidPool: {prune: vi.fn()},
      proposerPreferencesPool: {prune: vi.fn()},
      inclusionListStore: {prune: vi.fn()},
      seenAttestationDatas: {onSlot: vi.fn()},
      seenSyncCommitteeMessages: {prune: vi.fn()},
      seenExecutionPayloadBids: {prune: vi.fn()},
      seenContributionAndProof: {prune: vi.fn()},
      seenAttesters: {prune: vi.fn()},
      seenAggregators: {prune: vi.fn()},
      seenAggregatedAttestations: {prune: vi.fn()},
      seenPayloadAttesters: {prune: vi.fn()},
      seenBlockAttesters: {prune: vi.fn()},
    };
    const engine = new ValidationEngine(chain as unknown as IBeaconChain);

    engine.onSlot(33);
    engine.onEpoch(2);
    engine.onNewHead(32);

    for (const pool of [
      chain.attestationPool,
      chain.aggregatedAttestationPool,
      chain.syncCommitteeMessagePool,
      chain.payloadAttestationPool,
      chain.executionPayloadBidPool,
      chain.proposerPreferencesPool,
      chain.inclusionListStore,
    ]) {
      expect(pool.prune, "pool pruned on slot").toHaveBeenCalledWith(33);
    }
    expect(chain.syncContributionAndProofPool.prune).toHaveBeenCalledWith(32);
    expect(chain.seenAttestationDatas.onSlot).toHaveBeenCalledWith(33);
    expect(chain.seenSyncCommitteeMessages.prune).toHaveBeenCalledWith(33);
    expect(chain.seenExecutionPayloadBids.prune).toHaveBeenCalledWith(33);
    expect(chain.seenPayloadAttesters.prune).toHaveBeenCalledWith(2);
    expect(chain.seenBlockAttesters.prune).toHaveBeenCalledWith(2);
    expect(chain.seenAttesters.prune).toHaveBeenCalledWith(2);
    expect(chain.seenAggregators.prune).toHaveBeenCalledWith(2);
    expect(chain.seenAggregatedAttestations.prune).toHaveBeenCalledWith(2);
    expect(chain.seenContributionAndProof.prune).toHaveBeenCalledWith(32);
  });
});

describe("chain / validationEngine / ValidationEngine sync committee imports", () => {
  const message = ssz.altair.SyncCommitteeMessage.defaultValue();
  const contribution = ssz.altair.SignedContributionAndProof.defaultValue();

  it("pools a sync committee message once per position", () => {
    const add = vi.fn().mockReturnValue(InsertOutcome.NewData);
    const engine = new ValidationEngine({syncCommitteeMessagePool: {add}} as unknown as IBeaconChain);

    const outcomes = engine.importSyncCommitteeMessage(
      message,
      {
        positions: [
          {subnet: 1, indexInSubcommittee: 3},
          {subnet: 2, indexInSubcommittee: 0},
        ],
      },
      {priority: true}
    );

    expect(outcomes).toEqual([InsertOutcome.NewData, InsertOutcome.NewData]);
    expect(add).toHaveBeenNthCalledWith(1, 1, message, 3, true);
    expect(add).toHaveBeenNthCalledWith(2, 2, message, 0, true);
  });

  it("pools a contribution with its participant count", () => {
    const add = vi.fn().mockReturnValue(InsertOutcome.NewData);
    const engine = new ValidationEngine({syncContributionAndProofPool: {add}} as unknown as IBeaconChain);

    const outcome = engine.importContributionAndProof(
      contribution,
      {syncCommitteeParticipantIndices: [4, 5, 6]},
      {priority: true}
    );

    expect(outcome).toBe(InsertOutcome.NewData);
    expect(add).toHaveBeenCalledWith(contribution.message, 3, true);
  });
});

describe("chain / validationEngine / ValidationEngine block import hooks", () => {
  const config = createChainForkConfig({});
  const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
  signedBlock.message.slot = 7;
  signedBlock.message.proposerIndex = 3;

  function getChain() {
    const chain = {
      config,
      seenBlockProposers: {observeBlockRoot: vi.fn(), add: vi.fn(), prune: vi.fn()},
      seenBlockAttesters: {addIndices: vi.fn()},
      seenAggregatedAttestations: {add: vi.fn()},
    };
    return {chain, engine: new ValidationEngine(chain as unknown as IBeaconChain)};
  }

  it("observes a verified block and marks an imported one as seen", () => {
    const {chain, engine} = getChain();

    engine.onBlockVerified(signedBlock, "0xcc");
    engine.onBlockImported(signedBlock.message, "0xcc");
    engine.onFinalized(32);

    expect(chain.seenBlockProposers.observeBlockRoot).toHaveBeenCalledWith(7, 3, "0xcc", expect.anything());
    expect(chain.seenBlockProposers.add).toHaveBeenCalledWith(7, 3, "0xcc");
    expect(chain.seenBlockProposers.prune).toHaveBeenCalledWith(32);
  });

  it("records a pre-electra block attestation for liveness and aggregate deduplication", () => {
    const {chain, engine} = getChain();
    const attestation = ssz.phase0.Attestation.defaultValue();
    attestation.data.index = 4;
    const indexedAttestation = {...ssz.phase0.IndexedAttestation.defaultValue(), attestingIndices: [10, 11]};

    engine.onBlockAttestationImported(
      ForkName.phase0,
      {} as IBeaconStateView,
      2,
      {epoch: 1, root: new Uint8Array(32)},
      "0xdd",
      attestation,
      indexedAttestation
    );

    expect(chain.seenBlockAttesters.addIndices).toHaveBeenCalledWith(2, [10, 11]);
    expect(chain.seenAggregatedAttestations.add).toHaveBeenCalledWith(
      1,
      4,
      "0xdd",
      {aggregationBits: attestation.aggregationBits, trueBitCount: 2},
      true
    );
  });
});

describe("chain / validationEngine / ValidationEngine.importPayloadAttestationMessage", () => {
  const message = ssz.gloas.PayloadAttestationMessage.defaultValue();
  message.data.slot = 9;
  const result = {attDataRootHex: "0xbb", validatorCommitteeIndices: [1, 2]};

  function getChain(add: () => InsertOutcome): {
    chain: IBeaconChain;
    add: ReturnType<typeof vi.fn>;
    notifyPtcMessages: ReturnType<typeof vi.fn>;
  } {
    const addFn = vi.fn(add);
    const notifyPtcMessages = vi.fn();
    const chain = {
      payloadAttestationPool: {add: addFn},
      forkChoice: {notifyPtcMessages},
      logger: getMockedLogger(),
    } as unknown as IBeaconChain;
    return {chain, add: addFn, notifyPtcMessages};
  }

  it("pools and votes in fork choice", () => {
    const {chain, add, notifyPtcMessages} = getChain(() => InsertOutcome.NewData);

    const outcome = new ValidationEngine(chain).importPayloadAttestationMessage(message, result, {
      addToPool: true,
      addToForkChoice: true,
    });

    expect(outcome).toBe(InsertOutcome.NewData);
    expect(add).toHaveBeenCalledWith(message, "0xbb", [1, 2]);
    expect(notifyPtcMessages).toHaveBeenCalledWith(expect.any(String), 9, [1, 2], false, false);
  });

  it("still votes in fork choice when pool insertion fails", () => {
    const {chain, notifyPtcMessages} = getChain(() => {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    });

    const outcome = new ValidationEngine(chain).importPayloadAttestationMessage(message, result, {
      addToPool: true,
      addToForkChoice: true,
    });

    expect(outcome).toBeNull();
    expect(notifyPtcMessages).toHaveBeenCalledOnce();
  });

  it("skips the pool for a non-proposer", () => {
    const {chain, add, notifyPtcMessages} = getChain(() => InsertOutcome.NewData);

    new ValidationEngine(chain).importPayloadAttestationMessage(message, result, {
      addToPool: false,
      addToForkChoice: true,
    });

    expect(add).not.toHaveBeenCalled();
    expect(notifyPtcMessages).toHaveBeenCalledOnce();
  });
});

describe("chain / validationEngine / ValidationEngine.importAttesterSlashing", () => {
  const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();
  const domains: [Uint8Array, Uint8Array] = [new Uint8Array(32), new Uint8Array(32)];

  function getChain(): {
    chain: IBeaconChain;
    insert: ReturnType<typeof vi.fn>;
    onAttesterSlashing: ReturnType<typeof vi.fn>;
  } {
    const insert = vi.fn();
    const onAttesterSlashing = vi.fn();
    const chain = {
      opPool: {insertAttesterSlashing: insert},
      forkChoice: {onAttesterSlashing},
    } as unknown as IBeaconChain;
    return {chain, insert, onAttesterSlashing};
  }

  it("pools and registers the slashing in fork choice", () => {
    const {chain, insert, onAttesterSlashing} = getChain();

    new ValidationEngine(chain).importAttesterSlashing(ForkName.phase0, attesterSlashing, domains, {
      addToForkChoice: true,
    });

    expect(insert).toHaveBeenCalledWith(ForkName.phase0, attesterSlashing, domains);
    expect(onAttesterSlashing).toHaveBeenCalledWith(attesterSlashing);
  });

  it("only pools when fork choice is not requested", () => {
    const {chain, insert, onAttesterSlashing} = getChain();

    new ValidationEngine(chain).importAttesterSlashing(ForkName.phase0, attesterSlashing, domains, {
      addToForkChoice: false,
    });

    expect(insert).toHaveBeenCalledOnce();
    expect(onAttesterSlashing).not.toHaveBeenCalled();
  });
});
