import {ApiNamespace} from "../index";

export interface IRestApiOptions {
  enabled: boolean;
  api: ApiNamespace[];
  host: string;
  cors: string;
  port: number;
}

export default {
  enabled: false,
  api: [ApiNamespace.BEACON, ApiNamespace.NODE, ApiNamespace.VALIDATOR],
  host: "127.0.0.1",
  port: 9596,
  cors: "*"
};
