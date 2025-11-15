import {chainConfigToJson, SpecJson} from "@lodestar/config";
import {hoodiChainConfig} from "@lodestar/config/networks";

const hoodiConfigJson = chainConfigToJson(hoodiChainConfig);
const cloneHoodiConfig = (): SpecJson => JSON.parse(JSON.stringify(hoodiConfigJson));

export const lighthouseHoodiConfig = cloneHoodiConfig();
export const prysmHoodiConfig = cloneHoodiConfig();
export const tekuHoodiConfig = cloneHoodiConfig();
export const nimbusHoodiConfig = cloneHoodiConfig();
