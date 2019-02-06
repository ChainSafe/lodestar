import { Deposit, DepositData, DepositInput, Eth1Data } from "../types";

type int = number;

interface DummyChainStart {
  deposits: Deposit[];
  genesisTime: int;
  eth1Data: Eth1Data;
}

export function getInitialDeposits(): DummyChainStart {
  return {
    deposits: generateFakeDeposits(),
    eth1Data: generateEthData(),
    genesisTime: Date.now() / 1000 | 0,
  };
}

function generateEthData(): Eth1Data {
  return {
    blockHash: new Uint8Array(32),
    depositRoot: new Uint8Array(32),
  };
}

function generateFakeDeposits(): Deposit[] {
  const deposits: Deposit[] = [];

  for (let i: number = 0; i < 10; i++) {
    const depositInput: DepositInput = {
      proofOfPossession: new Uint8Array(2),
      pubkey: new Uint8Array(2),
      withdrawalCredentials: new Uint8Array(32),
    };

    const depositData: DepositData = {
      amount: 32000000000,
      depositInput,
      timestamp: Date.now() / 1000 | 0,
    };

    const deposit: Deposit = {
      branch: [new Uint8Array(32)],
      depositData,
      index: i,
    };
    deposits.push(deposit);
  }
  return deposits;
}
