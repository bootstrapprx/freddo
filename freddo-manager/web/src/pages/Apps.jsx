import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Plus, Rocket, ShieldCheck, TestTube2 } from "lucide-react";
import { ErrorState, Field, LoadingState, PageHeader } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { endpoints } from "@/lib/api";
import { errorMessage } from "@/lib/actions";

const versions = ["v14", "v15", "v16", "develop"];

export function Apps() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["apps"], queryFn: () => endpoints.apps(), refetchInterval: 5000 });
  const benches = useQuery({ queryKey: ["benches"], queryFn: endpoints.benches });
  const [preview, setPreview] = useState(null);
  const [reviewedPreview, setReviewedPreview] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const previewJob = useQuery({
    queryKey: ["job", preview?.id], queryFn: () => endpoints.job(preview.id),
    enabled: Boolean(preview?.id), refetchInterval: (query) => ["queued", "running"].includes(query.state.data?.state) ? 2000 : false,
  });
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [edits, setEdits] = useState({});
  const [refs, setRefs] = useState({});
  const [target, setTarget] = useState({ bench: "", site: "", version: "v15" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["apps"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); };
  const mutation = useMutation({
    mutationFn: ({ kind, app, version, ref, operation, data }) => {
      if (kind === "create") return endpoints.createApp({ name, title, repository_url: url });
      if (kind === "update") return endpoints.updateApp(app, data);
      if (kind === "release") return endpoints.saveAppRelease(app, version, ref);
      if (kind === "archive") return endpoints.archiveApp(app);
      if (kind === "validate") return endpoints.validateApp(app, version);
      if (kind === "test") return endpoints.testApp(app, version);
      return endpoints.appLifecycle(app, operation, data);
    },
    onSuccess: (result, variables) => {
      refresh();
      if (result?.id) {
        toast.success(`Job ${result.id} enviado`);
        if (variables.operation === "uninstall-preview") {
          setPreview({ app: variables.app, ...variables.data, id: result.id });
          setReviewedPreview(false);
          setConfirmText("");
        }
        if (variables.operation === "uninstall") {
          setPreview(null);
          setReviewedPreview(false);
          setConfirmText("");
        }
      } else toast.success("Catálogo atualizado");
    },
    onError: (error) => {
      if (error?.code === "stepup_required") window.dispatchEvent(new CustomEvent("freddo:stepup"));
      toast.error(errorMessage(error));
    },
  });
  if (catalog.isLoading) return <LoadingState />;
  if (catalog.isError) return <ErrorState error={catalog.error} retry={() => catalog.refetch()} />;

  const data = catalog.data || [];
  return <>
    <PageHeader title="Apps" description="Repositórios, releases compatíveis, validação, testes isolados e ciclo de vida nos benches." />
    <Card className="mb-4">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="h-4 w-4 text-mauve" /> Registrar app</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ kind: "create" }); }}>
          <Field label="Nome Python"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_app" pattern="[a-z][a-z0-9_]{0,63}" required /></Field>
          <Field label="Nome de exibição"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
          <Field label="URL Git HTTPS ou SSH"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/my_app.git" required /></Field>
          <Button className="sm:col-span-3 sm:w-fit" disabled={mutation.isPending}>Registrar app</Button>
        </form>
      </CardContent>
    </Card>
    <div className="space-y-4">
      {data.map((app) => <Card key={app.name}>
        <CardHeader className="pb-3"><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><Package className="h-4 w-4 text-mauve" />{app.title}<code className="text-xs text-muted-foreground">{app.name}</code></span>
          <Badge variant={app.enabled && !app.archived ? "default" : "secondary"}>{app.archived ? "arquivado" : app.enabled ? "ativo" : "desativado"}</Badge>
        </CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="break-all font-mono text-xs text-muted-foreground">{app.repository_url}</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end">
            <Field label="Título"><Input value={edits[app.name]?.title ?? app.title} onChange={(e) => setEdits({ ...edits, [app.name]: { ...edits[app.name], title: e.target.value } })} /></Field>
            <Field label="Repositório"><Input value={edits[app.name]?.url ?? app.repository_url} onChange={(e) => setEdits({ ...edits, [app.name]: { ...edits[app.name], url: e.target.value } })} /></Field>
            <label className="flex h-9 items-center gap-2 text-xs"><input type="checkbox" checked={edits[app.name]?.enabled ?? app.enabled} onChange={(e) => setEdits({ ...edits, [app.name]: { ...edits[app.name], enabled: e.target.checked } })} disabled={app.name === "frappe"} /> Ativo</label>
            <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: "update", app: app.name, data: { title: edits[app.name]?.title ?? app.title, repository_url: edits[app.name]?.url ?? app.repository_url, enabled: edits[app.name]?.enabled ?? app.enabled } })}>Salvar</Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {versions.map((version) => {
              const release = app.releases.find((item) => item.framework_version === version);
              const key = `${app.name}:${version}`;
              return <div key={key} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between"><strong className="text-xs">Frappe {version}</strong>{release && <Badge variant="outline">{release.test_state === "running" ? "testando" : release.test_state === "failed" ? "teste falhou" : release.test_state === "passed" && release.tested_commit === release.validated_commit ? "testado" : release.validation_state === "failed" ? "validação falhou" : release.validation_state}</Badge>}</div>
                <div className="flex gap-2">
                  <Input aria-label={`Ref ${app.name} ${version}`} value={refs[key] ?? release?.ref ?? ""} onChange={(e) => setRefs({ ...refs, [key]: e.target.value })} placeholder="version-15" />
                  <Button size="sm" variant="outline" disabled={!refs[key] || mutation.isPending} onClick={() => mutation.mutate({ kind: "release", app: app.name, version, ref: refs[key] })}>Salvar</Button>
                </div>
                {release && <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: "validate", app: app.name, version })}><ShieldCheck className="h-3.5 w-3.5" /> Validar repo</Button>
                  <Button size="sm" variant="outline" disabled={mutation.isPending || release.validation_state !== "passed"} onClick={() => mutation.mutate({ kind: "test", app: app.name, version })}><TestTube2 className="h-3.5 w-3.5" /> Testar app</Button>
                  {release.validation_error && <span className="self-center text-[10px] text-destructive">{release.validation_error}</span>}
                  {release.validation_job_id && <a className="self-center text-[10px] text-blue underline" href="/jobs">validação · job {release.validation_job_id}</a>}
                  {release.tested_commit && <a className="self-center font-mono text-[10px] text-muted-foreground underline" href="/jobs">{release.tested_commit.slice(0, 12)} · teste job {release.test_job_id}</a>}
                  {release.test_summary && <span className="self-center text-[10px] text-muted-foreground">{release.test_summary}</span>}
                </div>}
              </div>;
            })}
          </div>
          {app.name !== "frappe" && !app.archived && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => mutation.mutate({ kind: "archive", app: app.name })}>Arquivar app</Button>}
          <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-4">
            <Field label="Bench"><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={target.bench} onChange={(e) => setTarget({ ...target, bench: e.target.value })}><option value="">Selecione</option>{(benches.data || []).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</select></Field>
            <Field label="Site"><Input value={target.site} onChange={(e) => setTarget({ ...target, site: e.target.value })} placeholder="site.example.com" /></Field>
            <Field label="Compatibilidade"><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={target.version} onChange={(e) => setTarget({ ...target, version: e.target.value })}>{versions.map((v) => <option key={v}>{v}</option>)}</select></Field>
            <div className="flex flex-wrap items-end gap-2">
              {[["install", "Instalar"], ["update", "Atualizar"], ["uninstall-preview", "Prévia remoção"]].map(([operation, text]) => <Button key={operation} size="sm" variant="outline" disabled={!target.bench || !target.site || mutation.isPending} onClick={() => mutation.mutate({ app: app.name, operation, data: { bench: target.bench, site: target.site, framework_version: target.version } })}><Rocket className="h-3.5 w-3.5" />{text}</Button>)}
            </div>
          </div>
          {preview?.app === app.name && preview.bench === target.bench && preview.site === target.site && preview.framework_version === target.version && <div className="space-y-2 rounded-md border border-peach/40 p-3 text-xs">
            <p>Prévia de remoção: job <a className="text-blue underline" href="/jobs">{preview.id}</a> · estado {previewJob.data?.state || "carregando"}.</p>
            {previewJob.data?.state === "succeeded" && <>
              <label className="flex items-center gap-2"><input type="checkbox" checked={reviewedPreview} onChange={(e) => setReviewedPreview(e.target.checked)} /> Revisei o impacto do dry-run no job.</label>
              <div className="flex flex-wrap gap-2"><Input aria-label="Confirmação app@bench" placeholder={`${app.name}@${target.bench}`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
                <Button size="sm" variant="destructive" disabled={!reviewedPreview || confirmText !== `${app.name}@${target.bench}` || mutation.isPending} onClick={() => mutation.mutate({ app: app.name, operation: "uninstall", data: { bench: target.bench, site: target.site, framework_version: target.version, confirm: confirmText } })}>Confirmar remoção</Button>
                <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setReviewedPreview(false); setConfirmText(""); }}>Cancelar</Button></div>
            </>}
          </div>}
        </CardContent>
      </Card>)}
      {!data.length && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nenhum app registrado</CardContent></Card>}
    </div>
  </>;
}
