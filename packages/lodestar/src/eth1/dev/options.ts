/**
 * @module eth1/dev
 */
import defaultEth1, {IEth1Options} from "../options";
import {ethers} from "ethers";

const config: IEth1Options = {
  enabled: true,
  provider: defaultEth1.provider,
  providerInstance: new ethers.providers.JsonRpcProvider("http://localhost:8545", 200),
  depositContract: defaultEth1.depositContract
};

export default config;
