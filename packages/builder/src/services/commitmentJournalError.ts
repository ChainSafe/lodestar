/** Only requests rejected before dispatch are known not to have written. A
 * worker error or missing acknowledgement can leave a durable signed offer. */
export class CommitmentJournalError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean
  ) {
    super(message);
  }
}
