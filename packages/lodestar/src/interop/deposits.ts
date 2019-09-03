import {Deposit, DepositData} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {hash, signingRoot, hashTreeRoot} from "@chainsafe/ssz";
import {sign} from "@chainsafe/bls";

import {DomainType, DEPOSIT_CONTRACT_TREE_DEPTH} from "../constants";
import {ProgressiveMerkleTree} from "../util/merkleTree";
import {interopKeypairs} from "./keypairs";
import {computeDomain} from "../chain/stateTransition/util";

export function interopDeposits(config: IBeaconConfig, validatorCount: number): Deposit[] {
  const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH);
  return interopKeypairs(validatorCount).map(({pubkey, privkey}, i) => {
    // create DepositData
    const data: DepositData = {
      pubkey,
      withdrawalCredentials: Buffer.concat([
        config.params.BLS_WITHDRAWAL_PREFIX_BYTE,
        hash(pubkey).slice(1),
      ]),
      amount: config.params.MAX_EFFECTIVE_BALANCE,
      signature: Buffer.alloc(0),
    };
    data.signature = sign(
      privkey,
      signingRoot(data, config.types.DepositData),
      computeDomain(DomainType.DEPOSIT),
    );
    // Add to merkle tree
    tree.add(i, hashTreeRoot(data, config.types.DepositData));
    return {
      proof: tree.getProof(i),
      data,
    };
  });
}
