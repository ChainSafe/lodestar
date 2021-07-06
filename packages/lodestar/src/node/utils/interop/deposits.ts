import {hash, TreeBacked, List} from "@chainsafe/ssz";
import {phase0, Root, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  computeDomain,
  computeSigningRoot,
  interopSecretKeys,
  ZERO_HASH,
} from "@chainsafe/lodestar-beacon-state-transition";
import {BLS_WITHDRAWAL_PREFIX, DOMAIN_DEPOSIT, MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";

/**
 * Compute and return deposit data from other validators.
 */
export function interopDeposits(
  config: IChainForkConfig,
  depositDataRootList: TreeBacked<List<Root>>,
  validatorCount: number
): phase0.Deposit[] {
  const tree = depositDataRootList.tree;
  return interopSecretKeys(validatorCount).map((secretKey, i) => {
    const pubkey = secretKey.toPublicKey().toBytes();
    // create DepositData
    const data: phase0.DepositData = {
      pubkey,
      withdrawalCredentials: Buffer.concat([BLS_WITHDRAWAL_PREFIX, hash(pubkey).slice(1)]),
      amount: MAX_EFFECTIVE_BALANCE,
      signature: Buffer.alloc(0),
    };
    const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, data, domain);
    data.signature = secretKey.sign(signingRoot).toBytes();
    // Add to merkle tree
    depositDataRootList.push(ssz.phase0.DepositData.hashTreeRoot(data));
    return {
      proof: tree.getSingleProof(depositDataRootList.type.getPropertyGindex(i)),
      data,
    };
  });
}
