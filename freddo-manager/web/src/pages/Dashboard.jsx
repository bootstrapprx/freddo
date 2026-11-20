import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowUpRight, Bell, Boxes, CircleGauge, Cpu, HardDrive, MemoryStick,
  PlayCircle, ShieldAlert, Timer,
} from "lucide-react";
import { Sparkline } from "@/components/Charts";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatCard, StatusBadge, formatTime, prettyValue } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { endpoints } from "@/lib/api";

function useRefreshEvent() {
  const [tick, setTick] = useState(0);
  React.useEffect(() => {
    const handler = () => setTick((value) => value + 1);
    window.addEventListener("freddo:refresh", handler);
    return () => window.removeEventListener("freddo:refresh", handler);
  }, []);
  return tick;
}

export function Dashboard() {
  const navigate = useNavigate();
  const tick = useRefreshEvent();
  const overview = useQuery({ queryKey: ["overview", tick], queryFn: endpoints.overview });
  const benches = useQuery({ queryKey: ["benches", tick], queryFn: endpoints.benches });
  const jobs = useQuery({ queryKey: ["jobs", "dashboard", tick], queryFn: () => endpoints.jobs({ limit: 8 }) });
  const events = useQuery({ queryKey: ["alert-events", tick], queryFn: endpoints.alertEvents });

  if (overview.isLoading) return <LoadingState />;
  if (overview.isError) return <ErrorState error={overview.error} retry={() => overview.refetch()} />;

  const data = overview.data || {};
  const host = data.host || {};
  const benchesInfo = data.benches || {};
  const series = data.series || {};
  const values = (metric) => (series[metric] || []).slice(0, 60).map((point) => Number(point.value));
  const firing = (events.data || []).filter((event) => event.state === "firing").length;

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Estado consolidado do host, dos benches e das operações recentes."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => overview.refetch()}>
              <Activity className="h-4 w-4" /> Atualizar
            </Button>
            <Button size="sm" onClick={() => navigate("/benches")}>
              <PlayCircle className="h-4 w-4" /> Operar benches
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Benches" value={benchesInfo.total} hint={`${benchesInfo.running ?? 0} em execução`} icon={Boxes} tone="mauve" />
        <StatCard label="CPU do host" value={`${prettyValue(host.cpu_percent)}%`} hint="última amostra" icon={Cpu} tone="blue" />
        <StatCard label="Memória" value={`${prettyValue(host.memory_percent)}%`} hint="última amostra" icon={MemoryStick} tone="green" />
        <StatCard label="Alertas ativos" value={firing} hint={`${(events.data || []).length} eventos registrados`} icon={Bell} tone={firing ? "red" : "peach"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Carga do host</CardTitle>
            <CardDescription className="text-xs">Últimos pontos coletados</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-crust/60 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU</span>
                  <span className="font-mono text-foreground">{prettyValue(host.cpu_percent)}%</span>
                </div>
                <Sparkline values={values("host.cpu_percent")} color="#cba6f7" />
              </div>
              <div className="rounded-lg border border-border bg-crust/60 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3" /> Memória</span>
                  <span className="font-mono text-foreground">{prettyValue(host.memory_percent)}%</span>
                </div>
                <Sparkline values={values("host.memory_percent")} color="#89b4fa" />
              </div>
              <div className="rounded-lg border border-border bg-crust/60 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> Disco</span>
                  <span className="font-mono text-foreground">{prettyValue(host.disk_used_percent)}%</span>
                </div>
                <Sparkline values={values("host.disk_used_percent")} color="#a6e3a1" />
              </div>
              <div className="rounded-lg border border-border bg-crust/60 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Timer className="h-3 w-3" /> Load 1m</span>
                  <span className="font-mono text-foreground">{prettyValue(host.load1, 2)}</span>
                </div>
                <Sparkline values={values("host.load1")} color="#f9e2af" />
              </div>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/telemetry">Explorar métricas <ArrowUpRight className="h-3 w-3" /></Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium"><CircleGauge className="h-4 w-4" /> Benches</CardTitle>
            <CardDescription className="text-xs">Leitura direta do estado do fm</CardDescription>
          </CardHeader>
          <CardContent>
            {benches.isLoading ? <LoadingState /> : benches.isError ? (
              <div className="text-xs text-destructive">{benches.error?.message}</div>
            ) : (benches.data || []).length === 0 ? <EmptyState title="Nenhum bench encontrado" /> : (
              <div className="space-y-2">
                {(benches.data || []).slice(0, 6).map((bench) => (
                  <Link
                    key={bench.name}
                    to={`/benches?bench=${encodeURIComponent(bench.name)}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-mauve/50 hover:bg-mauve/5"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{bench.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{bench.domain || bench.path || "—"}</div>
                    </div>
                    <StatusBadge value={bench.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Jobs recentes</CardTitle>
            <CardDescription className="text-xs">Operações assíncronas e seus estados</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.isLoading ? <LoadingState /> : (jobs.data || []).length === 0 ? <EmptyState title="Nenhum job executado" /> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Job</TableHead><TableHead>Bench</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Quando</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.data.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.kind}</TableCell>
                      <TableCell className="text-xs">{job.bench || <span className="text-muted-foreground">global</span>}</TableCell>
                      <TableCell><StatusBadge value={job.state} /></TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{formatTime(job.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Eventos de alerta</CardTitle>
            <CardDescription className="text-xs">Transições firing/resolved</CardDescription>
          </CardHeader>
          <CardContent>
            {events.isLoading ? <LoadingState /> : (events.data || []).length === 0 ? <EmptyState title="Nenhum alerta disparado" /> : (
              <div className="space-y-2">
                {events.data.slice(0, 8).map((event) => (
                  <div key={event.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{event.series}</div>
                      <div className="text-[11px] text-muted-foreground">{formatTime(event.ts)} · valor {prettyValue(event.value, 2)}</div>
                    </div>
                    <Badge variant={event.state === "firing" ? "destructive" : "outline"}>{event.state}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.startup_errors?.length > 0 && (
        <Card className="mt-4 border-destructive/50">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm text-destructive"><ShieldAlert className="h-4 w-4" /> Problemas de inicialização</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {data.startup_errors.map((message) => <div key={message}>• {message}</div>)}
          </CardContent>
        </Card>
      )}
    </>
  );
}
