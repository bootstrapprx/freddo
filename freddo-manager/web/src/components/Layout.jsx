import { useQuery } from "@tanstack/react-query";
import {
  Activity, Bell, Boxes, ChevronRight, FileClock, FileText, LayoutDashboard,
  LogOut, RefreshCw, Server, Settings2, ShieldCheck, Terminal,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { endpoints } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { StepupDialog } from "./StepupDialog";

const navigation = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/benches", label: "Benches", icon: Boxes },
  { to: "/jobs", label: "Jobs", icon: Activity },
  { to: "/telemetry", label: "Telemetria", icon: Terminal },
  { to: "/alerts", label: "Alertas", icon: Bell },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/audit", label: "Auditoria", icon: ShieldCheck },
  { to: "/system", label: "Sistema", icon: Settings2 },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: system } = useQuery({ queryKey: ["system"], queryFn: endpoints.system, refetchInterval: 30_000 });

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-crust/60 p-4 lg:flex">
        <NavLink to="/" className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mauve/15 text-mauve">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">freddo-manager</div>
            <div className="text-[11px] text-muted-foreground">Frappe control plane</div>
          </div>
        </NavLink>

        <nav className="flex flex-1 flex-col gap-1">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-mauve/10 text-mauve" : "text-sub0 hover:bg-surface0/60 hover:text-foreground"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
            </NavLink>
          ))}
        </nav>

        <Separator className="my-4" />
        <div className="space-y-2 px-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Executor</span>
            <Badge variant={system?.executor_ok ? "default" : "destructive"} className="text-[10px]">
              {system?.executor_ok ? "online" : "offline"}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" className="mt-4 justify-start text-muted-foreground" onClick={onLogout}>
          <LogOut className="h-4 w-4" /> Sair
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-4 lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <Server className="h-5 w-5 text-mauve" />
            <span className="font-semibold">freddo-manager</span>
          </div>
          <div className="hidden text-sm text-muted-foreground lg:block">
            {user?.stepup_until ? (
              <Badge variant="outline" className="border-green/40 text-green">step-up ativo</Badge>
            ) : (
              <span>Ações destructivas exigem step-up</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" title="Atualizar" onClick={() => window.dispatchEvent(new CustomEvent("freddo:refresh"))}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={onLogout} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <FileClock className="h-4 w-4" /> host único
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 lg:p-8">
          <Outlet />
        </main>
        <nav className="flex items-center justify-around border-t border-border bg-crust/60 p-2 lg:hidden">
          {navigation.slice(0, 6).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? "text-mauve" : "text-muted-foreground"}>
              <item.icon className="h-5 w-5" />
            </NavLink>
          ))}
        </nav>
      </div>
      <StepupDialog />
    </div>
  );
}
