import {hash, TreeBacked, List} from "@chainsafe/ssz";
import {Deposit, DepositData, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {sign} from "@chainsafe/bls";
import {interopKeypairs} from "@chainsafe/lodestar-validator";
import {computeDomain, computeSigningRoot} from "@chainsafe/lodestar-beacon-state-transition";
import {DomainType} from "../../../constants";

export function interopDeposits(
  config: IBeaconConfig,
  depositDataRootList: TreeBacked<List<Root>>,
  validatorCount: number
): Deposit[] {
  const tree = depositDataRootList.tree();
  return interopKeypairs(validatorCount).map(({pubkey, privkey}, i) => {
    // create DepositData
    const data: DepositData = {
      pubkey,
      withdrawalCredentials: Buffer.concat([
        config.params.BLS_WITHDRAWAL_PREFIX,
        hash(pubkey).slice(1),
      ]),
      amount: config.params.MAX_EFFECTIVE_BALANCE,
      signature: Buffer.alloc(0),
    };
    const domain = computeDomain(config, DomainType.DEPOSIT);
    const signingRoot = computeSigningRoot(config, config.types.DepositMessage, data, domain);
    data.signature = sign(
      privkey,
      signingRoot
    );
    // Add to merkle tree
    depositDataRootList.push(config.types.DepositData.hashTreeRoot(data));
    return {
      proof: tree.getSingleProof(depositDataRootList.gindexOfProperty(i)),
      data,
    };
  });
}
