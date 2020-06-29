import {ethers} from "ethers";

// https://github.com/ethers-io/ethers.js/issues/427#issuecomment-465329448

export class RetryProvider extends ethers.providers.JsonRpcProvider {
  public attempts: number;

  constructor(
    attempts: number,
    url?: ethers.utils.ConnectionInfo | string,
    network?: ethers.providers.Networkish
  ) {
    super(url, network);
    this.attempts = attempts;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public perform(method: string, params: any): any {
    let attempts = 0;
    return ethers.utils.poll(() => {
      attempts++;
      return super.perform(method, params).then(
        result => {
          return result;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error: any) => {
          if (attempts >= this.attempts) {
            return Promise.reject(error);
          } else {
            return Promise.resolve(undefined);
          }
        }
      );
    });
  }
}
