import {readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {computeStatus} from "./compute-status.ts";
import {fetchPr, listOpenBoardPrs, resolveProjectConfig, updateItemLane, type ProjectConfig} from "./github.ts";
import {buildSnapshot, pickProjectItem} from "./snapshot.ts";
import {STATUS_TO_LANE} from "./types.ts";

interface Ctx {
  token: string;
  org: string;
  projectNumber: number;
  dryRun: boolean;
  cfg: ProjectConfig;
}

async function reconcilePr(ctx: Ctx, owner: string, repo: string, number: number): Promise<void> {
  const label = `${owner}/${repo}#${number}`;
  const prNode = await fetchPr(ctx.token, owner, repo, number);
  if (!prNode) {
    console.log(`${label}: PR not found; skipping`);
    return;
  }
  const item = pickProjectItem(prNode, ctx.projectNumber);
  if (!item) {
    console.log(`${label}: not on project #${ctx.projectNumber}; skipping`);
    return;
  }
  const status = computeStatus(buildSnapshot(prNode));
  if (status === null) {
    console.log(`${label}: merged/closed; built-in workflow owns Done; skipping`);
    return;
  }
  const lane = STATUS_TO_LANE[status];
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

function prFromEventPayload(): {owner: string; repo: string; number: number} | null {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  const payload = JSON.parse(readFileSync(path, "utf8"));
  const number = payload.pull_request?.number;
  const full = payload.repository?.full_name;
  if (typeof number !== "number" || typeof full !== "string") return null;
  const [owner, repo] = full.split("/");
  return {owner, repo, number};
}

async function main(): Promise<void> {
  const {values} = parseArgs({
    options: {pr: {type: "string"}, sweep: {type: "boolean", default: false}},
  });

  const token = process.env.PROJECT_BOARD_TOKEN ?? "";
  if (!token) {
    // Expected for pull_request_review runs on fork PRs (no secrets); the sweep reconciles those.
    console.warn("PROJECT_BOARD_TOKEN is empty; skipping (fork-PR event or misconfigured secret)");
    return;
  }
  const org = process.env.PROJECT_ORG || "ChainSafe";
  const projectNumber = Number(process.env.PROJECT_NUMBER || "75");
  const dryRun = ["1", "true"].includes((process.env.DRY_RUN ?? "").toLowerCase());
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
    await reconcilePr(ctx, match[1], match[2], Number(match[3]));
    return;
  }

  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  if (values.sweep || eventName === "schedule" || eventName === "workflow_dispatch") {
    const prs = await listOpenBoardPrs(token, org, projectNumber);
    console.log(`sweep: ${prs.length} open PR card(s) on project #${projectNumber}`);
    for (const pr of prs) {
      await reconcilePr(ctx, pr.owner, pr.repo, pr.number);
    }
    return;
  }

  const pr = prFromEventPayload();
  if (!pr) throw new Error(`event ${eventName} has no pull_request payload and no --pr/--sweep flag given`);
  await reconcilePr(ctx, pr.owner, pr.repo, pr.number);
}

await main();
