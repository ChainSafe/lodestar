import { ethers, Contract } from 'ethers';
import { EtherscanProvider } from 'ethers/providers';

// Relative imports
import { Deposit } from '../interfaces/blocks';
import { MAINNET_DEPOSIT_ADDRESS, DEPOSIT_CONTRACT_ADDRESS, DEPOSIT_CONTRACT_BLOCK_NUMBER } from "../constants/constants";

// Type stubs
type int = number;
type bytes = number;
type uint24 = number;
type hash32 = string;

// NOTE: 
// Currently the workflow is to call `pollDepositContract` and essential let it run until the `chainStart` log is emitted.
// If we move to a class based approach it might work better.
const Start = (): void => {
  pollDepositContract()
  // getInitialBeaconState()
};

const pollDepositContract = () => {
  const deposits: Deposit[] = [];
  // Connect to the network
  let provider = ethers.getDefaultProvider();
  let depositContract: ethers.Contract = new ethers.Contract(MAINNET_DEPOSIT_ADDRESS, abi, provider);
  let topic: string = depositContract.ChainStart();
  let filter: ethers.EventFilter = {
    address: MAINNET_DEPOSIT_ADDRESS,
    topics: [ topic ]
  }

  // For every deposit push to `deposits`
  provider.on(filter, (previousReceiptRoot, data, totalDepositcount, log) => {
    const newReceipt: Deposit = {
      depositData: data,
      merkleBranch: previousReceiptRoot,
      merkleTreeIndex: totalDepositcount
    };
    deposits.push(newReceipt);
  });

  // Reset filter to start when the contract was mined.
  provider.resetEventsBlock(DEPOSIT_CONTRACT_BLOCK_NUMBER);
};

export default Start;
