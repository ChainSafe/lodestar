export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface EventContext {
  eventName: string;
  actor: string;
  repository: string;
  repositoryOwner: string | null;
  pullRequest: PullRequestRef | null;
  isForkPullRequest: boolean;
  isDependabotPullRequest: boolean;
}

export type MissingTokenSkipReason = "unmanaged_repository" | "fork_pull_request_review" | "dependabot_event";

export const MISSING_TOKEN_ERROR_CODE = "PROJECT_BOARD_CONFIG_TOKEN_MISSING";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function repositoryParts(fullName: string | null): {owner: string; repo: string} | null {
  if (!fullName) return null;
  const slash = fullName.indexOf("/");
  if (slash <= 0 || slash === fullName.length - 1 || slash !== fullName.lastIndexOf("/")) return null;
  return {owner: fullName.slice(0, slash), repo: fullName.slice(slash + 1)};
}

export function buildEventContext(
  eventName: string,
  actor: string,
  repositoryFromEnv: string,
  payload: unknown,
): EventContext {
  const root = asRecord(payload);
  const repositoryNode = asRecord(root?.repository);
  const pullRequestNode = asRecord(root?.pull_request);
  const headNode = asRecord(pullRequestNode?.head);
  const headRepositoryNode = asRecord(headNode?.repo);
  const baseNode = asRecord(pullRequestNode?.base);
  const baseRepositoryNode = asRecord(baseNode?.repo);
  const authorNode = asRecord(pullRequestNode?.user);

  const repository = stringValue(repositoryNode?.full_name) ?? (repositoryFromEnv || "(unknown)");
  const repositoryName = repositoryParts(repository);
  const pullRequestNumber = pullRequestNode?.number;
  const pullRequest =
    repositoryName && typeof pullRequestNumber === "number" ? {...repositoryName, number: pullRequestNumber} : null;

  const headRepository = stringValue(headRepositoryNode?.full_name);
  const baseRepository = stringValue(baseRepositoryNode?.full_name) ?? stringValue(repositoryNode?.full_name);
  const isForkPullRequest =
    headRepositoryNode?.fork === true ||
    (headRepository !== null && baseRepository !== null && headRepository !== baseRepository);

  return {
    eventName,
    actor,
    repository,
    repositoryOwner: repositoryName?.owner ?? null,
    pullRequest,
    isForkPullRequest,
    isDependabotPullRequest: stringValue(authorNode?.login) === "dependabot[bot]",
  };
}

export function missingTokenSkipReason(context: EventContext, projectOrg = "ChainSafe"): MissingTokenSkipReason | null {
  if (context.repositoryOwner !== null && context.repositoryOwner.toLowerCase() !== projectOrg.toLowerCase()) {
    return "unmanaged_repository";
  }

  if (context.eventName === "pull_request_review" && context.isForkPullRequest) {
    return "fork_pull_request_review";
  }

  if (
    context.actor === "dependabot[bot]" &&
    context.isDependabotPullRequest &&
    (context.eventName === "pull_request_review" || context.eventName === "pull_request_target")
  ) {
    return "dependabot_event";
  }

  return null;
}

export class ProjectBoardConfigurationError extends Error {
  readonly code = MISSING_TOKEN_ERROR_CODE;
  readonly metadata: {eventName: string; repository: string};

  constructor(context: EventContext) {
    const metadata = {eventName: context.eventName || "(unknown)", repository: context.repository};
    super(`${MISSING_TOKEN_ERROR_CODE}: PROJECT_BOARD_TOKEN is required; context=${JSON.stringify(metadata)}`);
    this.name = "ProjectBoardConfigurationError";
    this.metadata = metadata;
  }
}
