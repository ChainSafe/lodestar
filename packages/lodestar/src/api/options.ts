import {restApiOptionsDefault, RestApiOptions} from "./rest";

export interface IApiOptions {
  maxGindicesInProof?: number;
  rest: RestApiOptions;
}

export const defaultApiOptions: IApiOptions = {
  maxGindicesInProof: 512,
  rest: restApiOptionsDefault,
};
