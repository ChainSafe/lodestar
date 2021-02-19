export interface IGossipHandler {
  start(): void;
  stop(): void;
  handleSyncCompleted(): void;
}
