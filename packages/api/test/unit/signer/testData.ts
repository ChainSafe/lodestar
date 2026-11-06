import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints, ForkInfo, SignRequest, SignableMessageType} from "../../../src/signer/routes.js";
import {GenericServerTestCases} from "../../utils/genericServerTest.js";

// randomly pregenerated pubkey
const pubkeyRand = "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576";
const root = new Uint8Array(32).fill(1);
const signature = new Uint8Array(96).fill(2);

const forkInfo: ForkInfo = {
  fork: {previousVersion: new Uint8Array(4).fill(0), currentVersion: new Uint8Array(4).fill(1), epoch: 1},
  genesisValidatorsRoot: root,
};

function signRequest(message: SignRequest["message"], withForkInfo = true): SignRequest {
  return {pubkey: pubkeyRand, signingRoot: root, forkInfo: withForkInfo ? forkInfo : undefined, message};
}

/**
 * One request per message type and wire format variant
 */
export const signRequests: Record<string, SignRequest> = {
  AGGREGATION_SLOT: signRequest({type: SignableMessageType.AGGREGATION_SLOT, data: {slot: 1}}),
  AGGREGATE_AND_PROOF: signRequest({
    type: SignableMessageType.AGGREGATE_AND_PROOF,
    data: ssz.phase0.AggregateAndProof.defaultValue(),
  }),
  AGGREGATE_AND_PROOF_V2: signRequest({
    type: SignableMessageType.AGGREGATE_AND_PROOF_V2,
    version: ForkName.electra,
    data: ssz.electra.AggregateAndProof.defaultValue(),
  }),
  ATTESTATION: signRequest({type: SignableMessageType.ATTESTATION, data: ssz.phase0.AttestationData.defaultValue()}),
  BLOCK: signRequest({type: SignableMessageType.BLOCK, data: ssz.phase0.BeaconBlock.defaultValue()}),
  "BLOCK_V2 altair block": signRequest({
    type: SignableMessageType.BLOCK_V2,
    version: ForkName.altair,
    data: {block: ssz.altair.BeaconBlock.defaultValue()},
  }),
  "BLOCK_V2 deneb block_header": signRequest({
    type: SignableMessageType.BLOCK_V2,
    version: ForkName.deneb,
    data: {blockHeader: ssz.phase0.BeaconBlockHeader.defaultValue()},
  }),
  DEPOSIT: signRequest(
    {
      type: SignableMessageType.DEPOSIT,
      data: {
        pubkey: new Uint8Array(48).fill(3),
        withdrawalCredentials: root,
        amount: 32_000_000_000,
        genesisForkVersion: new Uint8Array(4).fill(0),
      },
    },
    false
  ),
  RANDAO_REVEAL: signRequest({type: SignableMessageType.RANDAO_REVEAL, data: {epoch: 1}}),
  VOLUNTARY_EXIT: signRequest({
    type: SignableMessageType.VOLUNTARY_EXIT,
    data: ssz.phase0.VoluntaryExit.defaultValue(),
  }),
  SYNC_COMMITTEE_MESSAGE: signRequest({
    type: SignableMessageType.SYNC_COMMITTEE_MESSAGE,
    data: {beaconBlockRoot: root, slot: 1},
  }),
  SYNC_COMMITTEE_SELECTION_PROOF: signRequest({
    type: SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF,
    data: ssz.altair.SyncAggregatorSelectionData.defaultValue(),
  }),
  SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF: signRequest({
    type: SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF,
    data: ssz.altair.ContributionAndProof.defaultValue(),
  }),
  VALIDATOR_REGISTRATION: signRequest(
    {type: SignableMessageType.VALIDATOR_REGISTRATION, data: ssz.bellatrix.ValidatorRegistrationV1.defaultValue()},
    false
  ),
  EXECUTION_PAYLOAD_BID: signRequest({
    type: SignableMessageType.EXECUTION_PAYLOAD_BID,
    version: ForkName.gloas,
    data: ssz.gloas.ExecutionPayloadBid.defaultValue(),
  }),
  EXECUTION_PAYLOAD_ENVELOPE: signRequest({
    type: SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE,
    version: ForkName.gloas,
    data: ssz.gloas.ExecutionPayloadEnvelope.defaultValue(),
  }),
  PAYLOAD_ATTESTATION_MESSAGE: signRequest({
    type: SignableMessageType.PAYLOAD_ATTESTATION_MESSAGE,
    version: ForkName.gloas,
    data: ssz.gloas.PayloadAttestationData.defaultValue(),
  }),
  PROPOSER_PREFERENCES: signRequest({
    type: SignableMessageType.PROPOSER_PREFERENCES,
    version: ForkName.gloas,
    data: ssz.gloas.ProposerPreferences.defaultValue(),
  }),
  BUILDER_REQUEST_AUTH: signRequest(
    {
      type: SignableMessageType.BUILDER_REQUEST_AUTH,
      version: ForkName.gloas,
      data: ssz.gloas.BuilderRequestAuth.defaultValue(),
    },
    false
  ),
  INCLUSION_LIST: signRequest({type: SignableMessageType.INCLUSION_LIST, data: ssz.heze.InclusionList.defaultValue()}),
};

export const testData: GenericServerTestCases<Endpoints> = {
  upcheck: {
    args: undefined,
    res: {data: {status: "OK"}},
  },
  listPublicKeys: {
    args: undefined,
    res: {data: [pubkeyRand]},
  },
  sign: {
    args: signRequests.ATTESTATION,
    res: {data: {signature}},
  },
};
