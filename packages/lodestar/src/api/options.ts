import {defaultApiRestOptions, IRestApiOptions} from "./rest/options";

export interface IApiOptions {
  rest: IRestApiOptions;
}

export const defaultApiOptions: IApiOptions = {
  rest: defaultApiRestOptions,
};
