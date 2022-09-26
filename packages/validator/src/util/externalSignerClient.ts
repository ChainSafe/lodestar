import fetch from "cross-fetch";
import {phase0, altair} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {ValidatorRegistrationV1} from "@lodestar/types/bellatrix";
import {IBeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot, blindedOrFullBlockToHeader} from "@lodestar/state-transition";
import {allForks, Epoch, Root, RootHex, Slot, ssz} from "@lodestar/types";
import {ContainerType, toHexString, ValueOf} from "@chainsafe/ssz";
import {PubkeyHex} from "../types.js";

/* eslint-disable @typescript-eslint/naming-convention */

export enum SignableMessageType {
  AGGREGATION_SLOT = "AGGREGATION_SLOT",
  AGGREGATE_AND_PROOF = "AGGREGATE_AND_PROOF",
  ATTESTATION = "ATTESTATION",
  BLOCK_V2 = "BLOCK_V2",
  DEPOSIT = "DEPOSIT",
  RANDAO_REVEAL = "RANDAO_REVEAL",
  VOLUNTARY_EXIT = "VOLUNTARY_EXIT",
  SYNC_COMMITTEE_MESSAGE = "SYNC_COMMITTEE_MESSAGE",
  SYNC_COMMITTEE_SELECTION_PROOF = "SYNC_COMMITTEE_SELECTION_PROOF",
  SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF = "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF",
  VALIDATOR_REGISTRATION = "VALIDATOR_REGISTRATION",
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
  | {type: SignableMessageType.ATTESTATION; data: phase0.AttestationData}
  | {type: SignableMessageType.BLOCK_V2; data: allForks.FullOrBlindedBeaconBlock}
  | {type: SignableMessageType.DEPOSIT; data: ValueOf<typeof DepositType>}
  | {type: SignableMessageType.RANDAO_REVEAL; data: {epoch: Epoch}}
  | {type: SignableMessageType.VOLUNTARY_EXIT; data: phase0.VoluntaryExit}
  | {type: SignableMessageType.SYNC_COMMITTEE_MESSAGE; data: ValueOf<typeof SyncCommitteeMessageType>}
  | {type: SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF; data: ValueOf<typeof SyncAggregatorSelectionDataType>}
  | {type: SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF; data: altair.ContributionAndProof}
  | {type: SignableMessageType.VALIDATOR_REGISTRATION; data: ValidatorRegistrationV1};

const requiresForkInfo: Record<SignableMessageType, boolean> = {
  [SignableMessageType.AGGREGATION_SLOT]: true,
  [SignableMessageType.AGGREGATE_AND_PROOF]: true,
  [SignableMessageType.ATTESTATION]: true,
  [SignableMessageType.BLOCK_V2]: true,
  [SignableMessageType.DEPOSIT]: false,
  [SignableMessageType.RANDAO_REVEAL]: true,
  [SignableMessageType.VOLUNTARY_EXIT]: true,
  [SignableMessageType.SYNC_COMMITTEE_MESSAGE]: true,
  [SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF]: true,
  [SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF]: true,
  [SignableMessageType.VALIDATOR_REGISTRATION]: false,
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

/**
 * Return public keys from the server.
 */
export async function externalSignerGetKeys(externalSignerUrl: string): Promise<string[]> {
  const res = await fetch(`${externalSignerUrl}/api/v1/eth2/publicKeys`, {
    method: "GET",
    headers: {"Content-Type": "application/json"},
  });

  return await handlerExternalSignerResponse<string[]>(res);
}

/**
 * Return signature in bytes. Assumption that the pubkey has it's corresponding secret key in the keystore of an external signer.
 */
export async function externalSignerPostSignature(
  config: IBeaconConfig,
  externalSignerUrl: string,
  pubkeyHex: PubkeyHex,
  signingRoot: Root,
  signingSlot: Slot,
  signableMessage: SignableMessage
): Promise<string> {
  const requestObj = serializerSignableMessagePayload(config, signableMessage) as Web3SignerSerializedRequest;

  requestObj.type = signableMessage.type;
  requestObj.signingRoot = toHexString(signingRoot);

  if (requiresForkInfo[signableMessage.type]) {
    const forkInfo = config.getForkInfo(signingSlot);
    requestObj.fork_info = {
      fork: {
        previous_version: toHexString(forkInfo.prevVersion),
        current_version: toHexString(forkInfo.version),
        epoch: String(computeEpochAtSlot(signingSlot)),
      },
      genesis_validators_root: toHexString(config.genesisValidatorsRoot),
    };
  }

  const res = await fetch(`${externalSignerUrl}/api/v1/eth2/sign/${pubkeyHex}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(requestObj),
  });

  const data = await handlerExternalSignerResponse<{signature: string}>(res);
  return data.signature;
}

/**
 * Return upcheck status from server.
 */
export async function externalSignerUpCheck(remoteUrl: string): Promise<boolean> {
  const res = await fetch(`${remoteUrl}/upcheck`, {
    method: "GET",
    headers: {"Content-Type": "application/json"},
  });

  const data = await handlerExternalSignerResponse<{status: string}>(res);
  return data.status === "OK";
}

async function handlerExternalSignerResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errBody = await res.text();
    throw Error(`${errBody}`);
  }

  return JSON.parse(await res.text()) as T;
}

function serializerSignableMessagePayload(config: IBeaconConfig, payload: SignableMessage): Record<string, unknown> {
  switch (payload.type) {
    case SignableMessageType.AGGREGATION_SLOT:
      return {aggregation_slot: AggregationSlotType.toJson(payload.data)};

    case SignableMessageType.AGGREGATE_AND_PROOF:
      return {aggregate_and_proof: ssz.phase0.AggregateAndProof.toJson(payload.data)};

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
  }
}
