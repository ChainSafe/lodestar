import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints as BeaconEndpoints} from "../../../../src/beacon/routes/beacon/index.js";
import {Endpoints as DebugEndpoints} from "../../../../src/beacon/routes/debug.js";
import {Endpoints as LightclientEndpoints} from "../../../../src/beacon/routes/lightclient.js";
import {Endpoints as ValidatorEndpoints} from "../../../../src/beacon/routes/validator.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";
import {testData as beaconTestData} from "./beacon.js";
import {testData as debugTestData} from "./debug.js";
import {testData as lightclientTestData} from "./lightclient.js";
import {testData as validatorTestData} from "./validator.js";

const meta = {executionOptimistic: true, finalized: false, version: ForkName.gloas};
const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
signedBlock.message.body.proposerSlashings.push(ssz.phase0.ProposerSlashing.defaultValue());
signedBlock.message.body.attesterSlashings.push(ssz.gloas.AttesterSlashing.defaultValue());
signedBlock.message.body.attestations.push(ssz.gloas.Attestation.defaultValue());
signedBlock.message.body.voluntaryExits.push(ssz.phase0.SignedVoluntaryExit.defaultValue());
signedBlock.message.body.blsToExecutionChanges.push(ssz.capella.SignedBLSToExecutionChange.defaultValue());
signedBlock.message.body.payloadAttestations.push(ssz.gloas.PayloadAttestation.defaultValue());
signedBlock.message.body.signedExecutionPayloadBid.message.blobKzgCommitments.push(
  ssz.deneb.KZGCommitment.defaultValue()
);

const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
signedEnvelope.message.executionRequests.deposits.push(ssz.electra.DepositRequest.defaultValue());
signedEnvelope.message.executionRequests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());
signedEnvelope.message.executionRequests.consolidations.push(ssz.electra.ConsolidationRequest.defaultValue());
signedEnvelope.message.executionRequests.builderDeposits.push(ssz.gloas.BuilderDepositRequest.defaultValue());
signedEnvelope.message.executionRequests.builderExits.push(ssz.gloas.BuilderExitRequest.defaultValue());
signedEnvelope.message.payload.transactions.push(Uint8Array.of(1));
signedEnvelope.message.payload.withdrawals.push(ssz.capella.Withdrawal.defaultValue());
signedEnvelope.message.payload.blockAccessList = Uint8Array.of(1);

const state = ssz.gloas.BeaconState.defaultValue();
state.validators.push(ssz.phase0.Validator.defaultValue());
state.balances.push(0);
state.previousEpochParticipation.push(0);
state.currentEpochParticipation.push(0);
state.inactivityScores.push(0);
state.pendingDeposits.push(ssz.electra.PendingDeposit.defaultValue());
state.pendingPartialWithdrawals.push(ssz.electra.PendingPartialWithdrawal.defaultValue());
state.pendingConsolidations.push(ssz.electra.PendingConsolidation.defaultValue());
state.builders.push(ssz.gloas.Builder.defaultValue());
state.builderPendingWithdrawals.push(ssz.gloas.BuilderPendingWithdrawal.defaultValue());
state.payloadExpectedWithdrawals.push(ssz.capella.Withdrawal.defaultValue());

const sidecar = ssz.gloas.DataColumnSidecar.defaultValue();
sidecar.column.push(ssz.fulu.Cell.defaultValue());
sidecar.kzgProofs.push(ssz.deneb.KZGProof.defaultValue());

