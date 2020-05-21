import {ILogger, WinstonLogger} from "../../../src";

describe("winston logger", () => {

  it("should log profile", () => {
    const logger: ILogger = new WinstonLogger();

    logger.profile("test");

    setTimeout(function () {
      //
      // Stop profile of 'test'. Logging will now take place:
      //   '17 Jan 21:00:00 - info: test duration=1000ms'
      //
      logger.profile("test");
    }, 1000);
  });

});