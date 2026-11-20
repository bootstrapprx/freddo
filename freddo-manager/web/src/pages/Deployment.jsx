import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Globe, Plus, Rocket, ShieldCheck, Trash2, Wifi, WifiOff } from "lucide-react";
import { ErrorState, Field, LoadingState, PageHeader, SectionCard } from "@/components/Common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { endpoints } from "@/lib/api";
import { errorMessage } from "@/lib/actions";

export function Deployment() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["deployment-config"], queryFn: endpoints.deploymentConfig });
  const [domains, setDomains] = useState([]);
  const [domainInput, setDomainInput] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [baseDomain, setBaseDomain] = useState("");
  const [apps, setApps] = useState("erpnext");
  const [environment, setEnvironment] = useState("production");
  const [createdSite, setCreatedSite] = useState(null);

  useEffect(() => {
    if (config.data) {
      setDomains(config.data.domains || []);
      setBaseDomain((current) => current || config.data.domains?.[0] || "");
    }
  }, [config.data]);

  function handleError(error) {
    toast.error(errorMessage(error));
  }

  const saveDomains = useMutation({
    mutationFn: endpoints.saveDeploymentDomains,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deployment-config"] });
      toast.success("Domínios permitidos salvos");
    },
    onError: handleError,
  });
  const saveToken = useMutation({
    mutationFn: endpoints.setTunnelToken,
    onSuccess: () => {
      setToken("");
      queryClient.setQueryData(["deployment-config"], (current) => ({ ...current, tunnel_configured: true }));
      toast.success("Token do túnel salvo localmente");
    },
    onError: handleError,
  });
  const removeToken = useMutation({
    mutationFn: endpoints.deleteTunnelToken,
    onSuccess: () => {
      queryClient.setQueryData(["deployment-config"], (current) => ({ ...current, tunnel_configured: false }));
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Conector parado e token removido");
    },
    onError: handleError,
  });
  const tunnelAction = useMutation({
    mutationFn: (action) => action === "connect" ? endpoints.connectTunnel() : endpoints.disconnectTunnel(),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(job.kind === "tunnel.up" ? "Conexão do túnel enviada" : "Desconexão do túnel enviada", {
        description: `Job ${job.id}`,
      });
    },
    onError: handleError,
  });
  const deploySite = useMutation({
    mutationFn: endpoints.createSite,
    onSuccess: (result) => {
      setCreatedSite(result);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["benches"] });
      toast.success("Deploy enviado", { description: `Job ${result.id}` });
    },
    onError: handleError,
  });

  function addDomain(event) {
    event.preventDefault();
    const value = domainInput.trim().toLowerCase().replace(/\.$/, "");
    if (!value || domains.includes(value)) return;
    setDomains([...domains, value]);
    setBaseDomain(baseDomain || value);
    setDomainInput("");
  }

  function submitDeploy(event) {
    event.preventDefault();
    deploySite.mutate({
      label: label.trim(),
      base_domain: baseDomain,
      apps: apps.split(",").map((app) => app.trim()).filter(Boolean),
      environment,
    });
  }

  if (config.isLoading) return <LoadingState />;
  if (config.isError) return <ErrorState error={config.error} retry={() => config.refetch()} />;

  const configured = config.data?.tunnel_configured;
  const domainsSaved = JSON.stringify(domains) === JSON.stringify(config.data?.domains || []);
  const busy = saveDomains.isPending || saveToken.isPending || removeToken.isPending || tunnelAction.isPending;
  const hasPreview = Boolean(label.trim() && baseDomain);
  const hasApps = apps.split(",").some((app) => app.trim());
  const preview = hasPreview ? `${label.trim().toLowerCase()}.${baseDomain}` : "seu-site.dominio";

  return (
    <>
      <PageHeader
        title="Deploy e domínios"
        description="Configure o conector local e publique sites nos domínios vinculados. O painel Freddo permanece local."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Cloudflare Tunnel local" description="Use o token do túnel já criado. O segredo fica no host e nunca é exibido novamente.">
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-mauve" /> Token no host</div>
              <Badge variant={configured ? "default" : "secondary"}>{configured ? "configurado" : "ausente"}</Badge>
            </div>
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); saveToken.mutate(token); }}>
              <Field label="Token do túnel" hint="Cole o token remote-managed. O campo fica vazio depois de salvar.">
                <Input type="password" autoComplete="new-password" aria-label="Token do túnel" value={token} onChange={(event) => setToken(event.target.value)} placeholder={configured ? "Token salvo; informe outro para trocar" : "Cole o token do túnel"} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={!token || busy}>Salvar token</Button>
                <Button type="button" size="sm" variant="outline" disabled={!configured || busy} onClick={() => tunnelAction.mutate("connect")}><Wifi className="h-4 w-4" /> Conectar</Button>
                <Button type="button" size="sm" variant="outline" disabled={!configured || busy} onClick={() => tunnelAction.mutate("disconnect")}><WifiOff className="h-4 w-4" /> Desconectar</Button>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={!configured || busy} onClick={() => {
                  if (window.confirm("Parar o conector e remover o token local?")) removeToken.mutate();
                }}><Trash2 className="h-4 w-4" /> Remover token</Button>
              </div>
            </form>
            <p className="text-xs text-muted-foreground">Crie o primeiro site antes de conectar: o Frappe-Manager cria a rede compartilhada usada pelo conector.</p>
          </div>
        </SectionCard>

        <SectionCard title="Domínios de sites" description="Cada deploy cria um subdomínio de uma destas bases. Remover uma base não altera sites existentes.">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {domains.map((domain) => (
                <div key={domain} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 font-mono text-xs">
                  <Globe className="h-3.5 w-3.5 text-blue" /> {domain}
                  <button type="button" aria-label={`Remover ${domain}`} className="text-muted-foreground hover:text-destructive" onClick={() => {
                    const remaining = domains.filter((item) => item !== domain);
                    setDomains(remaining);
                    if (baseDomain === domain) setBaseDomain(remaining[0] || "");
                  }}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={addDomain}>
              <Input value={domainInput} onChange={(event) => setDomainInput(event.target.value)} placeholder="novo-dominio.com.br" aria-label="Novo domínio base" />
              <Button type="submit" size="icon" variant="outline" disabled={!domainInput.trim()} aria-label="Adicionar domínio"><Plus className="h-4 w-4" /></Button>
            </form>
            <div className="flex justify-end">
              <Button size="sm" disabled={busy || domains.length === 0} onClick={() => saveDomains.mutate(domains)}>Salvar domínios</Button>
            </div>
            {domains.length === 0 && <p className="text-xs text-destructive">Adicione pelo menos um domínio para habilitar deploys.</p>}
          </div>
        </SectionCard>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><Rocket className="h-4 w-4 text-mauve" /> Novo site</CardTitle>
            <CardDescription>O bench é criado pelo Executor local. Configure no painel Cloudflare os wildcards dos domínios para `http://global-nginx-proxy:80`; o hostname do Freddo não deve ser roteado.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" onSubmit={submitDeploy}>
              <Field label="Nome do site"><Input aria-label="Nome do site" value={label} onChange={(event) => setLabel(event.target.value.toLowerCase())} placeholder="erp" required pattern="[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?" maxLength={63} /></Field>
              <Field label="Domínio base">
                <select aria-label="Domínio base" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={baseDomain} onChange={(event) => setBaseDomain(event.target.value)} required>
                  {domains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
                </select>
              </Field>
              <Field label="Apps (separados por vírgula)"><Input aria-label="Apps" value={apps} onChange={(event) => setApps(event.target.value)} /></Field>
              <Field label="Ambiente">
                <select aria-label="Ambiente" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
                  <option value="production">production</option><option value="staging">staging</option><option value="development">development</option>
                </select>
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2 xl:col-span-3">
                <span className="text-xs text-muted-foreground">URL pública prevista</span>
                {hasPreview ? <a className="font-mono text-sm text-blue hover:underline" href={`https://${preview}`} target="_blank" rel="noreferrer">https://{preview}</a> : <span className="font-mono text-sm">https://{preview}</span>}
              </div>
              <Button type="submit" disabled={!configured || !domainsSaved || domains.length === 0 || !hasPreview || !hasApps || deploySite.isPending}><Rocket className="h-4 w-4" /> Criar site</Button>
            </form>
            {!configured && <p className="mt-3 text-xs text-peach">Configure o token do túnel antes de criar sites públicos.</p>}
            {!domainsSaved && <p className="mt-3 text-xs text-peach">Salve a lista de domínios antes de usá-la em um deploy.</p>}
          </CardContent>
        </Card>
      </div>

      {createdSite && (
        <Card className="mt-4 border-green/40">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="text-sm font-medium">Deploy aceito: <a className="text-blue hover:underline" href={`https://${createdSite.bench}`} target="_blank" rel="noreferrer">{createdSite.bench}</a></div><div className="mt-1 text-xs text-muted-foreground">Acompanhe o job {createdSite.id} na página Jobs.</div></div>
            {createdSite.admin_password && <div className="flex items-center gap-2"><code className="rounded bg-crust px-2 py-1 font-mono text-xs">{createdSite.admin_password}</code><Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(createdSite.admin_password); toast.success("Senha administrativa copiada"); }}><Copy className="h-4 w-4" /> Copiar senha</Button></div>}
          </CardContent>
        </Card>
      )}
    </>
  );
}
