import {restApiOptionsDefault, RestApiOptions} from "./rest";

export interface IApiOptions {
  maxGindicesInProof?: number;
  rest: RestApiOptions;
  version?: string;
}

export const defaultApiOptions: IApiOptions = {
  maxGindicesInProof: 512,
  rest: restApiOptionsDefault,
  version: "dev",
};
