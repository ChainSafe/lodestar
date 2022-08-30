import fetch from "cross-fetch";
import {BeaconBlock, AggregateAndProof, AttestationData, VoluntaryExit, Fork} from "@lodestar/types/phase0";
import {SyncCommitteeContribution} from "@lodestar/types/altair";
import {ValidatorRegistrationV1} from "@lodestar/types/bellatrix";
import {altair, Epoch, phase0, Root, Slot, ssz} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";

/* eslint-disable @typescript-eslint/naming-convention */

const serializerMap = {
  ["AGGREGATION_SLOT"]: (data: Record<string, unknown>) => {
    return data;
  },
  ["AGGREGATE_AND_PROOF"]: (data: Record<string, unknown>) => {
    return ssz.phase0.AggregateAndProof.toJson(data as AggregateAndProof);
  },
  ["ATTESTATION"]: (data: Record<string, unknown>) => {
    return ssz.phase0.AttestationData.toJson(data as AttestationData);
  },
  ["BLOCK"]: (data: Record<string, unknown>) => {
    return {
      version: data.version,
      block: ssz.phase0.BeaconBlock.toJson(data.block as phase0.BeaconBlock), // TODO DA confirm version
    };
  },
  ["BLOCK_V2"]: (data: Record<string, unknown>) => {
    return {
      version: data.version,
      block: ssz.altair.BeaconBlock.toJson(data.block as altair.BeaconBlock), // TODO DA confirm version
    };
  },
  ["DEPOSIT"]: (data: Record<string, unknown>) => {
    return data;
  },
  ["RANDAO_REVEAL"]: (data: Record<string, unknown>) => {
    return {
      epoch: String(data.epoch),
    };
  },
  ["VOLUNTARY_EXIT"]: (data: Record<string, unknown>) => {
    return ssz.phase0.VoluntaryExit.toJson(data as VoluntaryExit);
  },
  ["SYNC_COMMITTEE_MESSAGE"]: (data: Record<string, unknown>) => {
    return {
      beaconBlockRoot: data.beaconBlockRoot,
      slot: String(data.slot),
    };
  },
  ["SYNC_COMMITTEE_SELECTION_PROOF"]: (data: Record<string, unknown>) => {
    return {
      slot: String(data.slot),
      subcommitteeIndex: data.subcommitteeIndex,
    };
  },
  ["SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF"]: (data: Record<string, unknown>) => {
    return {
      aggregatorIndex: data.aggregatorIndex,
      selectionProof: data.selectionProof,
      contribution: ssz.altair.SyncCommitteeContribution.toJson(data.contribution as SyncCommitteeContribution),
    };
  },
  ["VALIDATOR_REGISTRATION"]: (data: Record<string, unknown>) => {
    return ssz.bellatrix.ValidatorRegistrationV1.toJson(data as ValidatorRegistrationV1);
  },
};

export type Web3SignerAggregationSlotMsg = {
  type: "AGGREGATION_SLOT";
  data: {
    slot: string;
  };
};

export type Web3SignerAggregateAndProofMsg = {
  type: "AGGREGATE_AND_PROOF";
  data: AggregateAndProof;
};
export type Web3SignerAttestationMsg = {
  type: "ATTESTATION";
  data: AttestationData;
};
export type Web3SignerBlockV2Msg = {
  type: "BLOCK_V2";
  data: {
    version: string;
    block: BeaconBlock;
  };
};

export type Web3SignerDepositMsg = {
  type: "DEPOSIT";
  data: {
    pubKey: string;
    withdrawalCredentials: string;
    amount: string;
    genesisForkVersion: string;
  };
};

export type Web3SignerRandaoRevealMsg = {
  type: "RANDAO_REVEAL";
  data: {
    epoch: Epoch;
  };
};

export type Web3SignerVoluntaryExitMsg = {
  type: "VOLUNTARY_EXIT";
  data: VoluntaryExit;
};
export type Web3SignerSyncCommitteeMessageMsg = {
  type: "SYNC_COMMITTEE_MESSAGE";
  data: {
    beaconBlockRoot: Uint8Array;
    slot: Slot;
  };
};
export type Web3SignerSyncCommitteeSelectionProofMsg = {
  type: "SYNC_COMMITTEE_SELECTION_PROOF";
  data: {
    slot: Slot;
    subcommitteeIndex: string;
  };
};

export type Web3SignerSyncCommitteeContributionAndProofMsg = {
  type: "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF";
  data: {
    aggregatorIndex: number;
    selectionProof: Uint8Array;
    contribution: SyncCommitteeContribution;
  };
};

export type Web3SignerValidatorRegistrationMsg = {
  type: "VALIDATOR_REGISTRATION";
  data: ValidatorRegistrationV1;
};

export type SignableMessage = {
  singablePayload: SingablePayload;
  forkInfo?: Web3SignerForkInfo;
};

export type SingablePayload =
  | Web3SignerAggregationSlotMsg
  | Web3SignerAggregateAndProofMsg
  | Web3SignerAttestationMsg
  | Web3SignerBlockV2Msg
  | Web3SignerDepositMsg
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

function convertToRequest(signableMessage: SignableMessage): Record<string, unknown> {
  let forkInfo;
  const signableType = signableMessage.singablePayload.type;
  const data = signableMessage.singablePayload.data;

  if (signableType != "DEPOSIT" && signableType != "VALIDATOR_REGISTRATION") {
    if (signableMessage.forkInfo === undefined) {
      throw new Error("Attempt to call remote signer without fork info");
    }

    forkInfo = {
      fork: {
        previous_version: toHexString(signableMessage.forkInfo.fork.previousVersion),
        current_version: toHexString(signableMessage.forkInfo.fork.currentVersion),
        epoch: String(signableMessage.forkInfo.fork.epoch),
      },
      genesis_validators_root: toHexString(signableMessage.forkInfo.genesisValidatorRoot),
    };
  }

  const requestObj = {
    type: signableType,
    fork_info: forkInfo,
  };

  if (signableType === "SYNC_COMMITTEE_SELECTION_PROOF") {
    return {
      ...requestObj,
      sync_aggregator_selection_data: serializerMap[signableType](data),
    };
  } else if (signableType === "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF") {
    return {
      ...requestObj,
      contribution_and_proof: serializerMap[signableType](data),
    };
  } else {
    return {
      ...requestObj,
      [signableType.toLocaleLowerCase()]: serializerMap[signableType](data as Record<string, unknown>),
    };
  }
}
