import { ethers, Contract } from 'ethers';

// Relative imports
import { MAINNET_DEPOSIT_ADDRESS, DEPOSIT_CONTRACT_ADDRESS, DEPOSIT_CONTRACT_BLOCK_NUMBER } from "../constants/constants";
import { EtherscanProvider } from 'ethers/providers';

const Start = (): void => {
  pollDepositContract()
  // getInitialBeaconState()
};

// This is stubbed
const pollDepositContract = () => {
  // Connect to the network
  let provider = ethers.getDefaultProvider();
  let depositContract: ethers.Contract = new ethers.Contract(MAINNET_DEPOSIT_ADDRESS, abi, provider);
  let topic: string = depositContract.ChainStart();
  let filter: ethers.EventFilter = {
    address: MAINNET_DEPOSIT_ADDRESS,
    topics: [ topic ]
  }

  provider.on(filter, (event) => {
    console.log(event);
    return true;
  });
  // Reset filter to start when the contract was mined.
  provider.resetEventsBlock(DEPOSIT_CONTRACT_BLOCK_NUMBER);
};

export default Start;
