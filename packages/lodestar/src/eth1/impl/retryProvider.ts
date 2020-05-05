import {JsonRpcProvider} from "ethers/providers";
import {Networkish} from "ethers/utils";
import {ConnectionInfo, poll} from "ethers/utils/web";

// https://github.com/ethers-io/ethers.js/issues/427#issuecomment-465329448

export class RetryProvider extends JsonRpcProvider {
  public attempts: number;

  constructor(
    attempts: number,
    url?: ConnectionInfo | string,
    network?: Networkish
  ) {
    super(url, network);
    this.attempts = attempts;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public perform(method: string, params: any): any {
    let attempts = 0;
    return poll(() => {
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
