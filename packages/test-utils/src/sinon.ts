import {SinonSpy, spy} from "sinon";

type Callback = () => void;
type Handler = (cb: Callback) => void;

/**
 * Stub the logger methods
 */
export function stubLogger(context: {beforeEach: Handler; afterEach: Handler}, logger = console): void {
  context.beforeEach(() => {
    spy(logger, "info");
    spy(logger, "log");
    spy(logger, "warn");
    spy(logger, "error");
  });

  context.afterEach(() => {
    (logger.info as SinonSpy).restore();
    (logger.log as SinonSpy).restore();
    (logger.warn as SinonSpy).restore();
    (logger.error as SinonSpy).restore();
  });
}
