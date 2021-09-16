export interface ITransitionStore {
  /**
   * Equivalent to spec check `TransitionStore not null`.
   * Since the TransitionStore is used in fork-choice + block production it's simpler for it to be always not null,
   * and handle the initialized state internally.
   */
  initialized: boolean;
  /**
   * Cumulative total difficulty over the entire Ethereum POW network.
   * Value may not be always available
   */
  terminalTotalDifficulty: bigint;
}
