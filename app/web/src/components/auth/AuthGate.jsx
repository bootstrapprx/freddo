import { redirect } from "@tanstack/react-router";
import { DefaultCatchBoundary } from "@/components/DefaultCatchBoundary";
import { authQuery } from "@/lib/AuthContext";

/**
 * Login gate for the pathless `_authed` layout. Reads the same cached session
 * query as `useAuth()`; a child loader never runs for an anonymous visitor.
 */
export async function requireSignedIn({ context, location }) {
  const { user } = await context.queryClient.ensureQueryData(authQuery);
  if (user) return { user };

  throw redirect({
    to: "/login",
    search: { returnTo: location.href },
    reloadDocument: true,
  });
}

export function AuthGateError({ error }) {
  return <DefaultCatchBoundary error={error} />;
}
