import {hash, TreeBacked, List} from "@chainsafe/ssz";
import {phase0, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeDomain, computeSigningRoot, interopSecretKeys} from "@chainsafe/lodestar-beacon-state-transition";

/**
 * Compute and return deposit data from other validators.
 */
export function interopDeposits(
  config: IBeaconConfig,
  depositDataRootList: TreeBacked<List<Root>>,
  validatorCount: number
): phase0.Deposit[] {
  const tree = depositDataRootList.tree;
  return interopSecretKeys(validatorCount).map((secretKey, i) => {
    const pubkey = secretKey.toPublicKey().toBytes();
    // create DepositData
    const data: phase0.DepositData = {
      pubkey,
      withdrawalCredentials: Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX, hash(pubkey).slice(1)]),
      amount: config.params.MAX_EFFECTIVE_BALANCE,
      signature: Buffer.alloc(0),
    };
    const domain = computeDomain(config, config.params.DOMAIN_DEPOSIT);
    const signingRoot = computeSigningRoot(config, config.types.phase0.DepositMessage, data, domain);
    data.signature = secretKey.sign(signingRoot).toBytes();
    // Add to merkle tree
    depositDataRootList.push(config.types.phase0.DepositData.hashTreeRoot(data));
    return {
      proof: tree.getSingleProof(depositDataRootList.type.getPropertyGindex(i)),
      data,
    };
  });
}
