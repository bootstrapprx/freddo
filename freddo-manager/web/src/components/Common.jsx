import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function LoadingState({ label = "Carregando…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error, retry }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <div className="text-sm text-foreground">{error?.message || "Falha ao carregar dados"}</div>
        {error?.code && <div className="text-xs text-muted-foreground">código: {error.code}</div>}
        {retry && (
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title = "Nada por aqui", description }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
      <Inbox className="h-6 w-6" />
      <div className="text-sm text-foreground">{title}</div>
      {description && <div className="max-w-md text-xs">{description}</div>}
    </div>
  );
}

const STATE_VARIANTS = {
  running: "default",
  succeeded: "default",
  online: "default",
  active: "default",
  firing: "destructive",
  failed: "destructive",
  stopped: "secondary",
  queued: "secondary",
  pending: "secondary",
  resolved: "outline",
  cancelled: "outline",
  timed_out: "destructive",
};

export function StatusBadge({ value }) {
  const text = String(value ?? "—").replaceAll("_", " ");
  return (
    <Badge variant={STATE_VARIANTS[text] || "outline"} className="capitalize">
      {text}
    </Badge>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "mauve" }) {
  const tones = {
    mauve: "bg-mauve/10 text-mauve",
    blue: "bg-blue/10 text-blue",
    green: "bg-green/10 text-green",
    peach: "bg-peach/10 text-peach",
    red: "bg-red/10 text-red",
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        {Icon && <span className={`flex h-8 w-8 items-center justify-center rounded-md ${tones[tone]}`}><Icon className="h-4 w-4" /></span>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value ?? "—"}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-sub1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionCard({ title, description, children, className = "" }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function formatTime(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function prettyValue(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
}
