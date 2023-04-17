import {ChainConfig} from "@lodestar/config";

export type IBeaconParamsUnparsed = Partial<{[P in keyof ChainConfig]: string | number}>;
