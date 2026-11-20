import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, ShieldCheck, ShieldX } from "lucide-react";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, SectionCard, formatTime } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { endpoints } from "@/lib/api";

export function Audit() {
  const [limit, setLimit] = useState(100);
  const audit = useQuery({ queryKey: ["audit", limit], queryFn: endpoints.audit });
  const verify = useQuery({ queryKey: ["audit-verify"], queryFn: endpoints.verifyAudit });

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registro encadeado por hash de autenticação, leituras sensíveis e operações."
        actions={<>
          <Field label="Linhas"><Input className="w-24" type="number" min="1" max="1000" value={limit} onChange={(e) => setLimit(Math.min(1000, Math.max(1, Number(e.target.value))))} /></Field>
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(audit.data || [], null, 2)); }}><Download className="h-4 w-4" /> Copiar JSON</Button>
        </>}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <SectionCard title="Integridade da cadeia">
          {verify.isLoading ? <LoadingState /> : verify.isError ? <div className="text-xs text-destructive">{verify.error?.message}</div> : (
            <div className={`flex items-center gap-2 text-sm ${verify.data?.ok ? "text-green" : "text-destructive"}`}>
              {verify.data?.ok ? <CheckCircle2 className="h-4 w-4" /> : <ShieldX className="h-4 w-4" />}
              {verify.data?.ok ? "Íntegre" : "Divergência detectada"}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Eventos verificados"><div className="text-2xl font-semibold tabular-nums">{verify.data?.entries ?? "—"}</div></SectionCard>
        <SectionCard title="Verificação local">
          <div className="text-xs text-muted-foreground">
            Equivale a <code className="font-mono text-foreground">freddo-manager verify-audit</code>.
            {verify.data?.broken_at ? ` Divergência no evento ${verify.data.broken_at}.` : ""}
          </div>
        </SectionCard>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4" /> Eventos recentes</CardTitle></CardHeader>
        <CardContent>
          {audit.isLoading ? <LoadingState /> : audit.isError ? <ErrorState error={audit.error} retry={() => audit.refetch()} /> : (audit.data || []).length === 0 ? <EmptyState title="Nenhum evento registrado" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Ator</TableHead><TableHead>Ação</TableHead><TableHead>Alvo</TableHead><TableHead>Origem</TableHead><TableHead>Detalhes</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.data.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(event.ts)}</TableCell>
                    <TableCell className="text-xs">{event.actor || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="font-mono text-[10px]">{event.action}</Badge></TableCell>
                    <TableCell className="text-xs">{event.target || "—"}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{event.ip || "—"}</TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-[10px] text-muted-foreground">{JSON.stringify(event.detail || {})}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
