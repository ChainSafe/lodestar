/**
 * Calculates increment rate in given time period
 */
export class RateCounter {

  private readonly timePeriod: number;

  private count = 0;
  private since: number;
  private timer: NodeJS.Timeout;

  /**
     *
     * @param timePeriod in seconds
     */
  constructor(timePeriod: number) {
    if(timePeriod < 1) {
      throw "time period must be greater or equal 1 second";
    }
    this.timePeriod = timePeriod;
  }

  public async start(): Promise<void> {
    this.resetRate();
    this.timer = setInterval(this.resetRate, this.timePeriod * 1000);
  }

  public async stop(): Promise<void> {
    if(this.timer) {
      clearInterval(this.timer);
    }
  }

  public increment(inc = 1): void {
    this.count += inc;
  }

  public rate(): number {
    if(this.count == 0) {
      return 0;
    }
    const diff = new Date().getTime() - this.since;
    return this.count / (diff / 1000);
  }

  private resetRate = (): void => {
    this.since = new Date().getTime();
    this.count = 0;
  };

}
