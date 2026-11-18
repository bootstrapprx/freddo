import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthError, SubmitButton } from "@/components/auth/parts";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authClient, disableTwoFactor, enableTwoFactor, verifyTotp } from "@/lib/authClient";

export function MfaPage() {
  const { data: session, refetch } = authClient.useSession();
  const enabled = Boolean(session?.user?.twoFactorEnabled);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnrollment(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await enableTwoFactor(password);
      setEnrollment(data);
      setPassword("");
    } catch (err) {
      setError(err.message || "Falha ao iniciar a configuração do TOTP");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await verifyTotp(code, false);
      await refetch();
      setEnrollment(null);
      setCode("");
    } catch (err) {
      setError(err.message || "Código inválido");
    } finally {
      setBusy(false);
    }
  }

  async function disable(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await disableTwoFactor(password);
      await refetch();
      setPassword("");
    } catch (err) {
      setError(err.message || "Falha ao desativar o TOTP");
    } finally {
      setBusy(false);
    }
  }

  if (enrollment) {
    return (
      <AuthLayout icon={ShieldCheck} title="Configurar autenticador" subtitle="Escaneie o URI abaixo e confirme com um código">
        <div className="session-record-block space-y-4">
          <p className="text-xs text-muted-foreground">
            Adicione este URI ao seu aplicativo autenticador (1Password, Aegis, Google Authenticator…):
          </p>
          <code className="block break-all rounded-md border border-border bg-muted/40 p-3 text-[11px]">
            {enrollment.totpURI}
          </code>
          {enrollment.backupCodes?.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Guarde estes códigos de recuperação:</p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                {enrollment.backupCodes.map((backupCode) => (
                  <code key={backupCode} className="rounded bg-muted/40 px-2 py-1">{backupCode}</code>
                ))}
              </div>
            </div>
          )}
          <AuthError>{error}</AuthError>
          <form onSubmit={confirmEnrollment} className="space-y-3">
            <Label htmlFor="mfa-code">Código do autenticador</Label>
            <InputOTP maxLength={6} value={code} onChange={setCode} autoComplete="one-time-code">
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <SubmitButton busy={busy} busyLabel="Ativando..." disabled={busy || code.length < 6}>
              Ativar TOTP
            </SubmitButton>
          </form>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={enabled ? ShieldCheck : KeyRound}
      title={enabled ? "TOTP ativo" : "Ativar TOTP"}
      subtitle={enabled ? "Você usará um código do aplicativo ao entrar" : "Proteja sua conta com um aplicativo autenticador"}
    >
      <AuthError>{error}</AuthError>
      {enabled ? (
        <form onSubmit={disable} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mfa-disable-password">Senha atual</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="mfa-disable-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 pl-10" required />
            </div>
          </div>
          <SubmitButton busy={busy} busyLabel="Desativando...">
            Desativar TOTP
          </SubmitButton>
        </form>
      ) : (
        <form onSubmit={startEnrollment} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mfa-enable-password">Senha atual</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="mfa-enable-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 pl-10" required />
            </div>
          </div>
          <SubmitButton busy={busy} busyLabel="Gerando segredo...">
            Configurar autenticador
          </SubmitButton>
        </form>
      )}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Somente TOTP está disponível neste MVP. SMS e login social não são suportados.
      </p>
    </AuthLayout>
  );
}
