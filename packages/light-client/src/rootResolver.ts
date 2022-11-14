/** (optional) Integer (hex) block number, or the string 'latest', 'earliest' or 'pending' */
type QuantityOrTag = number | string | undefined;

interface ExecutionHeaderSummary {
  blockNumber: number;
  stateRoot: string;
}

export interface ILightclient {
  onHead(handler: (head: ExecutionHeaderSummary) => void): void;
}

export interface IRootResolver {
  resolveQuantityOrTag(quantityOrTag: QuantityOrTag): ExecutionHeaderSummary;
}

export class RootResolver implements IRootResolver {
  private readonly headers = new Map<number, ExecutionHeaderSummary>();
  private latestHead: ExecutionHeaderSummary | null = null;

  constructor(private readonly lightclient: ILightclient) {
    lightclient.onHead((head) => {
      this.headers.set(head.blockNumber, head);
      this.latestHead = head;
    });
  }

  resolveQuantityOrTag(quantityOrTag: QuantityOrTag): ExecutionHeaderSummary {
    if (typeof quantityOrTag === "number") {
      const head = this.headers.get(quantityOrTag);
      if (head) {
        return head;
      } else {
        throw Error(`No head for blockNumber ${quantityOrTag}`);
      }
    } else if (typeof quantityOrTag === "string") {
      // TODO: How to handle hex number string better?
      if (quantityOrTag.startsWith("0x")) {
        const blockNumber = parseInt(quantityOrTag);
        const head = this.headers.get(blockNumber);
        if (head) {
          return head;
        } else {
          throw Error(`No head for blockNumber ${quantityOrTag}`);
        }
      }

      if (quantityOrTag === "latest") {
        if (this.latestHead) {
          return this.latestHead;
        } else {
          throw Error("No latest head available");
        }
      } else {
        throw Error(`tag '${quantityOrTag}' not supported`);
      }
    } else {
      throw Error(`quantityOrTag '${quantityOrTag}' not supported`);
    }
  }
}
