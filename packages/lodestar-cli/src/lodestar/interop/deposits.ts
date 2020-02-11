import {hash, TreeBackedValue, List} from "@chainsafe/ssz";
import {Deposit, DepositData, Root} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {sign} from "@chainsafe/bls";
import {DomainType} from "@chainsafe/lodestar/lib/constants";
import {interopKeypairs} from "./keypairs";
import {computeDomain} from "@chainsafe/eth2.0-state-transition";

export function interopDeposits(
  config: IBeaconConfig,
  depositDataRootList: TreeBackedValue<List<Root>>,
  validatorCount: number
): Deposit[] {
  const tree = depositDataRootList.backing();
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
      config.types.DepositMessage.hashTreeRoot(data),
      computeDomain(DomainType.DEPOSIT),
    );
    // Add to merkle tree
    depositDataRootList.push(config.types.DepositData.hashTreeRoot(data));
    return {
      proof: tree.getSingleProof(depositDataRootList.gindexOfProperty(i)),
      data,
    };
  });
}
