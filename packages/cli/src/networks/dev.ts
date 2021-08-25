/* eslint-disable @typescript-eslint/naming-convention */
import {minimalChainConfig} from "@chainsafe/lodestar-config/presets";
import {IChainConfig} from "@chainsafe/lodestar-config";

/* eslint-disable max-len */
export const chainConfig: IChainConfig = {
    ...minimalChainConfig,
    DEPOSIT_NETWORK_ID: 0,
}
export const depositContractDeployBlock = 0;
export const genesisFileUrl = "";
export const bootnodesFileUrl = "";
export const bootEnrs = [];
