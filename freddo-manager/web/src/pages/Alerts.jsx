import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellRing, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, SectionCard, StatusBadge, formatTime, prettyValue } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { endpoints } from "@/lib/api";
import { errorMessage } from "@/lib/actions";

const EMPTY_RULE = {
  name: "", series_selector: "host.cpu_percent", op: "gt", threshold: 80,
  for_seconds: 600, channel: "webhook", severity: "warning", enabled: true,
};

function RuleDialog({ open, onOpenChange, rule }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY_RULE, ...(rule || {}) });
  const mutation = useMutation({
    mutationFn: () => endpoints.saveRule(form, rule?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      onOpenChange(false);
      toast.success(rule ? "Regra atualizada" : "Regra criada");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar regra" : "Nova regra"}</DialogTitle>
          <DialogDescription>Seletor no formato metric{`{label="valor"}`}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CPU crítica" /></Field></div>
          <div className="sm:col-span-2"><Field label="Seletor de série"><Input className="font-mono" value={form.series_selector} onChange={(e) => setForm({ ...form, series_selector: e.target.value })} /></Field></div>
          <Field label="Operador">
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })}>
              {[["gt", ">"], ["gte", ">="], ["lt", "<"], ["lte", "<="], ["eq", "="]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Limiar"><Input type="number" step="any" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} /></Field>
          <Field label="Duração (s)"><Input type="number" min="0" value={form.for_seconds} onChange={(e) => setForm({ ...form, for_seconds: Number(e.target.value) })} /></Field>
          <Field label="Canal">
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="webhook">webhook</option><option value="email">email</option><option value="telegram">telegram</option>
            </select>
          </Field>
          <Field label="Severidade">
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option>
            </select>
          </Field>
          <div className="flex items-end gap-2 pb-2"><Switch checked={form.enabled} onCheckedChange={(value) => setForm({ ...form, enabled: value })} /><span className="text-xs text-muted-foreground">Regra habilitada</span></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!form.name || !form.series_selector || mutation.isPending} onClick={() => mutation.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Alerts() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const rules = useQuery({ queryKey: ["rules"], queryFn: endpoints.rules });
  const events = useQuery({ queryKey: ["alert-events"], queryFn: endpoints.alertEvents, refetchInterval: 30_000 });

  const remove = useMutation({
    mutationFn: (id) => endpoints.deleteRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const firing = (events.data || []).filter((event) => event.state === "firing");

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Avaliação periódica de séries com transições firing/resolved e notificação."
        actions={<Button size="sm" onClick={() => { setEditing(null); setCreating(true); }}><Plus className="h-4 w-4" /> Nova regra</Button>}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <SectionCard title="Regras"><div className="text-2xl font-semibold">{rules.data?.length ?? "—"}</div></SectionCard>
        <SectionCard title="Disparos ativos"><div className="flex items-center gap-2 text-2xl font-semibold text-red"><BellRing className="h-5 w-5" />{firing.length}</div></SectionCard>
        <SectionCard title="Eventos"><div className="text-2xl font-semibold">{events.data?.length ?? "—"}</div></SectionCard>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Regras</CardTitle></CardHeader>
        <CardContent>
          {rules.isLoading ? <LoadingState /> : rules.isError ? <ErrorState error={rules.error} retry={() => rules.refetch()} /> : (rules.data || []).length === 0 ? <EmptyState title="Nenhuma regra configurada" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Seletor</TableHead><TableHead>Condição</TableHead><TableHead>Canal</TableHead><TableHead>Ativa</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
              <TableBody>
                {rules.data.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}<div className="text-[11px] text-muted-foreground">{rule.severity}</div></TableCell>
                    <TableCell className="font-mono text-[11px]">{rule.series_selector}</TableCell>
                    <TableCell className="text-xs">{rule.op} {rule.threshold} por {rule.for_seconds}s</TableCell>
                    <TableCell className="text-xs">{rule.channel}</TableCell>
                    <TableCell><Badge variant={rule.enabled ? "default" : "secondary"}>{rule.enabled ? "sim" : "não"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(rule)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove.mutate(rule.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Bell className="h-4 w-4" /> Histórico de eventos</CardTitle></CardHeader>
        <CardContent>
          {events.isLoading ? <LoadingState /> : (events.data || []).length === 0 ? <EmptyState title="Nenhum evento registrado" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Série</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {events.data.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatTime(event.ts)}</TableCell>
                    <TableCell className="font-mono text-[11px]">{event.series}</TableCell>
                    <TableCell><StatusBadge value={event.state} /></TableCell>
                    <TableCell className="text-right font-mono text-xs">{prettyValue(event.value, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && <RuleDialog open onOpenChange={(value) => !value && (setCreating(false), setEditing(null))} rule={editing} />}
    </>
  );
}
