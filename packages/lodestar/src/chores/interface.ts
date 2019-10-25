export interface ITask {
  run(): Promise<void>;
}