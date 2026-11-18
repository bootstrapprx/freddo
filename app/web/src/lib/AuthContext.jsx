import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { authClient } from "@/lib/authClient";
import { currentPath } from "@/lib/authReturnTo";
import { getSessionFn } from "@/lib/server-fns";

/**
 * Session resolved by the server on every page load and cached in the router's
 * QueryClient. The login gate reads the same query via ensureQueryData(), so a
 * child loader never runs before the session is known.
 */
export const authQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async () => {
    const session = await getSessionFn();
    return { user: session?.user ?? null, error: null };
  },
  staleTime: Infinity,
  retry: false,
});

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery(authQuery);

  const value = useMemo(
    () => ({
      user: data?.user ?? null,
      isAuthenticated: !!data?.user,
      isLoadingAuth: isPending,
      authError: data?.error ?? (error ? { type: "unknown", message: error.message ?? "Falha ao carregar a sessão" } : null),
      refresh: () => queryClient.fetchQuery({ ...authQuery, staleTime: 0 }),
      logout: async () => {
        try {
          await authClient.signOut();
        } finally {
          queryClient.setQueryData(authQuery.queryKey, { user: null, error: null });
          window.location.assign("/login");
        }
      },
      navigateToLogin: () => {
        const returnTo = currentPath();
        const query = returnTo === "/" ? "" : `?${new URLSearchParams({ returnTo })}`;
        window.location.assign(`/login${query}`);
      },
    }),
    [data, error, isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
