import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/Toaster";
import { LoadingState } from "@/components/Common";
import { Alerts } from "@/pages/Alerts";
import { Audit } from "@/pages/Audit";
import { Benches } from "@/pages/Benches";
import { Dashboard } from "@/pages/Dashboard";
import { Jobs } from "@/pages/Jobs";
import { Login } from "@/pages/Login";
import { System } from "@/pages/System";
import { Templates } from "@/pages/Templates";
import { Telemetry } from "@/pages/Telemetry";

function Protected() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-crust">
        <LoadingState label="Verificando sessão…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected />}>
          <Route index element={<Dashboard />} />
          <Route path="benches" element={<Benches />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="telemetry" element={<Telemetry />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="templates" element={<Templates />} />
          <Route path="audit" element={<Audit />} />
          <Route path="system" element={<System />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </AuthProvider>
  );
}
