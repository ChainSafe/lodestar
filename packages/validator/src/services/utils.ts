import {PublicKey, SecretKey, Signature} from "@chainsafe/bls";
import {routes} from "@chainsafe/lodestar-api";
import {CommitteeIndex, SubCommitteeIndex} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {PubkeyHex, BLSKeypair} from "../types";
import {AttDutyAndProof} from "./attestationDuties";
import {SyncDutyAndProofs, SyncSelectionProof} from "./syncCommitteeDuties";
import {BLSPubkey} from "@chainsafe/lodestar-types";
import {init} from "@chainsafe/bls";
import fetch from "cross-fetch";

/** Sync committee duty associated to a single sub committee subnet */
export type SubCommitteeDuty = {
  duty: routes.validator.SyncDuty;
  selectionProof: SyncSelectionProof["selectionProof"];
};

type ResponseType = {
  signature: string;
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
 * but secret key for each BLSKeypair undefined.
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
  await init("blst-native");
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
    const sigBytes = Signature.fromHex(resJSON.signature).toBytes();
    return sigBytes;
  } catch (err) {
    throw Error(`Request to remote signer API failed: ${err}`);
  }
}
