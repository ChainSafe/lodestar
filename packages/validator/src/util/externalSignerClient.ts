import fetch from "cross-fetch";
import {BeaconBlock, AggregateAndProof, AttestationData, VoluntaryExit, Fork} from "@lodestar/types/phase0";
import {SyncCommitteeContribution} from "@lodestar/types/altair";
import {ValidatorRegistrationV1} from "@lodestar/types/bellatrix";
import {Epoch, Root, Slot} from "@lodestar/types";

/* eslint-disable @typescript-eslint/naming-convention */

type Web3SignerRequestType =
  | "AGGREGATION_SLOT"
  | "AGGREGATE_AND_PROOF"
  | "ATTESTATION"
  | "BLOCK"
  | "BLOCK_V2"
  | "DEPOSIT"
  | "RANDAO_REVEAL"
  | "VOLUNTARY_EXIT"
  | "SYNC_COMMITTEE_MESSAGE"
  | "SYNC_COMMITTEE_SELECTION_PROOF"
  | "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF"
  | "VALIDATOR_REGISTRATION";

export type Web3SignerAggregationSlotMsg = {
  slot: Slot;
};
export type Web3SignerAggregateAndProofMsg = AggregateAndProof;
export type Web3SignerAttestationMsg = AttestationData;
export type Web3SignerBlockV2Msg = {
  version: string;
  block: BeaconBlock;
};

export type Web3SignerRandaoRevealMsg = {
  epoch: Epoch;
};
export type Web3SignerVoluntaryExitMsg = VoluntaryExit;
export type Web3SignerSyncCommitteeMessageMsg = {
  beaconBlockRoot: Uint8Array;
  slot: Slot;
};
export type Web3SignerSyncCommitteeSelectionProofMsg = {
  slot: Slot;
  subcommitteeIndex: string;
};
export type Web3SignerSyncCommitteeContributionAndProofMsg = {
  aggregatorIndex: number;
  selectionProof: Uint8Array;
  contribution: SyncCommitteeContribution;
};

export type Web3SignerValidatorRegistrationMsg = ValidatorRegistrationV1;

export type SignableMessage = {
  type: Web3SignerRequestType;
  singablePayload: SingablePayload;
  forkInfo?: Web3SignerForkInfo;
};

export type SingablePayload =
  | Web3SignerAggregationSlotMsg
  | Web3SignerAggregateAndProofMsg
  | Web3SignerAttestationMsg
  | Web3SignerBlockV2Msg
  | Web3SignerRandaoRevealMsg
  | Web3SignerVoluntaryExitMsg
  | Web3SignerSyncCommitteeMessageMsg
  | Web3SignerSyncCommitteeSelectionProofMsg
  | Web3SignerSyncCommitteeContributionAndProofMsg
  | Web3SignerValidatorRegistrationMsg;

export type Web3SignerForkInfo = {
  fork: Fork;
  genesisValidatorRoot: Root;
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
  externalSignerUrl: string,
  pubkeyHex: string,
  signingRootHex: string,
  signableMessage: SignableMessage
): Promise<string> {
  const res = await fetch(`${externalSignerUrl}/api/v1/eth2/sign/${pubkeyHex}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      ...convertToRequest(signableMessage),
      ...{signingRoot: signingRootHex},
    }),
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

function convertToRequest(signableRequest: SignableMessage): Record<string, unknown> {
  if (signableRequest.type === "SYNC_COMMITTEE_SELECTION_PROOF") {
    return {
      type: signableRequest.type,
      sync_aggregator_selection_data: signableRequest.singablePayload,
      fork_info: signableRequest.forkInfo,
    };
  } else if (signableRequest.type === "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF") {
    return {
      type: signableRequest.type,
      contribution_and_proof: signableRequest.singablePayload,
      fork_info: signableRequest.forkInfo,
    };
  } else {
    return {
      type: signableRequest.type,
      [signableRequest.type.toLocaleLowerCase()]: signableRequest.singablePayload,
      fork_info: signableRequest.forkInfo,
    };
  }
}
