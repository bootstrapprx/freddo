import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpCircle, Database, Play, RefreshCw, Server, Square } from "lucide-react";
import { ErrorState, Field, LoadingState, PageHeader, SectionCard, StatusBadge } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { endpoints } from "@/lib/api";
import { errorMessage, runAction } from "@/lib/actions";

function ConfirmUpdate({ kind, open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    await runAction(kind === "update" ? "Atualização do fm" : "Migração", async () => {
      if (!confirmed) throw new Error("backup_confirmation_required");
      return endpoints.fmAction(kind === "update" ? "update" : "migrate", confirmed);
    }, {
      onSuccess: () => {
        onOpenChange(false);
        setConfirmed(false);
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
    });
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "update" ? "Atualizar Frappe-Manager" : "Migrar Frappe-Manager"}</DialogTitle>
          <DialogDescription>Operação global: bloqueia novos jobs e exige step-up válido.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-md border border-peach/40 bg-peach/5 p-3 text-xs">
          <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} id="backup-confirm" />
          <label htmlFor="backup-confirm">Confirmo que existe backup recente e verificável de todos os benches.</label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!confirmed || busy} onClick={submit}>{busy && <RefreshCw className="h-4 w-4 animate-spin" />} Executar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function System() {
  const queryClient = useQueryClient();
  const system = useQuery({ queryKey: ["system"], queryFn: endpoints.system, refetchInterval: 30_000 });
  const version = useQuery({ queryKey: ["fm-version"], queryFn: endpoints.fmVersion });
  const services = useQuery({ queryKey: ["services"], queryFn: endpoints.services, refetchInterval: 30_000 });
  const [confirm, setConfirm] = useState(null);

  async function serviceAction(service, action) {
    await runAction(`${action} ${service}`, () => endpoints.serviceAction(service, action), {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    });
  }

  return (
    <>
      <PageHeader
        title="Sistema"
        description="Serviços globais, versão do fm e operações de manutenção do host."
        actions={<Button variant="outline" size="sm" onClick={() => { system.refetch(); version.refetch(); services.refetch(); }}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Painel">
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between"><dt className="text-muted-foreground">Executor</dt><dd><StatusBadge value={system.data?.executor_ok ? "online" : "offline"} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Container</dt><dd className="font-mono">{system.data?.container_runtime?.kind || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">CLI / socket</dt><dd className="truncate font-mono text-[11px]">{system.data?.container_runtime?.cli || "—"} / {system.data?.container_runtime?.socket_ready ? "ready" : "off"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Terminal web</dt><dd>{system.data?.shell_enabled ? "habilitado" : "desabilitado"}</dd></div>
          </dl>
          {(system.data?.container_runtime?.warnings || []).length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] text-peach">
              {system.data.container_runtime.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          )}
          {(system.data?.startup_errors || []).length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] text-destructive">{system.data.startup_errors.map((error) => <li key={error}>• {error}</li>)}</ul>
          )}
        </SectionCard>
        <SectionCard title="Frappe-Manager">
          {version.isLoading ? <LoadingState /> : version.isError ? <ErrorState error={version.error} /> : (
            <div className="space-y-3">
              <div className="font-mono text-lg">{version.data?.version || "—"}</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirm("update")}><ArrowUpCircle className="h-3.5 w-3.5" /> Atualizar</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm("migrate")}><Database className="h-3.5 w-3.5" /> Migrar</Button>
              </div>
            </div>
          )}
        </SectionCard>
        <SectionCard title="Segurança">
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li>• Executor isolado por Unix socket e SO_PEERCRED</li>
            <li>• Allowlist de argv, sem shell</li>
            <li>• Step-up para operações globais</li>
            <li>• Audit log encadeado por hash</li>
          </ul>
        </SectionCard>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Server className="h-4 w-4" /> Serviços globais</CardTitle></CardHeader>
        <CardContent>
          {services.isLoading ? <LoadingState /> : services.isError ? <ErrorState error={services.error} retry={() => services.refetch()} /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Serviço</TableHead><TableHead>Estado</TableHead><TableHead>Imagem</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
              <TableBody>
                {(services.data || []).map((service) => (
                  <TableRow key={service.name}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell><StatusBadge value={service.state} /></TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{service.image || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Start" onClick={() => serviceAction(service.name, "start")}><Play className="h-3.5 w-3.5 text-green" /></Button>
                        <Button variant="ghost" size="icon" title="Stop" onClick={() => serviceAction(service.name, "stop")}><Square className="h-3.5 w-3.5 text-red" /></Button>
                        <Button variant="ghost" size="icon" title="Restart" onClick={() => serviceAction(service.name, "restart")}><RefreshCw className="h-3.5 w-3.5 text-peach" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {confirm && <ConfirmUpdate kind={confirm} open onOpenChange={(value) => !value && setConfirm(null)} />}
    </>
  );
}
