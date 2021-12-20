import fetch from "cross-fetch";
import {PublicKey, SecretKey} from "@chainsafe/bls";
import {routes} from "@chainsafe/lodestar-api";
import {CommitteeIndex, SubCommitteeIndex} from "@chainsafe/lodestar-types";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import {BLSPubkey} from "@chainsafe/lodestar-types";
import {PubkeyHex, BLSKeypair} from "../types";
import {AttDutyAndProof} from "./attestationDuties";
import {SyncDutyAndProofs, SyncSelectionProof} from "./syncCommitteeDuties";

/** Sync committee duty associated to a single sub committee subnet */
export type SubCommitteeDuty = {
  duty: routes.validator.SyncDuty;
  selectionProof: SyncSelectionProof["selectionProof"];
};

export type ResponseType = {
  signature: string;
};

export type PublicKeysObject = {
  keys: string[];
};

export type UpcheckObject = {
  status: string;
};

export function mapSecretKeysToValidators(secretKeys: SecretKey[]): Map<PubkeyHex, BLSKeypair> {
  const validators: Map<PubkeyHex, BLSKeypair> = new Map<PubkeyHex, BLSKeypair>();
  for (const secretKey of secretKeys) {
    const publicKey = secretKey.toPublicKey().toBytes();
    validators.set(toHexString(publicKey), {publicKey, secretKey});
  }
  return validators;
}

/**
 * Function used when remote signer being used.
 * For consistency with mapSecretKeysToValidators returns a mapping of the same data type,
 * but secret key for each BLSKeypair is undefined.
 */
export function mapPublicKeysToValidators(publicKeys: PublicKey[], secretKey: SecretKey): Map<PubkeyHex, BLSKeypair> {
  const validators: Map<PubkeyHex, BLSKeypair> = new Map<PubkeyHex, BLSKeypair>();
  for (const pub of publicKeys) {
    const publicKey = pub.toBytes();
    validators.set(toHexString(publicKey), {publicKey, secretKey});
  }
  return validators;
}

export function getAggregationBits(committeeLength: number, validatorIndexInCommittee: number): boolean[] {
  return Array.from({length: committeeLength}, (_, i) => i === validatorIndexInCommittee);
}

export function groupAttDutiesByCommitteeIndex(duties: AttDutyAndProof[]): Map<CommitteeIndex, AttDutyAndProof[]> {
  const dutiesByCommitteeIndex = new Map<CommitteeIndex, AttDutyAndProof[]>();

  for (const dutyAndProof of duties) {
    const {committeeIndex} = dutyAndProof.duty;
    let dutyAndProofArr = dutiesByCommitteeIndex.get(committeeIndex);
    if (!dutyAndProofArr) {
      dutyAndProofArr = [];
      dutiesByCommitteeIndex.set(committeeIndex, dutyAndProofArr);
    }
    dutyAndProofArr.push(dutyAndProof);
  }

  return dutiesByCommitteeIndex;
}

export function groupSyncDutiesBySubCommitteeIndex(
  duties: SyncDutyAndProofs[]
): Map<SubCommitteeIndex, SubCommitteeDuty[]> {
  const dutiesBySubCommitteeIndex = new Map<SubCommitteeIndex, SubCommitteeDuty[]>();

  for (const validatorDuty of duties) {
    for (const {selectionProof, subCommitteeIndex} of validatorDuty.selectionProofs) {
      let dutyAndProofArr = dutiesBySubCommitteeIndex.get(subCommitteeIndex);
      if (!dutyAndProofArr) {
        dutyAndProofArr = [];
        dutiesBySubCommitteeIndex.set(subCommitteeIndex, dutyAndProofArr);
      }
      dutyAndProofArr.push({duty: validatorDuty.duty, selectionProof: selectionProof});
    }
  }

  return dutiesBySubCommitteeIndex;
}

/**
 * Return signature in bytes. Assumption that the pubkey has it's corresponding secret key in the keystore of the remote signer.
 */
export async function requestSignature(
  pubkey: string | BLSPubkey,
  signingRoot: string | Uint8Array,
  remoteSignerUrl: string
): Promise<Uint8Array> {
  const pubkeyHex = typeof pubkey === "string" ? pubkey : toHexString(pubkey);
  const signingRootHex = typeof signingRoot === "string" ? signingRoot : toHexString(signingRoot);
  const body = {
    signingRoot: signingRootHex,
  };

  try {
    const url = `${remoteSignerUrl}/sign/${pubkeyHex}`;
    const headers = {
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    });

    const resJSON = <ResponseType>await res.json();
    const sigBytes = fromHexString(resJSON.signature);
    return sigBytes;
  } catch (err) {
    throw Error(`Request to remote signer API failed: ${err}`);
  }
}

/**
 * Return public keys from the server.
 */
export async function requestKeys(remoteUrl: string | undefined): Promise<string[]> {
  try {
    const url = `${remoteUrl}/keys`;
    const headers = {
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method: "GET",
      headers: headers,
    });

    const resJSON = <PublicKeysObject>await res.json();
    return resJSON.keys;
  } catch (err) {
    throw Error(`Request to retrieve public keys failed: ${err}`);
  }
}

/**
 * Return public keys from the server.
 */
export async function serverUpCheck(remoteUrl: string): Promise<boolean> {
  try {
    const url = `${remoteUrl}/upcheck`;
    const headers = {
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method: "GET",
      headers: headers,
    });

    const resJSON = <UpcheckObject>await res.json();
    return resJSON.status === "OK";
  } catch (err) {
    throw Error(`Request to retrieve public keys failed: ${err}`);
  }
}
