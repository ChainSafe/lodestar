import {digest} from "@chainsafe/as-sha256";
import {phase0, ssz} from "@lodestar/types";
import {toGindex, Tree} from "@chainsafe/persistent-merkle-tree";
import {ChainConfig} from "@lodestar/config";
import {computeDomain, computeSigningRoot, interopSecretKeys, ZERO_HASH} from "@lodestar/state-transition";
import {
  BLS_WITHDRAWAL_PREFIX,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  DOMAIN_DEPOSIT,
  MAX_EFFECTIVE_BALANCE,
} from "@lodestar/params";
import {DepositTree} from "../../../db/repositories/depositDataRoot.js";

/**
 * Compute and return deposit data from other validators.
 */
export function interopDeposits(
  config: ChainConfig,
  depositDataRootList: DepositTree,
  validatorCount: number,
  {withEth1Credentials}: {withEth1Credentials?: boolean} = {}
): phase0.Deposit[] {
  depositDataRootList.commit();
  const depositTreeDepth = depositDataRootList.type.depth;
  // set credentials if we want withdrawal on or off
  const withdrawalCredentialsPrefix = withEth1Credentials ? ETH1_ADDRESS_WITHDRAWAL_PREFIX : BLS_WITHDRAWAL_PREFIX;

  return interopSecretKeys(validatorCount).map((secretKey, i) => {
    const pubkey = secretKey.toPublicKey().toBytes();

    // create DepositData
    const withdrawalCredentials = digest(pubkey);
    withdrawalCredentials[0] = withdrawalCredentialsPrefix;
    const data: phase0.DepositData = {
      pubkey,
      withdrawalCredentials,
      amount: MAX_EFFECTIVE_BALANCE,
      signature: Buffer.alloc(0),
    };

    const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, data, domain);
    data.signature = secretKey.sign(signingRoot).toBytes();

    // Add to merkle tree
    depositDataRootList.push(ssz.phase0.DepositData.hashTreeRoot(data));
    depositDataRootList.commit();
    return {
      proof: new Tree(depositDataRootList.node).getSingleProof(toGindex(depositTreeDepth, BigInt(i))),
      data,
    };
  });
}
