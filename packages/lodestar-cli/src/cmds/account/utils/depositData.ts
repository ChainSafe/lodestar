import fs from "fs";
import {ContractTransaction, ethers, Wallet} from "ethers";
import bls, {PrivateKey, PublicKey} from "@chainsafe/bls";
import {hash} from "@chainsafe/ssz";
import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {DomainType} from "../constants";
import {IEthersAbi} from "./interface";
import {computeSigningRoot, computeDomain} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";

const VOTING_KEYSTORE_FILE = "voting-keystore.json";
const WITHDRAWAL_KEYSTORE_FILE = "withdrawal-keystore.json";
const ETH1_DEPOSIT_DATA_FILE = "eth1-deposit-data.rlp";
const ETH1_DEPOSIT_AMOUNT_FILE = "eth1-deposit-gwei.txt";

export function encodeEth1TxData(depositData: DepositData): string {
  const params = [
    depositData.pubkey.as_ssz_bytes(),
    depositData.withdrawal_credentials.as_ssz_bytes(),
    depositData.signature.as_ssz_bytes(),
    depositData.tree_hash_root().as_ssz_bytes(),
  ];

  return encodeAbiFunction("deposit", params);
}


export function decodeEth1TxData(bytes: &[u8], amount: u64) {
  const tokens = decodeAbiFunction("deposit", bytes);

  const root = decodeToken(Hash256);

  const depositData: DepositData = {
    amount,
    signature: decodeToken(SignatureBytes),
    withdrawalCredentials: decode_token(Hash256),
    pubkey: decode_token(PublicKeyBytes)
  };

  return {depositData, root};
}

export function buildDepositData() {
  // Attempt to decrypt the voting keypair.
  const votingKeypair = votingKeystore.decryptKeypair(votingPassword);
  const withdrawal_keypair = withdrawalKeystore.decryptKeypair(withdrawalPassword);

  const {depositData, root} = createDepositData(
    amount,
    withdrawalPublicKey,
    signingKey,
    config
  );

  const depositDataEncoded = contract.deposit(
    depositData.pubkey,
    depositData.withdrawalCredentials,
    depositData.signature,
    root,
    {value: fromGweiToWei(depositData.amount)}
  );
  
  if (fs.existsSync(ETH1_DEPOSIT_DATA_FILE))
    throw Error(`ETH1_DEPOSIT_DATA_FILE already exists ${ETH1_DEPOSIT_DATA_FILE}`);
  if (fs.existsSync(ETH1_DEPOSIT_AMOUNT_FILE))
    throw Error(`ETH1_DEPOSIT_AMOUNT_FILE already exists ${ETH1_DEPOSIT_AMOUNT_FILE}`);
  
  // Save `ETH1_DEPOSIT_DATA_FILE` to file.
  // This allows us to know the RLP data for the eth1 transaction without needing to know
  // the withdrawal/voting keypairs again at a later date.
  fs.writeFileSync(ETH1_DEPOSIT_DATA_FILE, depositDataEncoded);
  // Save `ETH1_DEPOSIT_AMOUNT_FILE` to file.
  // This allows us to know the intended deposit amount at a later date.
  fs.writeFileSync(ETH1_DEPOSIT_AMOUNT_FILE, depositData.amount);
}

/**
 * Constructs signed deposit data
 * @param amount 
 * @param withdrawalPublicKey 
 * @param signingKey 
 * @param config 
 */
export function createDepositData(
  amount: bigint,
  withdrawalPublicKey: PublicKey,
  signingKey: PrivateKey,
  config: IBeaconConfig
): {depositData: DepositData; root: Uint8Array} {
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

  const root = config.types.DepositData.hashTreeRoot(depositData);

  return {depositData, root};
}