export const testData = {
  getBlockV2: {...beaconTestData.getBlockV2, res: {data: signedBlock, meta}},
  publishBlockV2: {
    ...beaconTestData.publishBlockV2,
    args: {...beaconTestData.publishBlockV2.args, signedBlockContents: {signedBlock}},
  },
  getBlockAttestationsV2: {
    ...beaconTestData.getBlockAttestationsV2,
    res: {data: signedBlock.message.body.attestations, meta},
  },
  getPoolAttestationsV2: {
    ...beaconTestData.getPoolAttestationsV2,
    res: {data: signedBlock.message.body.attestations, meta},
  },
  getPoolAttesterSlashingsV2: {
    ...beaconTestData.getPoolAttesterSlashingsV2,
    res: {data: signedBlock.message.body.attesterSlashings, meta},
  },
  getSignedExecutionPayloadEnvelope: {
    ...beaconTestData.getSignedExecutionPayloadEnvelope,
    res: {data: signedEnvelope, meta},
  },
  publishExecutionPayloadEnvelope: {
    ...beaconTestData.publishExecutionPayloadEnvelope,
    args: {
      ...beaconTestData.publishExecutionPayloadEnvelope.args,
      signedEnvelopeOrContents: {
        ...ssz.gloas.SignedExecutionPayloadEnvelopeContents.defaultValue(),
        signedExecutionPayloadEnvelope: signedEnvelope,
      },
    },
  },
  getPendingDeposits: {...beaconTestData.getPendingDeposits, res: {data: state.pendingDeposits, meta}},
  getPendingPartialWithdrawals: {
    ...beaconTestData.getPendingPartialWithdrawals,
    res: {data: state.pendingPartialWithdrawals, meta},
  },
  getPendingConsolidations: {
    ...beaconTestData.getPendingConsolidations,
    res: {data: state.pendingConsolidations, meta},
  },
  getProposerLookahead: {...beaconTestData.getProposerLookahead, res: {data: state.proposerLookahead, meta}},
  getStateV2: {...debugTestData.getStateV2, res: {data: state, meta}},
  getDebugDataColumnSidecars: {...debugTestData.getDebugDataColumnSidecars, res: {data: [sidecar], meta}},
  getAggregatedAttestationV2: {
    ...validatorTestData.getAggregatedAttestationV2,
    res: {data: ssz.gloas.Attestation.defaultValue(), meta},
  },
  produceBlockV4: {
    ...validatorTestData.produceBlockV4,
    res: {
      data: signedBlock.message,
      meta: {
        version: ForkName.gloas,
        executionPayloadIncluded: false,
        executionPayloadValue: 0n,
        consensusBlockValue: 0n,
        builderUrl: "https://builder.example.com",
      },
    },
  },
  publishAggregateAndProofsV2: {
    ...validatorTestData.publishAggregateAndProofsV2,
    args: {signedAggregateAndProofs: [ssz.gloas.SignedAggregateAndProof.defaultValue()]},
  },
  getLightClientUpdatesByRange: {
    ...lightclientTestData.getLightClientUpdatesByRange,
    res: {data: [ssz.gloas.LightClientUpdate.defaultValue()], meta: {versions: [ForkName.gloas]}},
  },
  getLightClientOptimisticUpdate: {
    ...lightclientTestData.getLightClientOptimisticUpdate,
    res: {data: ssz.gloas.LightClientOptimisticUpdate.defaultValue(), meta},
  },
  getLightClientFinalityUpdate: {
    ...lightclientTestData.getLightClientFinalityUpdate,
    res: {data: ssz.gloas.LightClientFinalityUpdate.defaultValue(), meta},
  },
  getLightClientBootstrap: {
    ...lightclientTestData.getLightClientBootstrap,
    res: {data: ssz.gloas.LightClientBootstrap.defaultValue(), meta},
  },
} satisfies Partial<
  GenericServerTestCases<BeaconEndpoints & DebugEndpoints & LightclientEndpoints & ValidatorEndpoints>
>;

const builderConfig = validatorTestData.produceBlockV4.args.builderConfig;
const builderEntry = builderConfig.builders[0];

export const componentTestData: Record<string, unknown> = {
  BuilderRequestAuth: builderEntry.auth.message,
  SignedBuilderRequestAuth: builderEntry.auth,
  BuilderEntry: builderEntry,
  BuilderConfig: builderConfig,
  BuilderPreferencesEntry: validatorTestData.submitBuilderPreferences.args.builderPreferences[0],
};
