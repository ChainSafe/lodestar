import schemaJson from "./beacon-node-oapi.json" assert {type: "json"};
import {version} from "./version.js";

export const schema = schemaJson;
export const version = version;
