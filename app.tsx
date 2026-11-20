import { useEffect, useState } from "react";
import { definePluginApp, experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import type { contract } from "./server.js";

import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Checkbox } from "./components/ui/checkbox";

type Scope = { includeNew: boolean; projectIds: string[] };

function ProjectSettings() {
  const rpc = useRpc<typeof contract>();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState<Scope>();
  const [draft, setDraft] = useState<Scope>();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
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
    try { setSaved(await rpc.call("saveScope", { ...value, visibleIds: projects.map(p => p.id) })); }
    catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }
  const selected = projects.filter(project => draft.projectIds.includes(project.id));
  const visible = projects.filter(project => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const all = projects.length > 0 && selected.length === projects.length;
  const summary = all ? "Все проекты" : selected.length ? selected.map(project => project.name).join(", ") : "Выбрать проекты";
  return <section aria-label="Проекты для очистки" className="min-w-0 space-y-3 text-sm text-foreground">
    <h3 className="text-sm font-medium">Проекты для очистки</h3>
      <div className="overflow-hidden rounded-md border border-input">
        <button type="button" aria-expanded={expanded} disabled={busy} onClick={() => setExpanded(!expanded)}
          className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm hover:bg-state-hover focus-visible:outline-ring">
          <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground"/>
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          <Icon name="ChevronDown" className={expanded ? "size-4 rotate-180" : "size-4"}/>
        </button>
        {expanded && <div className="border-t border-border">
          <div className="p-2"><Input aria-label="Поиск проектов" placeholder="Найти проект…" value={query}
            onChange={e => setQuery(e.target.value)} /></div>
          <div className="max-h-52 overflow-y-auto px-1 pb-1">
            <label className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-sm border-b border-border px-2 hover:bg-state-hover">
              <Checkbox aria-label="Все" checked={all ? true : selected.length ? "indeterminate" : false} disabled={busy || !projects.length}
                onCheckedChange={() => setDraft({ ...draft, projectIds: all ? [] : projects.map(p => p.id) })}/>
              Все
            </label>
            {visible.map(project => <label key={project.id} className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2 hover:bg-state-hover">
              <Checkbox checked={draft.projectIds.includes(project.id)} disabled={busy}
                onCheckedChange={checked => setDraft({ ...draft, projectIds: checked === true ?
                  [...draft.projectIds, project.id] : draft.projectIds.filter(id => id !== project.id) })}/>
              <span className="truncate">{project.name}</span>
            </label>)}
            {!visible.length && <p className="p-2 text-xs text-muted-foreground">{query ? "Совпадений нет" : "Проектов пока нет"}</p>}
          </div>
        </div>}
      </div>
    <label className="flex items-center justify-between gap-4 text-sm">
      Применять для новых проектов
      <button type="button" role="switch" aria-label="Применять для новых проектов" aria-checked={draft.includeNew}
        disabled={busy} onClick={() => setDraft({ ...draft, includeNew: !draft.includeNew })}
        className="inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-input bg-muted px-px transition-colors aria-checked:border-foreground aria-checked:bg-foreground focus-visible:ring-1 focus-visible:ring-ring">
        <span className={draft.includeNew ? "size-3 translate-x-3 rounded-full bg-background" : "size-3 rounded-full bg-foreground"}/>
      </button>
    </label>
    {changed && <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(saved); setError(""); }}>Отменить</Button>
      <Button size="sm" disabled={busy} onClick={() => void save(draft)}>{busy ? "Сохранение…" : "Сохранить"}</Button>
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}

export default definePluginApp(app => {
  app.slots.settingsSection({ id: "project-scope", component: ProjectSettings });
});
