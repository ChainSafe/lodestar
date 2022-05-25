import {ICliCommandOptions} from "../util/index.js";
import {restApiOptionsDefault} from "@chainsafe/lodestar-keymanager-server";

export type KeymanagerArgs = {
  keymanagerEnabled?: boolean;
  keymanagerAuthEnabled?: boolean;
  keymanagerPort?: number;
  keymanagerHost?: string;
  keymanagerCors?: string;
};

export const keymanagerOptions: ICliCommandOptions<KeymanagerArgs> = {
  keymanagerEnabled: {
    type: "boolean",
    description: "Enable keymanager API server",
    default: false,
    group: "keymanager",
  },
  keymanagerAuthEnabled: {
    type: "boolean",
    description: "Enable token bearer authentication for keymanager API server",
    default: true,
    group: "keymanager",
  },
  keymanagerPort: {
    type: "number",
    description: "Set port for keymanager API",
    defaultDescription: String(restApiOptionsDefault.port),
    group: "keymanager",
  },
  keymanagerHost: {
    type: "string",
    description: "Set host for keymanager API",
    defaultDescription: restApiOptionsDefault.host,
    group: "keymanager",
  },
  keymanagerCors: {
    type: "string",
    description: "Configures the Access-Control-Allow-Origin CORS header for keymanager API",
    defaultDescription: restApiOptionsDefault.cors,
    group: "keymanager",
  },
};
