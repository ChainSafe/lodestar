import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {fetch} from "@lodestar/api";
import {
  phase0,
  altair,
  capella,
  BeaconBlock,
  BlindedBeaconBlock,
  AggregateAndProof,
  sszTypesFor,
  ssz,
  Slot,
  Epoch,
  RootHex,
  Root,
} from "@lodestar/types";
import {ForkPreExecution, ForkSeq} from "@lodestar/params";
import {ValidatorRegistrationV1} from "@lodestar/types/bellatrix";
import {BeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot, blindedOrFullBlockToHeader} from "@lodestar/state-transition";
import {toHex, toRootHex} from "@lodestar/utils";
import {PubkeyHex} from "../types.js";

export enum SignableMessageType {
  AGGREGATION_SLOT = "AGGREGATION_SLOT",
  AGGREGATE_AND_PROOF = "AGGREGATE_AND_PROOF",
  AGGREGATE_AND_PROOF_V2 = "AGGREGATE_AND_PROOF_V2",
  ATTESTATION = "ATTESTATION",
  BLOCK_V2 = "BLOCK_V2",
  DEPOSIT = "DEPOSIT",
  RANDAO_REVEAL = "RANDAO_REVEAL",
  VOLUNTARY_EXIT = "VOLUNTARY_EXIT",
  SYNC_COMMITTEE_MESSAGE = "SYNC_COMMITTEE_MESSAGE",
  SYNC_COMMITTEE_SELECTION_PROOF = "SYNC_COMMITTEE_SELECTION_PROOF",
  SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF = "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF",
  VALIDATOR_REGISTRATION = "VALIDATOR_REGISTRATION",
  BLS_TO_EXECUTION_CHANGE = "BLS_TO_EXECUTION_CHANGE",
}

const AggregationSlotType = new ContainerType({
  slot: ssz.Slot,
});

const DepositType = new ContainerType(
  {
    pubkey: ssz.BLSPubkey,
    withdrawalCredentials: ssz.Bytes32,
    amount: ssz.UintNum64,
    genesisForkVersion: ssz.Bytes4,
  },
  {jsonCase: "eth2"}
);

const RandaoRevealType = new ContainerType({
  epoch: ssz.Epoch,
});

const SyncCommitteeMessageType = new ContainerType(
  {
    beaconBlockRoot: ssz.Root,
    slot: ssz.Slot,
  },
  {jsonCase: "eth2"}
);

const SyncAggregatorSelectionDataType = new ContainerType(
  {
    slot: ssz.Slot,
    subcommitteeIndex: ssz.SubcommitteeIndex,
  },
  {jsonCase: "eth2"}
);

export type SignableMessage =
  | {type: SignableMessageType.AGGREGATION_SLOT; data: {slot: Slot}}
  | {type: SignableMessageType.AGGREGATE_AND_PROOF; data: phase0.AggregateAndProof}
  | {type: SignableMessageType.AGGREGATE_AND_PROOF_V2; data: AggregateAndProof}
  | {type: SignableMessageType.ATTESTATION; data: phase0.AttestationData}
  | {type: SignableMessageType.BLOCK_V2; data: BeaconBlock<ForkPreExecution> | BlindedBeaconBlock}
  | {type: SignableMessageType.DEPOSIT; data: ValueOf<typeof DepositType>}
  | {type: SignableMessageType.RANDAO_REVEAL; data: {epoch: Epoch}}
  | {type: SignableMessageType.VOLUNTARY_EXIT; data: phase0.VoluntaryExit}
  | {type: SignableMessageType.SYNC_COMMITTEE_MESSAGE; data: ValueOf<typeof SyncCommitteeMessageType>}
  | {type: SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF; data: ValueOf<typeof SyncAggregatorSelectionDataType>}
  | {type: SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF; data: altair.ContributionAndProof}
  | {type: SignableMessageType.VALIDATOR_REGISTRATION; data: ValidatorRegistrationV1}
  | {type: SignableMessageType.BLS_TO_EXECUTION_CHANGE; data: capella.BLSToExecutionChange};

const requiresForkInfo: Record<SignableMessageType, boolean> = {
  [SignableMessageType.AGGREGATION_SLOT]: true,
  [SignableMessageType.AGGREGATE_AND_PROOF]: true,
  [SignableMessageType.AGGREGATE_AND_PROOF_V2]: true,
  [SignableMessageType.ATTESTATION]: true,
  [SignableMessageType.BLOCK_V2]: true,
  [SignableMessageType.DEPOSIT]: false,
  [SignableMessageType.RANDAO_REVEAL]: true,
  [SignableMessageType.VOLUNTARY_EXIT]: true,
  [SignableMessageType.SYNC_COMMITTEE_MESSAGE]: true,
  [SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF]: true,
  [SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF]: true,
  [SignableMessageType.VALIDATOR_REGISTRATION]: false,
  [SignableMessageType.BLS_TO_EXECUTION_CHANGE]: true,
};

type Web3SignerSerializedRequest = {
  type: SignableMessageType;
  fork_info?: {
    fork: {
      previous_version: RootHex;
      current_version: RootHex;
      epoch: string;
    };
    genesis_validators_root: RootHex;
  };
  signingRoot: RootHex;
};

enum MediaType {
  json = "application/json",
}

/**
 * Return public keys from the server.
 */
