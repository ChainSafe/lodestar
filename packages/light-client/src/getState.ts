import axios from "axios";

import {TreeBacked} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {deserializeProof} from "@chainsafe/persistent-merkle-tree";
import {config} from "@chainsafe/lodestar-config/mainnet";

const BEACON_URL = "http://localhost:9596";
const STATE_PROOF_URL = `${BEACON_URL}/eth/v1/lodestar/proof`;

const client = axios.create();

type Path = (string | number)[];

export async function getState(id: string, paths: Path[]): Promise<TreeBacked<phase0.BeaconState>> {
  const resp = await client.request({
    url: `${STATE_PROOF_URL}/${id}`,
    method: "POST",
    data: {paths},
    responseType: "arraybuffer",
  });
  const proof = deserializeProof(resp.data as Uint8Array);
  return config.types.phase0.BeaconState.createTreeBackedFromProofUnsafe(proof);
}
