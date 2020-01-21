import {Deposit, DepositData} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {hash, hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {sign} from "@chainsafe/bls";
import {DomainType} from "@chainsafe/lodestar/lib/constants";
import {IProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";
import {interopKeypairs} from "./keypairs";
import {computeDomain} from "@chainsafe/eth2.0-state-transition";

export function interopDeposits(
  config: IBeaconConfig,
  tree: IProgressiveMerkleTree,
  validatorCount: number
): Deposit[] {
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
      signingRoot(config.types.DepositData, data),
      computeDomain(DomainType.DEPOSIT),
    );
    // Add to merkle tree
    tree.add(i, hashTreeRoot(config.types.DepositData, data));
    return {
      proof: tree.getProof(i),
      data,
    };
  });
}
