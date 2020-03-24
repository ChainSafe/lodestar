import restApiDefaultOptions, {IRestApiOptions} from "./rest/options";


export interface IApiOptions {
  rest: IRestApiOptions;
}

export default {
  rest: restApiDefaultOptions
};
