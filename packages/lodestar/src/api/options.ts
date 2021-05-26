import {restApiOptionsDefault, RestApiOptions} from "./rest";

export interface IApiOptions {
  rest: RestApiOptions;
}

export const defaultApiOptions: IApiOptions = {
  rest: restApiOptionsDefault,
};
