import {Deposit, DepositData, DepositInput} from "../interfaces/blocks";

type int = number;
type hash32 = Uint8Array;

interface DummyChainStart {
  deposits: Deposit[];
  genesisTime: int;
  depositRoot: hash32;
}

export function getInitialDeposits(): DummyChainStart {
  return {
    depositRoot: new Uint8Array(32),
    deposits: generateFakeDeposits(),
    genesisTime: Date.now() / 1000 | 0,
  };
}

function generateFakeDeposits(): Deposit[] {
  const deposits: Deposit[] = [];

  for (let i: number = 0; i < 10; i++) {
    const depositInput: DepositInput = {
      custodyCommitment: new Uint8Array(32),
      proofOfPossession: [486468, 486484],
      pubkey: 0xe4b32544f1d3fa0a071e3629a1a22e76dc216312,
      randaoCommitment: new Uint8Array(32),
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
