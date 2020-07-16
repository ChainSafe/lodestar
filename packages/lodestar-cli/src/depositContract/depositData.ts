import {ethers} from "ethers";
import {fromHexString, hash} from "@chainsafe/ssz";
import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import bls, {PrivateKey, PublicKey} from "@chainsafe/bls";
import {computeSigningRoot, computeDomain, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import eth1Options from "@chainsafe/lodestar/lib/eth1/options";
import {YargsError} from "../util";


function getDepositInterface(): ethers.utils.Interface {
  return new ethers.utils.Interface(eth1Options.depositContract.abi);
}

export function decodeEth1TxData(
  bytes: string,
  amount: string,
  config: IBeaconConfig
): {depositData: DepositData; root: string} {
  const depositContract = getDepositInterface();
  const inputs = depositContract.decodeFunctionData("deposit", bytes);
  const [
    pubkey,
    withdrawalCredentials,
    signature,
    root
  ] = inputs;

  const depositData: DepositData = {
    amount: config.types.Gwei.deserialize(fromHexString(amount)),
    signature: fromHexString(signature),
    withdrawalCredentials: fromHexString(withdrawalCredentials),
    pubkey: fromHexString(pubkey)
  };

  // Sanity check
  const depositDataRoot = config.types.DepositData.hashTreeRoot(depositData);
  if (depositDataRoot != root)
    throw new YargsError("deposit data root mismatch");

  return {depositData, root};
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