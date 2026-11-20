import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Ban, ExternalLink, FileBadge, Loader2, Play, Plus, RotateCcw,
  Search, Settings2, Square, Trash2, Wifi,
} from "lucide-react";
import { LogViewer } from "@/components/LogViewer";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, SectionCard, StatusBadge, formatTime } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { endpoints } from "@/lib/api";
import { errorMessage, runAction } from "@/lib/actions";

function CreateBenchDialog({ open, onOpenChange, templates }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", version: "v15", apps: "frappe,erpnext", environment: "development", template: "" });
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const result = await runAction("Criação de bench", async () => endpoints.createBench({
      name: form.name.trim(),
      version: form.version,
      apps: form.apps.split(",").map((item) => item.trim()).filter(Boolean),
      environment: form.environment,
      template: form.template || undefined,
    }), { onSuccess: () => { onOpenChange(false); queryClient.invalidateQueries({ queryKey: ["benches"] }); } });
    setBusy(false);
    return result;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo bench</DialogTitle>
          <DialogDescription>A criação é assíncrona; acompanhe o job na aba Jobs.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Field label="Nome" hint="Use letras, números, - e _."><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="producao" required /></Field>
          <Field label="Versão"><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="v15" required /></Field>
          <Field label="Apps (separados por vírgula)"><Input value={form.apps} onChange={(e) => setForm({ ...form, apps: e.target.value })} /></Field>
          <Field label="Ambiente">
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
              <option value="development">development</option>
              <option value="staging">staging</option>
              <option value="production">production</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Template (opcional)">
              <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
                <option value="">Nenhum</option>
                {(templates || []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </Field>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Criar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ open, onOpenChange, title, description, label, confirmText, onConfirm, busy }) {
  const [value, setValue] = useState("");
  useEffect(() => { if (open) setValue(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Field label={`Digite "${confirmText}" para confirmar`}><Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" disabled={value !== confirmText || busy} onClick={onConfirm}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {label}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BenchDetail({ bench, onClose }) {
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ["bench", bench], queryFn: () => endpoints.bench(bench), enabled: Boolean(bench) });
  const ssl = useQuery({ queryKey: ["ssl", bench], queryFn: () => endpoints.sslStatus(bench), enabled: Boolean(bench) });
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ngrokTtl, setNgrokTtl] = useState("3600");

  if (!bench) return null;

  async function action(name) {
    setBusy(true);
    await runAction(`Ação ${name}`, () => endpoints.benchAction(bench, name, name === "reset" ? { confirm: bench } : {}), {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    });
    setBusy(false);
  }

  async function confirmed() {
    setBusy(true);
    const operation = confirm === "delete"
      ? () => endpoints.deleteBench(bench)
      : confirm === "reset"
        ? () => endpoints.benchAction(bench, "reset", { confirm: bench })
        : () => endpoints.ngrok(bench, { action: "start", ttl: Number(ngrokTtl), confirm: bench });
    await runAction(confirm, operation, { onSuccess: () => { setConfirm(null); queryClient.invalidateQueries({ queryKey: ["benches"] }); } });
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{bench} <StatusBadge value={info.data?.status} /></DialogTitle>
          <DialogDescription>{info.data?.domain || "Sem domínio configurado"} · {info.data?.version || "versão desconhecida"}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => action("start")} disabled={busy}><Play className="h-3 w-3" /> Start</Button>
          <Button size="sm" variant="outline" onClick={() => action("stop")} disabled={busy}><Square className="h-3 w-3" /> Stop</Button>
          <Button size="sm" variant="outline" onClick={() => action("restart")} disabled={busy}><RotateCcw className="h-3 w-3" /> Restart</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("reset")} disabled={busy}><Ban className="h-3 w-3" /> Reset</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("ngrok")} disabled={busy}><Wifi className="h-3 w-3" /> ngrok</Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirm("delete")} disabled={busy}><Trash2 className="h-3 w-3" /> Delete</Button>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="ssl">SSL</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            {info.isLoading ? <LoadingState /> : info.isError ? <ErrorState error={info.error} retry={() => info.refetch()} /> : (
              <div className="grid gap-4 sm:grid-cols-2">
                <SectionCard title="Apps">
                  <div className="flex flex-wrap gap-2">{(info.data?.apps || []).map((app) => <Badge key={app} variant="secondary">{app}</Badge>)}</div>
                </SectionCard>
                <SectionCard title="Serviços">
                  <div className="flex flex-wrap gap-2">{(info.data?.services || []).map((service) => <Badge key={String(service)} variant="outline">{typeof service === "string" ? service : service.name}</Badge>)}</div>
                </SectionCard>
                <SectionCard title="Sites">
                  {(info.data?.sites || []).length ? <ul className="space-y-1 text-xs">{(info.data?.sites || []).map((site) => <li key={site}>{site}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nenhum site listado.</p>}
                </SectionCard>
                <SectionCard title="Metadados">
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <dt className="text-muted-foreground">Ambiente</dt><dd>{info.data?.environment || "—"}</dd>
                    <dt className="text-muted-foreground">Criado em</dt><dd>{formatTime(info.data?.created_at)}</dd>
                    <dt className="text-muted-foreground">Caminho</dt><dd className="truncate font-mono">{info.data?.path || "—"}</dd>
                  </dl>
                </SectionCard>
              </div>
            )}
          </TabsContent>
          <TabsContent value="logs"><LogViewer path={`/benches/${encodeURIComponent(bench)}/logs?service=all`} /></TabsContent>
          <TabsContent value="ssl" className="space-y-3">
            {ssl.isLoading ? <LoadingState /> : (
              <>
                {(ssl.data?.certificates || []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum certificado encontrado.</p> : (
                  <div className="space-y-2">{(ssl.data?.certificates || []).map((cert) => (
                    <div key={cert.domain} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs">
                      <span>{cert.domain}</span>
                      <span className="text-muted-foreground">{cert.expires_in_days ?? "?"} dias · {cert.issuer || "—"}</span>
                    </div>
                  ))}</div>
                )}
                <Button size="sm" variant="outline" onClick={async () => {
                  await runAction("Renovação SSL", () => endpoints.sslAction(bench, "renew"));
                }}><FileBadge className="h-3 w-3" /> Renovar certificados</Button>
              </>
            )}
          </TabsContent>
          <TabsContent value="config">
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-crust p-3 text-[11px] text-sub1">
              {JSON.stringify(info.data?.config || {}, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>

        <ConfirmDialog
          open={Boolean(confirm)}
          onOpenChange={(value) => !value && setConfirm(null)}
          title={confirm === "delete" ? `Excluir ${bench}` : confirm === "reset" ? `Resetar ${bench}` : "Expor via ngrok"}
          description="Operação sensível: exige step-up válido. O nome do bench confirma a ação."
          confirmText={bench}
          label={confirm === "delete" ? "Excluir" : confirm === "reset" ? "Resetar" : "Iniciar"}
          onConfirm={confirmed}
          busy={busy}
        />
      </DialogContent>
    </Dialog>
  );
}

export function Benches() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const selected = searchParams.get("bench");
  const benches = useQuery({ queryKey: ["benches"], queryFn: endpoints.benches, refetchInterval: 30_000 });
  const templates = useQuery({ queryKey: ["templates"], queryFn: endpoints.templates });

  const filtered = useMemo(() => (benches.data || []).filter((bench) =>
    `${bench.name} ${bench.domain || ""} ${bench.version || ""}`.toLowerCase().includes(query.toLowerCase())
  ), [benches.data, query]);

  return (
    <>
      <PageHeader
        title="Benches"
        description="Estado lido diretamente do fm e dos labels Docker; escrita sempre via jobs."
        actions={<>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="w-56 pl-8" placeholder="Filtrar…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo bench</Button>
        </>}
      />

      {benches.isLoading ? <LoadingState /> : benches.isError ? <ErrorState error={benches.error} retry={() => benches.refetch()} /> : filtered.length === 0 ? (
        <Card><CardContent><EmptyState title="Nenhum bench encontrado" description="Crie um bench ou remova o filtro." /></CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">{filtered.length} bench(es)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead><TableHead>Estado</TableHead><TableHead>Versão</TableHead>
                  <TableHead>Domínio</TableHead><TableHead>Apps</TableHead><TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((bench) => (
                  <TableRow key={bench.name}>
                    <TableCell className="font-medium">{bench.name}</TableCell>
                    <TableCell><StatusBadge value={bench.status} /></TableCell>
                    <TableCell className="text-xs">{bench.version || "—"}</TableCell>
                    <TableCell className="text-xs">{bench.domain ? <a className="inline-flex items-center gap-1 text-blue hover:underline" href={`https://${bench.domain}`} target="_blank" rel="noreferrer">{bench.domain}<ExternalLink className="h-3 w-3" /></a> : "—"}</TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{(bench.apps || []).slice(0, 4).map((app) => <Badge key={app} variant="secondary" className="text-[10px]">{app}</Badge>)}</div></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSearchParams({ bench: bench.name })}><Settings2 className="h-3 w-3" /> Gerenciar</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateBenchDialog open={creating} onOpenChange={setCreating} templates={templates.data} />
      <BenchDetail bench={selected} onClose={() => setSearchParams({})} />
    </>
  );
}
