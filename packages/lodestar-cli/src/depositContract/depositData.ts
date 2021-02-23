import {ethers} from "ethers";
import {hash, Json, toHexString} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import bls, {SecretKey, PublicKey} from "@chainsafe/bls";
import {computeSigningRoot, computeDomain} from "@chainsafe/lodestar-beacon-state-transition";

const depositFunctionFragment =
  "function deposit(bytes pubkey, bytes withdrawal_credentials, bytes signature, bytes32 deposit_data_root) external payable;";

function getDepositInterface(): ethers.utils.Interface {
  return new ethers.utils.Interface([depositFunctionFragment]);
}

export function decodeEth1TxData(
  bytes: string,
  amount: string,
  config: IBeaconConfig
): {depositData: phase0.DepositData; root: string} {
  const depositContract = getDepositInterface();
  const inputs: Json = depositContract.decodeFunctionData("deposit", bytes);
  const {deposit_data_root: root} = inputs;

  const depositData: phase0.DepositData = config.types.phase0.DepositData.fromJson(
    // attach `amount` to decoded deposit inputs so it can be parsed to a DepositData
    {...inputs, amount},
    {case: "snake"}
  );

  // Sanity check
  const depositDataRoot = config.types.phase0.DepositData.hashTreeRoot(depositData);
  if (toHexString(depositDataRoot) !== root) throw Error("deposit data root mismatch");

  return {depositData, root: root as string};
}

export function encodeDepositData(
  amount: bigint,
  withdrawalPublicKey: PublicKey,
  signingKey: SecretKey,
  config: IBeaconConfig
): string {
  const pubkey = signingKey.toPublicKey().toBytes();
  const withdrawalCredentials = Buffer.concat([
    config.params.BLS_WITHDRAWAL_PREFIX,
    hash(withdrawalPublicKey.toBytes()).slice(1),
  ]);

  // deposit data with empty signature to sign
  const depositData: phase0.DepositData = {
    pubkey,
    withdrawalCredentials,
    amount,
    signature: Buffer.alloc(96),
  };

  const domain = computeDomain(config, config.params.DOMAIN_DEPOSIT);
  const signingroot = computeSigningRoot(config, config.types.phase0.DepositMessage, depositData, domain);
  depositData.signature = bls.sign(signingKey.toBytes(), signingroot);

  const depositDataRoot = config.types.phase0.DepositData.hashTreeRoot(depositData);

  const depositContract = getDepositInterface();
  return depositContract.encodeFunctionData("deposit", [
    pubkey,
    withdrawalCredentials,
    depositData.signature,
    depositDataRoot,
  ]);
}
