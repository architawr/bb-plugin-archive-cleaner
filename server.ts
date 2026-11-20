import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";

import { z } from "zod";

type Thread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];
type Policy = { enabled: boolean; projects: string; allProjects: boolean; days: number };
type Entry = { id: string; outcome: string; environmentId: string | null };

function selected(policy: Policy, project: string) {
  return policy.allProjects || policy.projects.split(/[,\s]+/).includes(project);
}

function reason(thread: Thread, policy: Policy, parents: Set<string>, now: number) {
  if (!selected(policy, thread.projectId)) return "project excluded";
  if (thread.archivedAt === null) return "unarchived";
  if (thread.pinnedAt !== null) return "pinned";
  if (!Number.isSafeInteger(policy.days) || policy.days < 1) throw Error("Invalid retention days");
  if (now - thread.archivedAt < policy.days * 86400000) return "within retention";
  if (parents.has(thread.id)) return "has dependents";
  return "eligible";
}

const scopeSchema = z.object({ allProjects: z.boolean(), projectIds: z.array(z.string().min(1)) });
const projectSchema = z.object({ id: z.string(), name: z.string() });
export const contract = defineRpcContract({
  scope: { input: z.null(), output: z.object({ scope: scopeSchema, projects: z.array(projectSchema) }) },
  saveScope: { input: scopeSchema, output: scopeSchema },
});
type Scope = z.infer<typeof scopeSchema>;

export default async function plugin(bb: BbPluginApi) {
  if (await bb.storage.kv.get("projectScope") === undefined) {
    const legacy = await bb.settings.define({
      projects: { type: "string", label: "Previous project selection", default: "" },
    }).get();
    await bb.storage.kv.set("projectScope", { allProjects: false, projectIds: legacy.projects.split(/[,\s]+/).filter(Boolean) });
  }
  const preferences = bb.settings.define({
    enabled: { type: "boolean", label: "Автоматическая очистка", description: "Ежедневно в 03:15 по времени сервера.", default: false },
    days: { type: "number", label: "Хранить после архивации, дней", experimental_schema: z.number().int().min(1), default: 30 },
  });
  async function readScope() {
    return scopeSchema.parse(await bb.storage.kv.get<Scope>("projectScope"));
  }
  async function readPolicy() {
    const scope = await readScope();
    return { ...await preferences.get(), projects: scope.projectIds.join(","), allProjects: scope.allProjects };
  }
  bb.rpc.register(contract, {
    async scope() {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return { scope: await readScope(), projects: projects.map(({ id, name }) => ({ id, name })).sort((a,b) => a.name.localeCompare(b.name)) };
    },
    async saveScope(value) {
      await bb.storage.kv.set("projectScope", value);
      return value;
    },
  });
  const threads = bb.sdk.threads;
  async function inventory() {
    const rows: Thread[] = [];
    const parents = new Set<string>();
    for (const archived of [true, false]) {
      let offset = 0;
      while (true) {
        const page = await threads.list({ archived, includeHidden: true, offset, limit: 100 });
        for (const row of page) {
          if (row.parentThreadId) parents.add(row.parentThreadId);
          if (row.lifecycleOwnerThreadId) parents.add(row.lifecycleOwnerThreadId);
          if (archived) rows.push(row);
        }
        offset += page.length;
        if (page.length < 100) break;
      }
    }
    return { rows, parents };
  }
  let running = false;
  async function scan(apply: boolean) {
    const policy = await readPolicy();
    if (apply && !policy.enabled) return;
    if (running) throw Error("Scan in progress");
    running = true;
    try {
      const { rows, parents } = await inventory();
      const preview = [];
      const entries: Entry[] = [];
      for (const row of rows) {
        if (!selected(policy, row.projectId)) continue;
        const outcome = reason(row, policy, parents, Date.now());
        if (!apply) {
          preview.push({ id: row.id, project: row.projectId, title: row.title, archivedAt: row.archivedAt, outcome });
          continue;
        }
        if (outcome !== "eligible") continue;
        const entry = { id: row.id, environmentId: row.environmentId, outcome: "skipped" };
        try {
          const refreshed = await inventory();
          const current = refreshed.rows.find(t => t.id === row.id);
          const latest = await readPolicy();
          if (!latest.enabled) break;
          if (current && current.archivedAt === row.archivedAt && reason(current, latest, refreshed.parents, Date.now()) === "eligible") {
            await threads.delete({ threadId: row.id, childThreadsConfirmed: false });
            entry.outcome = "deleted";
          }
        } catch (err) {
          entry.outcome = String(err).slice(0, 400);
        }
        bb.log.info(JSON.stringify(entry));
        entries.push(entry);
      }
      if (apply) await bb.storage.kv.set("last", { at: Date.now(), count: entries.length, entries: entries.slice(-100) });
      return preview;
    } finally {
      running = false;
    }
  }
  bb.background.schedule("daily", "15 3 * * *", async () => { await scan(true); });
  async function status() {
    const last = await bb.storage.kv.get<{ at: number; count: number; entries: Entry[] }>("last");
    const environments = new Map<string, string>();
    for (const entry of last?.entries ?? []) {
      const id = entry.environmentId;
      if (!id || environments.has(id)) continue;
      try {
        const env = await bb.sdk.environments.get({ environmentId: id });
        environments.set(id, env.lifecycle.phase);
      } catch {
        environments.set(id, "unavailable");
      }
    }
    return { policy: await readPolicy(), last: last ?? null, environments: Object.fromEntries(environments),
      storage: "Physical removal is not verified by the plugin" };
  }
  bb.cli.register({
    name: "archive-cleaner", summary: "Inspect daily archived thread cleanup",
    commands: ["preview", "status"].map(name => ({ name, summary: name, usage: "bb archive-cleaner " + name })),
    async run(argv) {
      const args = argv.filter(a => a !== "--json");
      if (args.length !== 1 || !["preview", "status"].includes(args[0])) return { exitCode: 1, stderr: "Use preview or status" };
      const result = args[0] === "preview" ? await scan(false) : await status();
      return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
    },
  });
}
