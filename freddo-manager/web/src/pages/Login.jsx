import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, LockKeyhole, Server } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/AuthProvider";
import { endpoints, fetchCsrf } from "@/lib/api";
import { errorMessage } from "@/lib/actions";

export function Login() {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [bootstrapResult, setBootstrapResult] = useState(null);
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const setup = useQuery({ queryKey: ["auth-setup"], queryFn: endpoints.authSetup, staleTime: 60_000 });

  // Se a consulta falhar, mantemos o comportamento seguro (exigir TOTP no front).
  const totpRequired = setup.data?.totp_required ?? true;
  const bootstrapRequired = setup.data?.bootstrap_required ?? false;

  async function submitBootstrap(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) return toast.error("As senhas não coincidem");
    setBusy(true);
    try {
      await fetchCsrf(true);
      const result = await endpoints.bootstrap({ token: bootstrapToken, password: newPassword });
      setBootstrapToken("");
      setNewPassword("");
      setConfirmPassword("");
      setBootstrapResult(result);
      await queryClient.invalidateQueries({ queryKey: ["auth-setup"] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await fetchCsrf(true);
      const payload = { password };
      if (totpRequired) {
        if (recovery) payload.recovery_code = code;
        else payload.totp = code;
      }
      await endpoints.login(payload);
      await refresh();
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-crust p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-mauve/15 text-mauve">
            <Server className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">freddo-manager</h1>
            <p className="text-sm text-muted-foreground">Console de operações Frappe</p>
          </div>
        </div>

        {bootstrapResult ? (
          <Card>
            <CardHeader>
              <CardTitle>Guarde seus códigos de acesso</CardTitle>
              <CardDescription>Registre o TOTP no autenticador e guarde os códigos de recuperação fora deste servidor. Estes dados aparecem somente agora.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div><Label>Chave TOTP</Label><code className="mt-1 block break-all rounded bg-mantle p-3">{bootstrapResult.totp_secret}</code></div>
              <div><Label>URI do autenticador</Label><code className="mt-1 block break-all rounded bg-mantle p-3">{bootstrapResult.totp_uri}</code></div>
              <div><Label>Códigos de recuperação</Label><pre className="mt-1 whitespace-pre-wrap rounded bg-mantle p-3 font-mono">{bootstrapResult.recovery_codes.join("\n")}</pre></div>
              <Button className="w-full" onClick={() => setBootstrapResult(null)}>Concluí, ir para o login</Button>
            </CardContent>
          </Card>
        ) : bootstrapRequired ? (
          <Card>
            <CardHeader>
              <CardTitle>Configuração inicial</CardTitle>
              <CardDescription>Use o token temporário gerado no host para criar sua senha e ativar o segundo fator.</CardDescription>
            </CardHeader>
            <CardContent>
              {setup.data?.bootstrap_available ? (
                <form className="space-y-4" onSubmit={submitBootstrap}>
                  <div className="space-y-2"><Label htmlFor="bootstrap-token">Token de bootstrap</Label><Input id="bootstrap-token" autoComplete="one-time-code" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} required /></div>
                  <div className="space-y-2"><Label htmlFor="new-password">Nova senha</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">Use pelo menos 12 caracteres.</p></div>
                  <div className="space-y-2"><Label htmlFor="confirm-password">Confirme a senha</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
                  <Button className="w-full" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Criar acesso</Button>
                </form>
              ) : (
                <div className="flex gap-2 rounded-md border border-peach/40 bg-peach/5 p-3 text-xs text-peach"><AlertTriangle className="h-4 w-4 shrink-0" /><span>Gere um token no host com <code className="font-mono">freddo-manager bootstrap --setup-token</code> e atualize esta página.</span></div>
              )}
            </CardContent>
          </Card>
        ) : <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockKeyhole className="h-4 w-4" /> Acesso restrito
            </CardTitle>
            <CardDescription>
              {totpRequired ? "Senha + segundo fator obrigatório." : "Credencial sem TOTP (bootstrap --no-totp)."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {totpRequired && (
                <div className="space-y-2">
                  <Label htmlFor="code">{recovery ? "Código de recuperação" : "Código TOTP"}</Label>
                  <Input
                    id="code"
                    inputMode={recovery ? "text" : "numeric"}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={recovery ? "xxxxxx-xxxxxx" : "000000"}
                    required
                  />
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy || setup.isLoading || bootstrapRequired}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Entrar
              </Button>

              {totpRequired && (
                <button
                  type="button"
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setRecovery((value) => !value); setCode(""); }}
                >
                  {recovery ? "Usar código do autenticador" : "Usar código de recuperação"}
                </button>
              )}
            </form>
          </CardContent>
        </Card>}
      </div>
    </div>
  );
}
