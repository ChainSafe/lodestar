import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {IChainConfig} from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
export const defaultChainConfig = require(`./presets/${ACTIVE_PRESET}`).chainConfig as IChainConfig;
