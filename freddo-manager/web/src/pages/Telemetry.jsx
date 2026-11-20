import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, Gauge } from "lucide-react";
import { LineChart } from "@/components/Charts";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, SectionCard, prettyValue } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { endpoints } from "@/lib/api";

const RANGES = [
  { label: "1 h", seconds: 3600 },
  { label: "6 h", seconds: 21600 },
  { label: "24 h", seconds: 86400 },
  { label: "7 d", seconds: 604800 },
];

const COLORS = ["#cba6f7", "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8", "#94e2d5", "#b4befe", "#fab387"];

function groupSeries(points = []) {
  const groups = new Map();
  for (const point of points) {
    const key = JSON.stringify(point.labels || {});
    if (!groups.has(key)) groups.set(key, { labels: point.labels || {}, points: [] });
    groups.get(key).points.push({ ts: point.ts, value: Number(point.value) });
  }
  return [...groups.values()];
}

function MetricChart({ metric, range, labelFilter }) {
  const to = Math.floor(Date.now() / 1000);
  const query = useQuery({
    queryKey: ["telemetry", metric, range],
    queryFn: () => endpoints.telemetry({ metric, from: to - range, to }),
    refetchInterval: 30_000,
    enabled: Boolean(metric),
  });

  if (!metric) return <EmptyState title="Selecione uma métrica" />;
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => query.refetch()} />;

  let groups = groupSeries(query.data?.points || []);
  if (labelFilter.trim()) {
    groups = groups.filter((group) => JSON.stringify(group.labels).toLowerCase().includes(labelFilter.toLowerCase()));
  }
  if (groups.length === 0) return <EmptyState title="Sem amostras no período" description="O coletor ainda não gravou pontos para esta métrica." />;

  const series = groups.map((group, index) => ({
    name: Object.keys(group.labels).length ? JSON.stringify(group.labels) : metric,
    color: COLORS[index % COLORS.length],
    points: group.points,
  }));

  const allValues = series.flatMap((item) => item.points.map((point) => point.value));
  const last = allValues.at(-1);
  const min = allValues.length ? Math.min(...allValues) : null;
  const max = allValues.length ? Math.max(...allValues) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SectionCard title="Último valor"><div className="text-xl font-semibold tabular-nums">{prettyValue(last, 2)}</div></SectionCard>
        <SectionCard title="Mínimo"><div className="text-xl font-semibold tabular-nums">{prettyValue(min, 2)}</div></SectionCard>
        <SectionCard title="Máximo"><div className="text-xl font-semibold tabular-nums">{prettyValue(max, 2)}</div></SectionCard>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between font-mono text-sm">
            <span>{metric}</span>
            <Badge variant="outline">{series.length} série(s)</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent><LineChart series={series} height={320} /></CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        {groups.map((group, index) => (
          <Badge key={JSON.stringify(group.labels)} variant="outline" style={{ borderColor: COLORS[index % COLORS.length] }}>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
            {JSON.stringify(group.labels)}
          </Badge>
        ))}
      </div>
    </div>
  );
}

const PRESETS = [
  { metric: "host.cpu_percent", label: "CPU do host", unit: "%" },
  { metric: "host.memory_percent", label: "Memória do host", unit: "%" },
  { metric: "host.disk_used_percent", label: "Disco do host", unit: "%" },
  { metric: "host.load1", label: "Load average (1m)", unit: "" },
  { metric: "container.cpu_percent", label: "CPU por container", unit: "%" },
  { metric: "container.memory_percent", label: "Memória por container", unit: "%" },
  { metric: "site.available", label: "Disponibilidade do site", unit: "" },
  { metric: "site.latency_ms", label: "Latência do site", unit: "ms" },
  { metric: "tls.days_until_expiry", label: "Validade do TLS", unit: "d" },
];

export function Telemetry() {
  const [metric, setMetric] = useState(PRESETS[0].metric);
  const [range, setRange] = useState(RANGES[1].seconds);
  const [labelFilter, setLabelFilter] = useState("");
  const catalog = useQuery({ queryKey: ["metrics"], queryFn: endpoints.metrics });

  const available = useMemo(() => {
    const values = new Set([...PRESETS.map((item) => item.metric), ...(catalog.data || [])]);
    return [...values].sort();
  }, [catalog.data]);

  return (
    <>
      <PageHeader
        title="Telemetria"
        description="Séries do coletor com rollups automáticos (5 min e 1 h)."
        actions={<>
          {RANGES.map((item) => (
            <Button key={item.seconds} size="sm" variant={range === item.seconds ? "secondary" : "ghost"} onClick={() => setRange(item.seconds)}>
              <Clock className="h-3 w-3" /> {item.label}
            </Button>
          ))}
        </>}
      />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Field label="Métrica">
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {available.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Filtrar labels (substring do JSON)"><Input value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} placeholder='{"bench":"producao"}' /></Field>
        </div>
      </div>

      <Tabs defaultValue="chart">
        <TabsList>
          <TabsTrigger value="chart"><Activity className="h-3.5 w-3.5" /> Gráfico</TabsTrigger>
          <TabsTrigger value="catalog"><Gauge className="h-3.5 w-3.5" /> Catálogo</TabsTrigger>
        </TabsList>
        <TabsContent value="chart"><MetricChart metric={metric} range={range} labelFilter={labelFilter} /></TabsContent>
        <TabsContent value="catalog">
          <Card><CardContent className="pt-6">
            {catalog.isLoading ? <LoadingState /> : (catalog.data || []).length === 0 ? <EmptyState title="Nenhuma métrica coletada" /> : (
              <div className="flex flex-wrap gap-2">{catalog.data.map((item) => (
                <Button key={item} size="sm" variant="outline" onClick={() => setMetric(item)}>{item}</Button>
              ))}</div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
