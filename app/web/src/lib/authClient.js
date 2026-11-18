import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});

function unwrap(result, fallbackMessage) {
  if (result.error) {
    throw Object.assign(new Error(result.error.message || fallbackMessage), {
      status: result.error.status,
      code: result.error.code,
    });
  }
  return result.data;
}

export function signInEmail(email, password) {
  return unwrap(authClient.signIn.email({ email, password }), "E-mail ou senha inválidos");
}

export function signUpEmail(name, email, password) {
  return unwrap(authClient.signUp.email({ name, email, password }), "Falha ao criar a conta");
}

export function requestPasswordReset(email, redirectTo) {
  return unwrap(
    authClient.requestPasswordReset({ email, redirectTo }),
    "Não foi possível solicitar a redefinição",
  );
}

export function resetPassword(token, newPassword) {
  return unwrap(authClient.resetPassword({ token, newPassword }), "Falha ao redefinir a senha");
}

export function verifyTotp(code, trustDevice = false) {
  return unwrap(authClient.twoFactor.verifyTotp({ code, trustDevice }), "Código inválido");
}

export function enableTwoFactor(password) {
  return unwrap(authClient.twoFactor.enable({ password, method: "totp" }), "Falha ao ativar o TOTP");
}

export function disableTwoFactor(password) {
  return unwrap(authClient.twoFactor.disable({ password }), "Falha ao desativar o TOTP");
}
