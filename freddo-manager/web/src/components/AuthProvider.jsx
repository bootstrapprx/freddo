import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { endpoints, fetchCsrf } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      await fetchCsrf();
      const me = await endpoints.me();
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unauthorized = () => {
      setUser(null);
      if (window.location.pathname !== "/login") window.location.assign("/login");
    };
    window.addEventListener("freddo:unauthorized", unauthorized);
    return () => window.removeEventListener("freddo:unauthorized", unauthorized);
  }, [refresh]);

  const logout = useCallback(async () => {
    await endpoints.logout();
    setUser(null);
    window.location.assign("/login");
  }, []);

  const stepup = useCallback(async (data) => {
    const result = await endpoints.stepup(data);
    await refresh();
    return result;
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout, stepup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth fora do AuthProvider");
  return context;
}
