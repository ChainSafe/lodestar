import { ethers, Contract } from 'ethers';
import { EtherscanProvider } from 'ethers/providers';
import { Deposit, DepositData, DepositInput } from '../../interfaces/blocks';
import { ChainStart } from "../../interfaces/state";
import { MAINNET_DEPOSIT_ADDRESS, DEPOSIT_CONTRACT_ADDRESS, DEPOSIT_CONTRACT_BLOCK_NUMBER, DEPOSIT_CONTRACT_ABI } from "../../constants/constants";

// Type stubs
type int = number;
type bytes = number;
type uint24 = number;
type uint64 = number;
type hash32 = string;

/**
 * NOTE: Haven't been able to test this yet. Waiting for contracts to test against.
 * TODO: We should find a way to reject the promise somehow.
 * TODO: There is porbably a better way to scrape the logs.
 */
const waitForChainStart = () => {
  return new Promise<ChainStart>((resolve) => {
    const deposits: Deposit[] = [];

    // Connect to the network
    let provider = ethers.getDefaultProvider();

    // Deposit Contract
    let depositContract: ethers.Contract = new ethers.Contract(MAINNET_DEPOSIT_ADDRESS, DEPOSIT_CONTRACT_ABI, provider);

    // Eth1Deposit log filter
    let depositTopic: string = depositContract.Eth1Deposit();
    let depositFilter: ethers.EventFilter = {
      address: MAINNET_DEPOSIT_ADDRESS,
      topics: [ depositTopic ]
    };

    // ChainStart log filter
    let chainStartTopic: string = depositContract.ChainStart();
    let chainStartFilter: ethers.EventFilter = {
      address: MAINNET_DEPOSIT_ADDRESS,
      topics: [ chainStartTopic ]
    };

    // Listen for Eth1Deposit logs
    provider.on(depositFilter, (previousReceiptRoot: hash32[], data: DepositData, totalDepositcount: uint64, log) => {
      const newDeposit: Deposit = formatDeposit(previousReceiptRoot, data, totalDepositcount);
      deposits.push(newDeposit);
    });

    // Listen for ChainStart log
    // Resolve the promise on ChainStart as we will need to generate initial state.
    // Deposits are also handled differently after the points
    provider.on(chainStartFilter, (receiptRoot, time, log) => {
      resolve({ deposits, receiptRoot, time });
    });

    // Reset filter to start when the contract was mined.
    provider.resetEventsBlock(DEPOSIT_CONTRACT_BLOCK_NUMBER);
  });
};

// TODO Remove `any` from data field.
const formatDeposit = (previousReceiptRoot: hash32[], data: any, totalDepositCount: uint64): Deposit => {
  // Reassign values to stay consistent with camel case
  const depositInput: DepositInput = {
    pubkey: data.deposit_input.pubkey,
    proofOfPossession: data.deposit_input.proof_of_possession,
    withdrawalCredentials: data.deposit_input.withdrawal_credentials,
    randaoCommitment: data.deposit_input.randao_commitment,
    pocCommitment: data.deposit_input.poc_commitment
  };

  const depositData: DepositData = {
    depositInput: depositInput,
    value: data.msg_gwei_bytes8,
    timestamp: data.timestamp_bytes8
  };

  return {
    depositData: depositData,
    merkleBranch: previousReceiptRoot,
    merkleTreeIndex: totalDepositCount
  };
};

export {
  waitForChainStart,
};
