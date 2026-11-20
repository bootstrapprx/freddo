import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Activity, Ban, CheckCircle2, Circle, Clock, Loader2, XCircle } from "lucide-react";
import { LogViewer } from "@/components/LogViewer";
import { EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, StatusBadge, formatTime } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { endpoints } from "@/lib/api";
import { runAction } from "@/lib/actions";

function JobIcon({ state }) {
  if (state === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue" />;
  if (state === "succeeded") return <CheckCircle2 className="h-3.5 w-3.5 text-green" />;
  if (state === "failed" || state === "timed_out") return <XCircle className="h-3.5 w-3.5 text-red" />;
  if (state === "cancelled") return <Ban className="h-3.5 w-3.5 text-peach" />;
  if (state === "queued") return <Clock className="h-3.5 w-3.5 text-overlay1" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function Jobs() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState("");
  const [state, setState] = useState("");
  const selected = searchParams.get("job");
  const jobs = useQuery({
    queryKey: ["jobs", state],
    queryFn: () => endpoints.jobs({ limit: 100, ...(state ? { state } : {}) }),
    refetchInterval: 5000,
  });
  const detail = useQuery({ queryKey: ["job", selected], queryFn: () => endpoints.job(selected), enabled: Boolean(selected), refetchInterval: selected ? 5000 : false });

  const visible = useMemo(() => (jobs.data || []).filter((job) =>
    `${job.id} ${job.kind} ${job.bench || ""}`.toLowerCase().includes(filter.toLowerCase())
  ), [jobs.data, filter]);

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Operações assíncronas com logs em SSE e reexecução controlada por idempotência."
        actions={<>
          <Input className="w-52" placeholder="Buscar job…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => jobs.refetch()}><Activity className="h-4 w-4" /> Atualizar</Button>
        </>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {["", "queued", "running", "succeeded", "failed", "cancelled"].map((value) => (
          <Button key={value} size="sm" variant={state === value ? "secondary" : "ghost"} onClick={() => setState(value)}>
            {value || "todos"}
          </Button>
        ))}
      </div>

      {jobs.isLoading ? <LoadingState /> : jobs.isError ? <ErrorState error={jobs.error} retry={() => jobs.refetch()} /> : visible.length === 0 ? (
        <Card><CardContent><EmptyState title="Nenhum job encontrado" description="Ações em benches e serviços criam jobs automaticamente." /></CardContent></Card>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Job</TableHead><TableHead>Tipo</TableHead><TableHead>Bench</TableHead><TableHead>Estado</TableHead><TableHead>Criado</TableHead><TableHead>Fim</TableHead><TableHead className="text-right">Ações</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((job) => (
                  <TableRow key={job.id} className={selected === job.id ? "bg-mauve/5" : ""}>
                    <TableCell className="font-mono text-[11px]">{job.id.slice(-12)}</TableCell>
                    <TableCell className="text-xs">{job.kind}</TableCell>
                    <TableCell className="text-xs">{job.bench || "global"}</TableCell>
                    <TableCell><span className="inline-flex items-center gap-1.5 text-xs"><JobIcon state={job.state} /><StatusBadge value={job.state} /></span></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatTime(job.created_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatTime(job.finished_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setSearchParams({ job: job.id })}>Logs</Button>
                        {["queued", "running"].includes(job.state) && (
                          <Button variant="ghost" size="sm" onClick={async () => {
                            await runAction("Cancelamento", () => endpoints.cancelJob(job.id), {
                              onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["jobs"] }); detail.refetch(); },
                            });
                          }}>Cancelar</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selected && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LogViewer path={`/jobs/${selected}/events`} />
          </div>
          <SectionCard title="Detalhes do job">
            {detail.isLoading ? <LoadingState /> : detail.isError ? <ErrorState error={detail.error} /> : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <dt className="text-muted-foreground">ID</dt><dd className="break-all font-mono">{detail.data?.id}</dd>
                <dt className="text-muted-foreground">Tipo</dt><dd>{detail.data?.kind}</dd>
                <dt className="text-muted-foreground">Estado</dt><dd><StatusBadge value={detail.data?.state} /></dd>
                <dt className="text-muted-foreground">Exit code</dt><dd>{detail.data?.exit_code ?? "—"}</dd>
                <dt className="text-muted-foreground">Eventos</dt><dd>{detail.data?.events?.length ?? 0}</dd>
                <dt className="text-muted-foreground">Erro</dt><dd className="text-destructive">{detail.data?.error || "—"}</dd>
                <dt className="text-muted-foreground">Criado</dt><dd>{formatTime(detail.data?.created_at)}</dd>
                <dt className="text-muted-foreground">Finalizado</dt><dd>{formatTime(detail.data?.finished_at)}</dd>
              </dl>
            )}
          </SectionCard>
        </div>
      )}
    </>
  );
}
