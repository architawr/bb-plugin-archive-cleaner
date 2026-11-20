import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { contract } from "./server.js";

type Scope = { allProjects: boolean; projectIds: string[] };

function ProjectSettings() {
  const rpc = useRpc<typeof contract>();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState<Scope>();
  const [draft, setDraft] = useState<Scope>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    rpc.call("scope").then(view => {
      if (!active) return;
      setProjects(view.projects);
      setSaved(view.scope);
      setDraft(view.scope);
    }).catch(err => { if (active) setError(String(err)); });
    return () => { active = false; };
  }, [rpc]);
  if (!draft) return <p role="status">{error || "Загрузка проектов…"}</p>;
  const changed = JSON.stringify(saved) !== JSON.stringify(draft);
  async function save(value: Scope) {
    setBusy(true);
    setError("");
    try { setSaved(await rpc.call("saveScope", value)); }
    catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={busy} className="space-y-3">
    <legend className="font-medium">Проекты для очистки</legend>
    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.allProjects}
      onChange={e => setDraft({ ...draft, allProjects: e.target.checked })}/>Все проекты, включая будущие</label>
    {!draft.allProjects && <div className="max-h-64 overflow-auto rounded-md border p-3 space-y-2">
      {projects.map(p => <label className="flex items-center gap-2" key={p.id}>
        <input type="checkbox" checked={draft.projectIds.includes(p.id)} onChange={e => setDraft({ ...draft,
          projectIds: e.target.checked ? [...draft.projectIds, p.id] : draft.projectIds.filter(id => id !== p.id) })}/>{p.name}
      </label>)}
      {!projects.length && <p>Проектов пока нет.</p>}
    </div>}
    {!draft.allProjects && !draft.projectIds.length && <p className="text-sm text-muted-foreground">Выберите проекты, чтобы включить их в очистку.</p>}
    <button type="button" className="rounded-md border px-3 py-1 disabled:opacity-50" disabled={!changed || busy}
      onClick={() => void save(draft)}>{busy ? "Сохранение…" : "Сохранить выбор"}</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}

export default definePluginApp(app => {
  app.slots.settingsSection({ id: "project-scope", component: ProjectSettings });
});
