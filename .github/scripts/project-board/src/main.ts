import {readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {computeStatus} from "./compute-status.ts";
import {
  buildEventContext,
  type EventContext,
  missingTokenSkipReason,
  ProjectBoardConfigurationError,
} from "./event-context.ts";
import {fetchPr, listOpenManagedBoardPrs, type ProjectConfig, resolveProjectConfig, updateItemLane} from "./github.ts";
import {buildSnapshot, pickProjectItem} from "./snapshot.ts";
import {reconcileSweep} from "./sweep.ts";
import {isSweepLane, STATUS_TO_LANE} from "./types.ts";

interface Ctx {
  token: string;
  org: string;
  projectNumber: number;
  dryRun: boolean;
  cfg: ProjectConfig;
}

async function reconcilePr(
  ctx: Ctx,
  owner: string,
  repo: string,
  number: number,
  source: "event" | "sweep",
): Promise<void> {
  const label = `${owner}/${repo}#${number}`;
  const prNode = await fetchPr(ctx.token, owner, repo, number);
  if (!prNode) {
    console.log(`${label}: PR not found; skipping`);
    return;
  }
  const status = computeStatus(buildSnapshot(prNode));
  if (status === null) {
    console.log(`${label}: merged/closed; built-in workflow owns Done; skipping`);
    return;
  }
  const lane = STATUS_TO_LANE[status];
  const item = pickProjectItem(prNode, ctx.cfg.projectId);
  if (!item) {
    console.log(`${label}: not on project #${ctx.projectNumber}; waiting for project auto-add`);
    return;
  }
  if (source === "sweep" && !isSweepLane(item.currentLane)) {
    console.log(`${label}: status "${item.currentLane ?? "(none)"}" is outside sweep scope; skipping`);
    return;
  }
  if (item.currentLane === lane) {
    console.log(`${label}: already "${lane}"; no-op`);
    return;
  }
  if (ctx.dryRun) {
    console.log(`${label}: DRY RUN — would move "${item.currentLane ?? "(none)"}" -> "${lane}"`);
    return;
  }
  await updateItemLane(ctx.token, ctx.cfg, item.itemId, lane);
  console.log(`${label}: moved "${item.currentLane ?? "(none)"}" -> "${lane}"`);
}

function eventContext(): EventContext {
  const path = process.env.GITHUB_EVENT_PATH;
  const payload: unknown = path ? JSON.parse(readFileSync(path, "utf8")) : null;
  return buildEventContext(
    process.env.GITHUB_EVENT_NAME ?? "",
    process.env.GITHUB_ACTOR ?? "",
    process.env.GITHUB_REPOSITORY ?? "",
    payload,
  );
}

async function main(): Promise<void> {
  const {values} = parseArgs({
    options: {pr: {type: "string"}, sweep: {type: "boolean", default: false}},
  });

  const event = eventContext();
  const org = process.env.PROJECT_ORG || "ChainSafe";
  const token = process.env.PROJECT_BOARD_TOKEN?.trim() ?? "";
  if (!token) {
    const skipReason = missingTokenSkipReason(event, org);
    if (skipReason) {
      if (skipReason === "unmanaged_repository") {
        console.log("Project board automation is not configured for this repository; skipping", {
          eventName: event.eventName,
          repository: event.repository,
          reason: skipReason,
        });
      } else {
        console.warn("PROJECT_BOARD_TOKEN is unavailable for this untrusted PR event; the sweep will reconcile it", {
          eventName: event.eventName,
          repository: event.repository,
          reason: skipReason,
        });
      }
      return;
    }
    throw new ProjectBoardConfigurationError(event);
  }
  const projectNumber = Number(process.env.PROJECT_NUMBER || "75");
  const dryRun = !["0", "false"].includes((process.env.DRY_RUN ?? "").trim().toLowerCase());
  console.log(`mode: ${dryRun ? "DRY RUN" : "LIVE"} — org=${org} project=#${projectNumber}`);
  const cfg = await resolveProjectConfig(token, org, projectNumber);
  for (const lane of Object.values(STATUS_TO_LANE)) {
    if (!cfg.optionIds.has(lane)) {
      throw new Error(`board is missing the "${lane}" status option; found: ${[...cfg.optionIds.keys()].join(", ")}`);
    }
  }
  const ctx: Ctx = {token, org, projectNumber, dryRun, cfg};

  if (values.pr) {
    const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(values.pr);
    if (!match) throw new Error(`--pr expects owner/repo#number, got: ${values.pr}`);
    await reconcilePr(ctx, match[1], match[2], Number(match[3]), "event");
    return;
  }

  if (values.sweep || event.eventName === "schedule" || event.eventName === "workflow_dispatch") {
    const prs = await listOpenManagedBoardPrs(token, org, projectNumber);
    console.log(`sweep: ${prs.length} managed open PR card(s) on project #${projectNumber}`);
    await reconcileSweep(prs, (pr) => reconcilePr(ctx, pr.owner, pr.repo, pr.number, "sweep"));
    return;
  }

  if (!event.pullRequest) {
    throw new Error(`event ${event.eventName} has no pull_request payload and no --pr/--sweep flag given`);
  }
  await reconcilePr(ctx, event.pullRequest.owner, event.pullRequest.repo, event.pullRequest.number, "event");
}

await main();
