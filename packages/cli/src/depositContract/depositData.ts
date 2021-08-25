import {ethers} from "ethers";
import {hash, Json, toHexString} from "@chainsafe/ssz";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import bls, {SecretKey, PublicKey} from "@chainsafe/bls";
import {computeSigningRoot, computeDomain, ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {BLS_WITHDRAWAL_PREFIX, DOMAIN_DEPOSIT} from "@chainsafe/lodestar-params";

const depositFunctionFragment =
  "function deposit(bytes pubkey, bytes withdrawal_credentials, bytes signature, bytes32 deposit_data_root) external payable;";

function getDepositInterface(): ethers.utils.Interface {
  return new ethers.utils.Interface([depositFunctionFragment]);
}

export function decodeEth1TxData(bytes: string, amount: string): {depositData: phase0.DepositData; root: string} {
  const depositContract = getDepositInterface();
  const inputs: Json = depositContract.decodeFunctionData("deposit", bytes);
  const {deposit_data_root: root} = inputs;

  const depositData: phase0.DepositData = ssz.phase0.DepositData.fromJson(
    // attach `amount` to decoded deposit inputs so it can be parsed to a DepositData
    {...inputs, amount},
    {case: "snake"}
  );

  // Sanity check
  const depositDataRoot = ssz.phase0.DepositData.hashTreeRoot(depositData);
  if (toHexString(depositDataRoot) !== root) throw Error("deposit data root mismatch");

  return {depositData, root: root as string};
}

export function encodeDepositData(
  amount: number,
  withdrawalPublicKey: PublicKey,
  signingKey: SecretKey,
  config: IChainForkConfig
): string {
  const pubkey = signingKey.toPublicKey().toBytes();
  const withdrawalCredentials = Buffer.concat([BLS_WITHDRAWAL_PREFIX, hash(withdrawalPublicKey.toBytes()).slice(1)]);

  // deposit data with empty signature to sign
  const depositData: phase0.DepositData = {
    pubkey,
    withdrawalCredentials,
    amount,
    signature: Buffer.alloc(96),
  };

  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const signingroot = computeSigningRoot(ssz.phase0.DepositMessage, depositData, domain);
  depositData.signature = bls.sign(signingKey.toBytes(), signingroot);

  const depositDataRoot = ssz.phase0.DepositData.hashTreeRoot(depositData);

  const depositContract = getDepositInterface();
  return depositContract.encodeFunctionData("deposit", [
    pubkey,
    withdrawalCredentials,
    depositData.signature,
    depositDataRoot,
  ]);
}
