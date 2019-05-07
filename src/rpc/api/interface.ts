export interface IApi {
  /**
   * Name space for API commands
   */
  namespace: string;
}

export interface IApiConstructor {
  new(args, modules): IApi;
}
