import {Mocked, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView, VoluntaryExitValidity} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {AggregateAndProofValidationResult} from "../../../../src/chain/validation/aggregateAndProof.js";
import {AttestationValidationResult} from "../../../../src/chain/validation/attestation.js";
import {
  IValidationEngine,
  TopicRoutedValidationEngine,
  ValidationTopic,
} from "../../../../src/chain/validationEngine/index.js";

function getMockedEngine(): Mocked<IValidationEngine> {
  return {
    onSlot: vi.fn(),
    onEpoch: vi.fn(),
    onNewHead: vi.fn(),
    onFinalized: vi.fn(),
    onBlockVerified: vi.fn(),
    onBlockImported: vi.fn(),
    onBlockAttestationImported: vi.fn(),
    close: vi.fn(),
    validateGossipAttestationsSameAttData: vi.fn().mockResolvedValue({results: [], batchableBls: false}),
    validateApiAttestation: vi.fn(),
    importAttestation: vi.fn().mockReturnValue(InsertOutcome.NewData),
    validateGossipAggregateAndProof: vi.fn(),
    validateApiAggregateAndProof: vi.fn(),
    importAggregateAndProof: vi.fn().mockReturnValue(InsertOutcome.NewData),
    validateGossipSyncCommitteeMessage: vi.fn(),
    validateApiSyncCommitteeMessage: vi.fn(),
    importSyncCommitteeMessage: vi.fn().mockReturnValue([]),
    validateGossipContributionAndProof: vi.fn(),
    validateApiContributionAndProof: vi.fn(),
    importContributionAndProof: vi.fn().mockReturnValue(InsertOutcome.NewData),
    validateGossipAttesterSlashing: vi.fn(),
    validateApiAttesterSlashing: vi.fn(),
    importAttesterSlashing: vi.fn(),
    validateGossipProposerSlashing: vi.fn(),
    validateApiProposerSlashing: vi.fn(),
    importProposerSlashing: vi.fn(),
    validateGossipVoluntaryExit: vi.fn(),
    validateApiVoluntaryExit: vi.fn(),
    importVoluntaryExit: vi.fn(),
    deferVoluntaryExit: vi.fn().mockReturnValue(true),
    validateGossipBlsToExecutionChange: vi.fn(),
    validateApiBlsToExecutionChange: vi.fn(),
    importBlsToExecutionChange: vi.fn(),
    validateGossipPayloadAttestationMessage: vi.fn(),
    validateApiPayloadAttestationMessage: vi.fn(),
    importPayloadAttestationMessage: vi.fn().mockReturnValue(null),
    validateGossipExecutionPayloadBid: vi.fn(),
    validateApiExecutionPayloadBid: vi.fn(),
    importExecutionPayloadBid: vi.fn().mockReturnValue(InsertOutcome.NewData),
    validateGossipProposerPreferences: vi.fn(),
    validateApiProposerPreferences: vi.fn(),
    validateGossipInclusionList: vi.fn(),
    validateApiInclusionList: vi.fn(),
    importInclusionList: vi.fn(),
    validateGossipBlock: vi.fn(),
    validateApiBlock: vi.fn(),
    validateGossipBlockWithUnknownParent: vi.fn(),
    verifyBlockProposerSignature: vi.fn(),
    validateGossipExecutionPayloadEnvelope: vi.fn(),
    validateApiExecutionPayloadEnvelope: vi.fn(),
    validateGossipBlobSidecar: vi.fn(),
    validateGossipFuluDataColumnSidecar: vi.fn(),
    validateGossipGloasDataColumnSidecar: vi.fn(),
  };
}

