import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, FileText, Plus, Trash2 } from "lucide-react";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, SectionCard, formatTime } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { endpoints } from "@/lib/api";
import { errorMessage } from "@/lib/actions";

function TemplateDialog({ open, onOpenChange, template }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(template?.name || "");
  const [spec, setSpec] = useState(JSON.stringify(template?.spec || { version: "v15", apps: ["frappe", "erpnext"] }, null, 2));
  const mutation = useMutation({
    mutationFn: () => {
      let parsed;
      try {
        parsed = JSON.parse(spec);
      } catch {
        throw new Error("JSON inválido");
      }
      return endpoints.saveTemplate({ name, spec: parsed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      onOpenChange(false);
      toast.success("Template salvo");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{template ? "Editar template" : "Novo template"}</DialogTitle><DialogDescription>Especificação reutilizada na criação de benches.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="padrao-producao" /></Field>
          <Field label="Especificação (JSON)"><Textarea className="min-h-56 font-mono text-xs" value={spec} onChange={(e) => setSpec(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={!name || mutation.isPending} onClick={() => mutation.mutate()}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Templates() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const templates = useQuery({ queryKey: ["templates"], queryFn: endpoints.templates });
  const remove = useMutation({
    mutationFn: (name) => endpoints.deleteTemplate(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title="Templates"
        description="Receitas de criação de bench versionadas no banco de estado."
        actions={<Button size="sm" onClick={() => { setEditing(null); setCreating(true); }}><Plus className="h-4 w-4" /> Novo template</Button>}
      />

      {templates.isLoading ? <LoadingState /> : templates.isError ? <ErrorState error={templates.error} retry={() => templates.refetch()} /> : (templates.data || []).length === 0 ? (
        <Card><CardContent><EmptyState title="Nenhum template salvo" description="Crie uma especificação para acelerar novos benches." /></CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.data.map((template) => (
            <Card key={template.name}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-mauve" />{template.name}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" title="Copiar JSON" onClick={() => {
                      navigator.clipboard?.writeText(JSON.stringify(template.spec, null, 2));
                      toast.success("JSON copiado");
                    }}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" title="Excluir" onClick={() => remove.mutate(template.name)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="max-h-52 overflow-auto rounded-md border border-border bg-crust p-3 text-[11px] leading-relaxed text-sub1">
                  {JSON.stringify(template.spec, null, 2)}
                </pre>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Atualizado em {formatTime(template.updated_at)}</span>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => { setEditing(template); setCreating(true); }}>Editar</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && <TemplateDialog open onOpenChange={(value) => !value && (setCreating(false), setEditing(null))} template={editing} />}
    </>
  );
}
