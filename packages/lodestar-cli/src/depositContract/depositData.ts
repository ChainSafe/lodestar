import {ethers} from "ethers";
import {hash, Json, toHexString} from "@chainsafe/ssz";
import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import bls, {PrivateKey, PublicKey} from "@chainsafe/bls";
import {computeSigningRoot, computeDomain, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import eth1Options from "@chainsafe/lodestar/lib/eth1/options";


function getDepositInterface(): ethers.utils.Interface {
  return new ethers.utils.Interface(eth1Options.depositContract.abi);
}

export function decodeEth1TxData(
  bytes: string,
  amount: string,
  config: IBeaconConfig
): {depositData: DepositData; root: string} {
  const depositContract = getDepositInterface();
  const inputs: Json = depositContract.decodeFunctionData("deposit", bytes);
  const {
    deposit_data_root: root,
  } = inputs;
  // attach `amount` to decoded deposit inputs so it can be parsed to a DepositData
  inputs.amount = amount;

  const depositData: DepositData = config.types.DepositData.fromJson(inputs, {case: "snake"});

  // Sanity check
  const depositDataRoot = config.types.DepositData.hashTreeRoot(depositData);
  if (toHexString(depositDataRoot) !== root)
    throw Error("deposit data root mismatch");

  return {depositData, root: root as string};
}


export function encodeDepositData(
  amount: bigint,
  withdrawalPublicKey: PublicKey,
  signingKey: PrivateKey,
  config: IBeaconConfig
): string {
  const pubkey = signingKey.toPublicKey().toBytesCompressed();
  const withdrawalCredentials = Buffer.concat([
    config.params.BLS_WITHDRAWAL_PREFIX,
    hash(withdrawalPublicKey.toBytesCompressed()).slice(1),
  ]);

  // deposit data with empty signature to sign
  const depositData: DepositData = {
    pubkey,
    withdrawalCredentials,
    amount,
    signature: Buffer.alloc(96)
  };

  const domain = computeDomain(config, DomainType.DEPOSIT);
  const signingroot = computeSigningRoot(config, config.types.DepositMessage, depositData, domain);
  depositData.signature = bls.sign(
    signingKey.toBytes(),
    signingroot
  );

  const depositDataRoot = config.types.DepositData.hashTreeRoot(depositData);

  const depositContract = getDepositInterface();
  return depositContract.encodeFunctionData("deposit", [
    pubkey,
    withdrawalCredentials,
    depositData.signature,
    depositDataRoot
  ]);
}
