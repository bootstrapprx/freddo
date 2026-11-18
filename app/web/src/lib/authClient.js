// Compatibility surface used by the auth screens while they are migrated to
// better-auth. All calls will be routed to our own endpoints, never to a
// third-party platform SDK.
const pending = (name) => () => {
  throw new Error(`${name} ainda não foi migrado para o cliente de autenticação próprio`);
};

export const authClient = {
  auth: {
    hasToken: () => false,
    me: async () => null,
    logout: pending("logout"),
    redirectToLogin: pending("redirectToLogin"),
    setToken: pending("setToken"),
    loginWithProvider: pending("loginWithProvider"),
    register: pending("register"),
    verifyOtp: pending("verifyOtp"),
    resendOtp: pending("resendOtp"),
    resetPasswordRequest: pending("resetPasswordRequest"),
    resetPassword: pending("resetPassword"),
  },
};