export async function externalSignerGetKeys(externalSignerUrl: string): Promise<string[]> {
  const res = await fetch(`${externalSignerUrl}/api/v1/eth2/publicKeys`, {
    method: "GET",
    headers: {Accept: MediaType.json},
  });

  return handleExternalSignerResponse<string[]>(res);
}

/**
 * Return signature in bytes. Assumption that the pubkey has it's corresponding secret key in the keystore of an external signer.
 */
export async function externalSignerPostSignature(
  config: BeaconConfig,
  externalSignerUrl: string,
  pubkeyHex: PubkeyHex,
  signingRoot: Root,
  signingSlot: Slot,
  signableMessage: SignableMessage
): Promise<string> {
  const requestObj = serializerSignableMessagePayload(config, signableMessage) as Web3SignerSerializedRequest;

  requestObj.type = signableMessage.type;
  requestObj.signingRoot = toRootHex(signingRoot);

  if (requiresForkInfo[signableMessage.type]) {
    const forkInfo = config.getForkInfo(signingSlot);
    requestObj.fork_info = {
      fork: {
        previous_version: toHex(forkInfo.prevVersion),
        current_version: toHex(forkInfo.version),
        epoch: String(computeEpochAtSlot(signingSlot)),
      },
      genesis_validators_root: toRootHex(config.genesisValidatorsRoot),
    };
  }

  const res = await fetch(`${externalSignerUrl}/api/v1/eth2/sign/${pubkeyHex}`, {
    method: "POST",
    headers: {
      Accept: MediaType.json,
      "Content-Type": MediaType.json,
    },
    body: JSON.stringify(requestObj),
  });

  const data = await handleExternalSignerResponse<{signature: string}>(res);
  return data.signature;
}

/**
 * Return upcheck status from server.
 */
export async function externalSignerUpCheck(remoteUrl: string): Promise<boolean> {
  const res = await fetch(`${remoteUrl}/upcheck`, {
    method: "GET",
    headers: {Accept: MediaType.json},
  });

  const data = await handleExternalSignerResponse<{status: string}>(res);
  return data.status === "OK";
}

async function handleExternalSignerResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errBody = await res.text();
    throw Error(errBody || res.statusText);
  }

  const contentType = res.headers.get("content-type");
  if (contentType === null) {
    throw Error("No Content-Type header found in response");
  }

  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== MediaType.json) {
    throw Error(`Unsupported response media type: ${mediaType}`);
  }

  try {
    return (await res.json()) as T;
  } catch (e) {
    throw Error(`Invalid json response: ${(e as Error).message}`);
  }
}

function serializerSignableMessagePayload(config: BeaconConfig, payload: SignableMessage): Record<string, unknown> {
  switch (payload.type) {
    case SignableMessageType.AGGREGATION_SLOT:
      return {aggregation_slot: AggregationSlotType.toJson(payload.data)};

    case SignableMessageType.AGGREGATE_AND_PROOF:
      return {aggregate_and_proof: ssz.phase0.AggregateAndProof.toJson(payload.data)};

    case SignableMessageType.AGGREGATE_AND_PROOF_V2: {
      const fork = config.getForkName(payload.data.aggregate.data.slot);
      return {
        aggregate_and_proof: {
          version: fork.toUpperCase(),
          data: sszTypesFor(fork).AggregateAndProof.toJson(payload.data),
        },
      };
    }

    case SignableMessageType.ATTESTATION:
      return {attestation: ssz.phase0.AttestationData.toJson(payload.data)};

    // Note: `type: BLOCK` not implemented
    case SignableMessageType.BLOCK_V2: {
      const fork = config.getForkInfo(payload.data.slot);
      // web3signer requires capitalized names: PHASE0, ALTAIR, etc
      const version = fork.name.toUpperCase();
      if (fork.seq >= ForkSeq.bellatrix) {
        return {
          beacon_block: {
            version,
            block_header: ssz.phase0.BeaconBlockHeader.toJson(blindedOrFullBlockToHeader(config, payload.data)),
          },
        };
      } else {
        return {
          beacon_block: {
            version,
            block: config.getForkTypes(payload.data.slot).BeaconBlock.toJson(payload.data),
          },
        };
      }
    }

    case SignableMessageType.DEPOSIT:
      return {deposit: DepositType.toJson(payload.data)};

    case SignableMessageType.RANDAO_REVEAL:
      return {randao_reveal: RandaoRevealType.toJson(payload.data)};

    case SignableMessageType.VOLUNTARY_EXIT:
      return {voluntary_exit: ssz.phase0.VoluntaryExit.toJson(payload.data)};

    case SignableMessageType.SYNC_COMMITTEE_MESSAGE:
      return {sync_committee_message: SyncCommitteeMessageType.toJson(payload.data)};

    case SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF:
      return {sync_aggregator_selection_data: SyncAggregatorSelectionDataType.toJson(payload.data)};

    case SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF:
      return {contribution_and_proof: ssz.altair.ContributionAndProof.toJson(payload.data)};

    case SignableMessageType.VALIDATOR_REGISTRATION:
      return {validator_registration: ssz.bellatrix.ValidatorRegistrationV1.toJson(payload.data)};

    case SignableMessageType.BLS_TO_EXECUTION_CHANGE:
      return {BLS_TO_EXECUTION_CHANGE: ssz.capella.BLSToExecutionChange.toJson(payload.data)};
  }
}
