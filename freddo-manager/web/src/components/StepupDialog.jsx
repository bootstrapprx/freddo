import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import { errorMessage } from "@/lib/actions";

export function StepupDialog() {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const { stepup, user } = useAuth();
  const totpRequired = user?.totp_required ?? true;

  useEffect(() => {
    const listener = () => {
      setSecret("");
      setOpen(true);
    };
    window.addEventListener("freddo:stepup", listener);
    return () => window.removeEventListener("freddo:stepup", listener);
  }, []);

  async function confirm() {
    setBusy(true);
    try {
      await stepup(totpRequired ? { totp: secret } : { password: secret });
      toast.success("Step-up válido por 5 minutos");
      setOpen(false);
      setSecret("");
      window.dispatchEvent(new CustomEvent("freddo:refresh"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const valid = totpRequired ? secret.length >= 6 : secret.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reautenticação necessária</DialogTitle>
          <DialogDescription>
            Ação sensível: informe {totpRequired ? "o código do autenticador" : "sua senha"} para elevar a sessão por 5 minutos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="stepup-secret">{totpRequired ? "Código TOTP" : "Senha"}</Label>
          <Input
            id="stepup-secret"
            type={totpRequired ? "text" : "password"}
            inputMode={totpRequired ? "numeric" : undefined}
            autoFocus
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && confirm()}
            placeholder={totpRequired ? "000000" : "••••••••"}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={confirm} disabled={busy || !valid}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
