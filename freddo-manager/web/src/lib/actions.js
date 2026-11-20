import { toast } from "sonner";

export function errorMessage(error) {
  const map = {
    invalid_credentials: "Credenciais inválidas",
    invalid_totp: "Código TOTP inválido",
    second_factor_required: "Informe o código do autenticador",
    stepup_required: "É necessária reautenticação (step-up)",
    confirmation_required: "Digite o nome do bench para confirmar",
    backup_confirmation_required: "Confirme que existe backup recente",
    too_many_attempts: "Muitas tentativas. Aguarde alguns minutos",
    not_bootstrapped: "Execute bootstrap no host antes de entrar",
    invalid_csrf: "Sessão CSRF inválida. Recarregue a página",
  };
  return map[error?.code] || error?.message || "Falha na operação";
}

export async function runAction(label, operation, { onSuccess } = {}) {
  try {
    const result = await operation();
    toast.success(`${label} enviado`, {
      description: result?.id ? `Job ${result.id}` : undefined,
    });
    onSuccess?.(result);
    return result;
  } catch (error) {
    if (error?.code === "stepup_required") {
      window.dispatchEvent(new CustomEvent("freddo:stepup"));
    }
    toast.error(errorMessage(error));
    return null;
  }
}