describe("chain / validationEngine / TopicRoutedValidationEngine", () => {
  const fork = ForkName.electra;
  const aggregate = ssz.electra.SignedAggregateAndProof.defaultValue();
  const attestationResult = {} as AttestationValidationResult;
  const aggregateResult = {} as AggregateAndProofValidationResult;
  const syncMessage = ssz.altair.SyncCommitteeMessage.defaultValue();
  const contribution = ssz.altair.SignedContributionAndProof.defaultValue();
  const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();
  const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
  const voluntaryExit = ssz.phase0.SignedVoluntaryExit.defaultValue();
  const blsToExecutionChange = ssz.capella.SignedBLSToExecutionChange.defaultValue();
  const domain = new Uint8Array(32);
  const payloadAttestation = ssz.gloas.PayloadAttestationMessage.defaultValue();
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  const proposerPreferences = ssz.gloas.SignedProposerPreferences.defaultValue();
  const inclusionList = ssz.heze.SignedInclusionList.defaultValue();
  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  const blobSidecar = ssz.deneb.BlobSidecar.defaultValue();
  const fuluColumn = ssz.fulu.DataColumnSidecar.defaultValue();
  const gloasColumn = ssz.gloas.DataColumnSidecar.defaultValue();

  async function callEveryMethod(engine: IValidationEngine): Promise<void> {
    await engine.validateGossipAttestationsSameAttData(fork, []);
    await engine.validateApiAttestation(fork, {
      attestation: ssz.electra.SingleAttestation.defaultValue(),
      serializedData: null,
    });
    engine.importAttestation(attestationResult, {addToPool: true, addToForkChoice: true});
    await engine.validateGossipAggregateAndProof(fork, aggregate, new Uint8Array());
    await engine.validateApiAggregateAndProof(fork, aggregate);
    engine.importAggregateAndProof(aggregate, aggregateResult, {addToForkChoice: true});
    await engine.validateGossipSyncCommitteeMessage(syncMessage, 0);
    await engine.validateApiSyncCommitteeMessage(syncMessage);
    engine.importSyncCommitteeMessage(syncMessage, {positions: []}, {});
    await engine.validateGossipContributionAndProof(contribution);
    await engine.validateApiContributionAndProof(contribution);
    engine.importContributionAndProof(contribution, {syncCommitteeParticipantIndices: []}, {});
    await engine.validateGossipAttesterSlashing(attesterSlashing);
    await engine.validateApiAttesterSlashing(attesterSlashing);
    engine.importAttesterSlashing(fork, attesterSlashing, [domain, domain], {addToForkChoice: true});
    await engine.validateGossipProposerSlashing(proposerSlashing);
    await engine.validateApiProposerSlashing(proposerSlashing);
    engine.importProposerSlashing(proposerSlashing, domain);
    await engine.validateGossipVoluntaryExit(voluntaryExit);
    await engine.validateApiVoluntaryExit(voluntaryExit);
    engine.importVoluntaryExit(voluntaryExit);
    engine.deferVoluntaryExit(voluntaryExit, VoluntaryExitValidity.earlyEpoch, 1);
    await engine.validateGossipBlsToExecutionChange(blsToExecutionChange);
    await engine.validateApiBlsToExecutionChange(blsToExecutionChange);
    engine.importBlsToExecutionChange(blsToExecutionChange, {});
    await engine.validateGossipPayloadAttestationMessage(payloadAttestation);
    await engine.validateApiPayloadAttestationMessage(payloadAttestation);
    engine.importPayloadAttestationMessage(
      payloadAttestation,
      {attDataRootHex: "0x", validatorCommitteeIndices: []},
      {addToPool: true, addToForkChoice: true}
    );
    await engine.validateGossipExecutionPayloadBid(bid);
    await engine.validateApiExecutionPayloadBid(bid);
    engine.importExecutionPayloadBid(bid, {receivedMs: 0});
    await engine.validateGossipProposerPreferences(proposerPreferences);
    await engine.validateApiProposerPreferences(proposerPreferences);
    await engine.validateGossipInclusionList(inclusionList);
    await engine.validateApiInclusionList(inclusionList);
    engine.importInclusionList(inclusionList, {committeeIndices: [], totalBytes: 0}, {isTimely: true});
    await engine.validateGossipBlock(fork, block);
    await engine.validateApiBlock(fork, block);
    await engine.validateGossipBlockWithUnknownParent(block, "0x");
    await engine.verifyBlockProposerSignature(block, "0x");
    await engine.validateGossipExecutionPayloadEnvelope(envelope);
    await engine.validateApiExecutionPayloadEnvelope(envelope);
    await engine.validateGossipBlobSidecar(fork, blobSidecar, 0);
    await engine.validateGossipFuluDataColumnSidecar(fuluColumn, 0);
    await engine.validateGossipGloasDataColumnSidecar({} as PayloadEnvelopeInput, gloasColumn, 0);
  }

  const attestationMethods = ["validateGossipAttestationsSameAttData", "validateApiAttestation", "importAttestation"];
  const aggregateMethods = [
    "validateGossipAggregateAndProof",
    "validateApiAggregateAndProof",
    "importAggregateAndProof",
  ];
  const syncMessageMethods = [
    "validateGossipSyncCommitteeMessage",
    "validateApiSyncCommitteeMessage",
    "importSyncCommitteeMessage",
  ];
  const contributionMethods = [
    "validateGossipContributionAndProof",
    "validateApiContributionAndProof",
    "importContributionAndProof",
  ];
  const methodsByTopic: Record<ValidationTopic, string[]> = {
    [ValidationTopic.attestation]: attestationMethods,
    [ValidationTopic.aggregate]: aggregateMethods,
    [ValidationTopic.syncCommitteeMessage]: syncMessageMethods,
    [ValidationTopic.contributionAndProof]: contributionMethods,
    [ValidationTopic.attesterSlashing]: [
      "validateGossipAttesterSlashing",
      "validateApiAttesterSlashing",
      "importAttesterSlashing",
    ],
    [ValidationTopic.proposerSlashing]: [
      "validateGossipProposerSlashing",
      "validateApiProposerSlashing",
      "importProposerSlashing",
    ],
    [ValidationTopic.voluntaryExit]: [
      "validateGossipVoluntaryExit",
      "validateApiVoluntaryExit",
      "importVoluntaryExit",
      "deferVoluntaryExit",
    ],
    [ValidationTopic.blsToExecutionChange]: [
      "validateGossipBlsToExecutionChange",
      "validateApiBlsToExecutionChange",
      "importBlsToExecutionChange",
    ],
    [ValidationTopic.payloadAttestation]: [
      "validateGossipPayloadAttestationMessage",
      "validateApiPayloadAttestationMessage",
      "importPayloadAttestationMessage",
    ],
    [ValidationTopic.executionPayloadBid]: [
      "validateGossipExecutionPayloadBid",
      "validateApiExecutionPayloadBid",
      "importExecutionPayloadBid",
    ],
    [ValidationTopic.proposerPreferences]: ["validateGossipProposerPreferences", "validateApiProposerPreferences"],
    [ValidationTopic.inclusionList]: ["validateGossipInclusionList", "validateApiInclusionList", "importInclusionList"],
    [ValidationTopic.block]: [
      "validateGossipBlock",
      "validateApiBlock",
      "validateGossipBlockWithUnknownParent",
      "verifyBlockProposerSignature",
    ],
    [ValidationTopic.executionPayloadEnvelope]: [
      "validateGossipExecutionPayloadEnvelope",
      "validateApiExecutionPayloadEnvelope",
    ],
    [ValidationTopic.blobSidecar]: ["validateGossipBlobSidecar"],
    [ValidationTopic.dataColumnSidecar]: [
      "validateGossipFuluDataColumnSidecar",
      "validateGossipGloasDataColumnSidecar",
    ],
  };
  const allTopics = Object.values(ValidationTopic);
  const allMethods = allTopics.flatMap((topic) => methodsByTopic[topic]);

  const cases: {id: string; nativeTopics: ValidationTopic[]; nativeMethods: string[]}[] = [
    {id: "no native topics", nativeTopics: [], nativeMethods: []},
    ...allTopics.map((topic) => ({
      id: `${topic} topic native`,
      nativeTopics: [topic],
      nativeMethods: methodsByTopic[topic],
    })),
    {id: "all topics native", nativeTopics: allTopics, nativeMethods: allMethods},
  ];

  for (const {id, nativeTopics, nativeMethods} of cases) {
    it(`routes each method to its topic's engine: ${id}`, async () => {
      const js = getMockedEngine();
      const native = getMockedEngine();
      await callEveryMethod(new TopicRoutedValidationEngine(js, native, new Set(nativeTopics)));

      for (const method of allMethods as (keyof IValidationEngine)[]) {
        const expectNative = nativeMethods.includes(method);
        expect(native[method], `native.${method}`).toHaveBeenCalledTimes(expectNative ? 1 : 0);
        expect(js[method], `js.${method}`).toHaveBeenCalledTimes(expectNative ? 0 : 1);
      }
    });
  }

  it("forwards lifecycle hooks to both engines", () => {
    const js = getMockedEngine();
    const native = getMockedEngine();
    const engine = new TopicRoutedValidationEngine(js, native, new Set([ValidationTopic.attestation]));

    engine.onSlot(5);
    engine.onEpoch(1);
    engine.onNewHead(4);
    engine.onFinalized(3);
    engine.onBlockVerified(block, "0x");
    engine.onBlockImported(block.message, "0x");
    engine.onBlockAttestationImported(
      fork,
      {} as IBeaconStateView,
      0,
      {epoch: 0, root: new Uint8Array(32)},
      "0x",
      ssz.phase0.Attestation.defaultValue(),
      ssz.phase0.IndexedAttestation.defaultValue()
    );
    engine.close();

    for (const mock of [js, native]) {
      expect(mock.onSlot).toHaveBeenCalledWith(5);
      expect(mock.onEpoch).toHaveBeenCalledWith(1);
      expect(mock.onNewHead).toHaveBeenCalledWith(4);
      expect(mock.onFinalized).toHaveBeenCalledWith(3);
      expect(mock.onBlockVerified).toHaveBeenCalledWith(block, "0x");
      expect(mock.onBlockImported).toHaveBeenCalledWith(block.message, "0x");
      expect(mock.onBlockAttestationImported).toHaveBeenCalledOnce();
      expect(mock.close).toHaveBeenCalledOnce();
    }
  });
});
