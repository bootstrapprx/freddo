import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  AppWindow,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Box,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Cloud,
  Command,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Filter,
  Globe2,
  GitBranch,
  GitCommit,
  HardDrive,
  History,
  Layers3,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  LogOut,
  Menu,
  MoreHorizontal,
  Play,
  Pause,
  Radio,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TimerReset,
  Square,
  TerminalSquare,
  Wrench,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

type BenchStatus = "operational" | "attention" | "stopped";
type BenchEnvironment = "production" | "development";
type NavKey = "overview" | "benches" | "apps" | "monitor" | "logs" | "ssl" | "backups" | "admin";

type Bench = {
  id: string;
  name: string;
  environment: BenchEnvironment;
  status: BenchStatus;
  version: string;
  apps: number;
  cpu: number;
  memory: string;
  domain: string;
  region: string;
  updated: string;
  services: { label: string; status: "running" | "warning" | "stopped" }[];
};

const benches: Bench[] = [
  {
    id: "erpnext-prod",
    name: "erpnext-prod",
    environment: "production",
    status: "operational",
    version: "v15.72.1",
    apps: 4,
    cpu: 31,
    memory: "6.2 / 8 GB",
    domain: "erp.acme.io",
    region: "São Paulo, BR",
    updated: "há 12 min",
    services: [
      { label: "Web", status: "running" },
      { label: "Workers", status: "running" },
      { label: "Database", status: "running" },
      { label: "Redis", status: "running" },
    ],
  },
  {
    id: "crm-staging",
    name: "crm-staging",
    environment: "development",
    status: "operational",
    version: "v16.0.0-dev",
    apps: 6,
    cpu: 18,
    memory: "3.8 / 8 GB",
    domain: "crm.staging.acme.io",
    region: "São Paulo, BR",
    updated: "há 38 min",
    services: [
      { label: "Web", status: "running" },
      { label: "Workers", status: "running" },
      { label: "Database", status: "running" },
      { label: "Redis", status: "warning" },
    ],
  },
  {
    id: "website-lab",
    name: "website-lab",
    environment: "development",
    status: "stopped",
    version: "v15.66.0",
    apps: 3,
    cpu: 0,
    memory: "—",
    domain: "website.localhost",
    region: "Local",
    updated: "ontem, 18:42",
    services: [
      { label: "Web", status: "stopped" },
      { label: "Workers", status: "stopped" },
      { label: "Database", status: "stopped" },
      { label: "Redis", status: "stopped" },
    ],
  },
  {
    id: "hrms-prod",
    name: "hrms-prod",
    environment: "production",
    status: "attention",
    version: "v15.68.2",
    apps: 5,
    cpu: 67,
    memory: "7.4 / 8 GB",
    domain: "people.acme.io",
    region: "São Paulo, BR",
    updated: "há 4 min",
    services: [
      { label: "Web", status: "running" },
      { label: "Workers", status: "warning" },
      { label: "Database", status: "running" },
      { label: "Redis", status: "running" },
    ],
  },
];

type NavItem = { key: NavKey; label: string; icon: typeof LayoutDashboard; count?: string; dot?: boolean };

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { key: "overview" as NavKey, label: "Visão geral", icon: LayoutDashboard },
      { key: "benches" as NavKey, label: "Benches", icon: Server, count: "4" },
      { key: "apps" as NavKey, label: "Aplicações", icon: AppWindow },
    ],
  },
  {
    label: "Observabilidade",
    items: [
      { key: "monitor" as NavKey, label: "Monitoramento", icon: Activity },
      { key: "logs" as NavKey, label: "Logs", icon: TerminalSquare, dot: true },
      { key: "ssl" as NavKey, label: "SSL & domínios", icon: ShieldCheck },
    ],
  },
  {
    label: "Sistema",
    items: [
      { key: "backups" as NavKey, label: "Backups", icon: Archive },
      { key: "admin" as NavKey, label: "Ferramentas admin", icon: Wrench },
    ],
  },
];

const appCatalog = [
  { name: "Frappe Framework", slug: "frappe", version: "v15.72.1", compatibility: "Compatível", accent: "blue", icon: "F" },
  { name: "ERPNext", slug: "erpnext", version: "v15.66.0", compatibility: "Compatível", accent: "green", icon: "E" },
  { name: "HRMS", slug: "hrms", version: "v15.49.0", compatibility: "Atualização disponível", accent: "purple", icon: "H" },
  { name: "Payments", slug: "payments", version: "v0.0.1", compatibility: "Compatível", accent: "orange", icon: "P" },
];

const logs = [
  { time: "14:32:08", level: "INFO", service: "web", message: "GET /api/method/frappe.auth.get_logged_user 200 42ms" },
  { time: "14:31:52", level: "INFO", service: "worker", message: "Long job completed: rebuild_website_context (1.8s)" },
  { time: "14:31:40", level: "WARN", service: "redis", message: "Connection pool reached 80% capacity" },
  { time: "14:30:14", level: "INFO", service: "scheduler", message: "Scheduled task queue processed: 12 jobs" },
  { time: "14:28:03", level: "ERROR", service: "worker", message: "Failed to send email: Connection timed out" },
  { time: "14:27:56", level: "INFO", service: "web", message: "POST /api/method/frappe.desk.form.save 200 118ms" },
];

function StatusPill({ status }: { status: BenchStatus }) {
  const config = {
    operational: { label: "Operacional", className: "status-green", icon: CheckCircle2 },
    attention: { label: "Atenção", className: "status-amber", icon: AlertTriangle },
    stopped: { label: "Parado", className: "status-gray", icon: Square },
  }[status];
  const Icon = config.icon;
  return <span className={`status-pill ${config.className}`}><Icon size={13} strokeWidth={2.5} />{config.label}</span>;
}

function MiniBars({ values, color = "blue" }: { values: number[]; color?: "blue" | "orange" | "green" }) {
  return <div className={`mini-bars bars-${color}`} aria-hidden="true">{values.map((value, index) => <span key={index} style={{ height: `${Math.max(14, value)}%` }} />)}</div>;
}

function MetricCard({ label, value, helper, trend, trendPositive = true, icon: Icon, chart, chartColor }: { label: string; value: string; helper: string; trend?: string; trendPositive?: boolean; icon: typeof Activity; chart: number[]; chartColor: "blue" | "orange" | "green" }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className="metric-label">{label}</span><span className={`metric-icon metric-icon-${chartColor}`}><Icon size={16} /></span></div>
      <div className="metric-value-row"><strong>{value}</strong>{trend && <span className={`trend ${trendPositive ? "trend-up" : "trend-down"}`}>{trendPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{trend}</span>}</div>
      <div className="metric-bottom"><span>{helper}</span><MiniBars values={chart} color={chartColor} /></div>
    </article>
  );
}

function AppLogo({ small = false }: { small?: boolean }) {
  return <div className={`app-logo ${small ? "app-logo-small" : ""}`}><div className="logo-mark"><span /><span /><span /></div>{!small && <div><strong>Frappe<span>Ops</span></strong><small>MANAGER CONSOLE</small></div>}</div>;
}

function Sidebar({ active, onNavigate, onClose }: { active: NavKey; onNavigate: (key: NavKey) => void; onClose?: () => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header"><AppLogo /><button className="mobile-close" onClick={onClose} aria-label="Fechar menu"><X size={18} /></button></div>
      <div className="workspace-switcher"><div className="workspace-avatar">A</div><div><strong>Acme workspace</strong><span>4 ambientes ativos</span></div><ChevronDown size={15} /></div>
      <nav className="main-nav">
        {navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map((item) => { const Icon = item.icon; return <button key={item.key} className={`nav-item ${active === item.key ? "active" : ""}`} onClick={() => { onNavigate(item.key); onClose?.(); }}><Icon size={17} strokeWidth={active === item.key ? 2.2 : 1.8} /><span>{item.label}</span>{item.dot && <span className="nav-dot" />}{item.count && <em>{item.count}</em>}</button>; })}</div>)}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-callout"><Sparkles size={16} /><div><strong>Frappe Manager 0.20</strong><span>Atualização disponível</span></div><ChevronRight size={15} /></div><button className="sidebar-user"><div className="user-avatar">JD</div><div><strong>João da Silva</strong><span>Administrador</span></div><MoreHorizontal size={17} /></button></div>
    </aside>
  );
}

function Header({ title, onMenu, onCreate }: { title: string; onMenu: () => void; onCreate: () => void }) {
  return <header className="topbar"><div className="topbar-title"><button className="mobile-menu" onClick={onMenu} aria-label="Abrir menu"><Menu size={20} /></button><div><span className="eyebrow">WORKSPACE / {title.toUpperCase()}</span><h1>{title}</h1></div></div><div className="topbar-actions"><button className="icon-button search-trigger" title="Buscar"><Search size={18} /><kbd>⌘ K</kbd></button><button className="icon-button notification-button" title="Notificações"><Bell size={18} /><span /></button><div className="topbar-divider" /><button className="environment-switch"><span className="pulse-dot" />Produção<ChevronDown size={14} /></button><button className="primary-button" onClick={onCreate}><Plus size={16} />Novo bench</button></div></header>;
}

function HealthOverview() {
  const serviceRows = [
    { name: "Web server", description: "nginx + gunicorn", status: "operational", value: "99.99%", icon: Globe2 },
    { name: "Background workers", description: "8 processos ativos", status: "operational", value: "100%", icon: Zap },
    { name: "Database", description: "MariaDB 10.6", status: "operational", value: "24 ms", icon: Database },
    { name: "Redis queue", description: "2 de 4 instâncias", status: "attention", value: "78%", icon: Layers3 },
  ];
  return <section className="health-card"><div className="section-heading"><div><span className="section-kicker">SISTEMA</span><h2>Saúde dos serviços</h2></div><button className="ghost-button small"><RefreshCw size={14} />Atualizar</button></div><div className="service-list">{serviceRows.map((service) => { const Icon = service.icon; return <div className="service-row" key={service.name}><div className="service-icon"><Icon size={16} /></div><div className="service-name"><strong>{service.name}</strong><span>{service.description}</span></div><div className="service-stat"><span className={`service-dot ${service.status === "attention" ? "warning" : ""}`} />{service.status === "attention" ? "Atenção" : "Operacional"}</div><strong className="service-value">{service.value}</strong><ChevronRight size={16} className="service-arrow" /></div>; })}</div><div className="health-footer"><span><span className="status-live" />Todos os sistemas operacionais</span><span>Última verificação: agora</span></div></section>;
}

function ActivityPanel() {
  const activities = [
    { type: "deploy", title: "Deploy concluído", detail: "erpnext-prod · v15.72.1", time: "12 min", color: "blue" },
    { type: "ssl", title: "Certificado renovado", detail: "erp.acme.io", time: "1 h", color: "green" },
    { type: "alert", title: "Worker em atenção", detail: "hrms-prod · queue long", time: "2 h", color: "amber" },
    { type: "create", title: "Bench criado", detail: "crm-staging · development", time: "ontem", color: "purple" },
  ];
  const icons = { deploy: ArrowUpRight, ssl: ShieldCheck, alert: AlertTriangle, create: Plus };
  return <section className="activity-card"><div className="section-heading"><div><span className="section-kicker">EVENTOS RECENTES</span><h2>Atividade</h2></div><button className="text-button">Ver tudo <ArrowUpRight size={14} /></button></div><div className="activity-list">{activities.map((activity) => { const Icon = icons[activity.type as keyof typeof icons]; return <div className="activity-item" key={activity.title}><div className={`activity-icon activity-${activity.color}`}><Icon size={15} /></div><div className="activity-copy"><strong>{activity.title}</strong><span>{activity.detail}</span></div><time>{activity.time}</time></div>; })}</div><button className="activity-footer">Abrir central de atividades <ChevronRight size={15} /></button></section>;
}

function BenchTable({ onSelect, onCreate }: { onSelect: (bench: Bench) => void; onCreate: () => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | BenchStatus>("all");
  const [sort, setSort] = useState<"name" | "status">("name");
  const filtered = useMemo(() => benches.filter((bench) => (filter === "all" || bench.status === filter) && `${bench.name} ${bench.domain}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : a.status.localeCompare(b.status)), [filter, search, sort]);
  return <section className="bench-section"><div className="section-heading bench-heading"><div><span className="section-kicker">AMBIENTES</span><h2>Seus benches <span className="heading-count">{filtered.length}</span></h2></div><button className="primary-button" onClick={onCreate}><Plus size={16} />Criar bench</button></div><div className="table-toolbar"><div className="table-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou domínio" /></div><div className="table-actions"><select className="select-control" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filtrar por status"><option value="all">Todos os status</option><option value="operational">Operacionais</option><option value="attention">Em atenção</option><option value="stopped">Parados</option></select><button className="ghost-button" onClick={() => setSort(sort === "name" ? "status" : "name")}><SlidersHorizontal size={15} />Ordenar</button><button className="ghost-button only-icon" title="Mais filtros"><Filter size={15} /></button></div></div><div className="bench-table-wrap"><table className="bench-table"><thead><tr><th>Bench</th><th>Ambiente</th><th>Status</th><th>Versão</th><th>Recursos</th><th>Última atividade</th><th aria-label="Ações" /></tr></thead><tbody>{filtered.map((bench) => <tr key={bench.id} onClick={() => onSelect(bench)}><td><div className="bench-cell"><div className={`bench-symbol symbol-${bench.status}`}><Box size={16} /></div><div><strong>{bench.name}</strong><span>{bench.domain}</span></div></div></td><td><span className={`environment-label ${bench.environment}`}>{bench.environment === "production" ? "Produção" : "Desenvolvimento"}</span></td><td><StatusPill status={bench.status} /></td><td><code>{bench.version}</code><span className="apps-count">{bench.apps} apps</span></td><td><div className="resource-cell"><span><Cpu size={13} />{bench.cpu}%</span><div className="resource-track"><i style={{ width: `${Math.max(bench.cpu, 3)}%` }} /></div></div></td><td><span className="last-activity"><Clock3 size={13} />{bench.updated}</span></td><td><button className="row-more" onClick={(event) => { event.stopPropagation(); toast("Ações rápidas disponíveis ao abrir o bench"); }}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state"><Search size={20} /><strong>Nenhum bench encontrado</strong><span>Tente buscar por outro nome ou ajustar o filtro.</span></div>}</div><div className="table-footer"><span>Mostrando {filtered.length} de {benches.length} benches</span><div className="pagination"><button disabled><ChevronLeft size={15} /></button><span>1</span><button disabled><ChevronRight size={15} /></button></div></div></section>;
}

function CreateBenchModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<BenchEnvironment>("development");
  const [version, setVersion] = useState("v15");
  const [loading, setLoading] = useState(false);
  const submit = () => { if (!name.trim()) { toast.error("Digite um nome para o bench"); return; } setLoading(true); window.setTimeout(() => { setLoading(false); toast.success(`Bench ${name} criado com sucesso`); onCreated(); }, 1100); };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-header"><div><span className="section-kicker">NOVO AMBIENTE</span><h2 id="create-title">Criar bench</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div><div className="stepper"><div className={`step ${step >= 1 ? "current" : ""}`}><span>1</span><strong>Configuração</strong></div><i /><div className={`step ${step >= 2 ? "current" : ""}`}><span>2</span><strong>Aplicações</strong></div><i /><div className={`step ${step >= 3 ? "current" : ""}`}><span>3</span><strong>Revisão</strong></div></div>{step === 1 && <div className="modal-body"><label className="field-label">Nome do bench<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="ex.: finance-prod" /><span>Use apenas letras minúsculas, números e hífens.</span></label><div className="field-label">Ambiente<div className="choice-grid"><button className={`choice-card ${environment === "development" ? "selected" : ""}`} onClick={() => setEnvironment("development")}><div className="choice-icon choice-blue"><TerminalSquare size={17} /></div><div><strong>Desenvolvimento</strong><span>Hot reload e ferramentas dev</span></div>{environment === "development" && <Check size={16} />}</button><button className={`choice-card ${environment === "production" ? "selected" : ""}`} onClick={() => setEnvironment("production")}><div className="choice-icon choice-green"><ShieldCheck size={17} /></div><div><strong>Produção</strong><span>Otimizado para disponibilidade</span></div>{environment === "production" && <Check size={16} />}</button></div></div><label className="field-label">Versão do Frappe<select value={version} onChange={(event) => setVersion(event.target.value)}><option value="v15">Frappe v15 (recomendado)</option><option value="v16">Frappe v16 (beta)</option><option value="develop">develop (instável)</option></select></label><div className="modal-hint"><Sparkles size={16} /><span>Você poderá adicionar ERPNext, HRMS e outros apps na próxima etapa.</span></div></div>}{step === 2 && <div className="modal-body"><p className="step-intro">Selecione os apps que farão parte do seu ambiente inicial.</p><div className="app-selection">{appCatalog.slice(0, 3).map((app, index) => <button className={`app-select-row ${index < 2 ? "selected" : ""}`} key={app.slug}><div className={`app-avatar app-${app.accent}`}>{app.icon}</div><div><strong>{app.name}</strong><span>{app.version}</span></div><span className="check-box">{index < 2 && <Check size={13} />}</span></button>)}</div><div className="modal-hint"><Zap size={16} /><span>Configuração recomendada: Frappe Framework + ERPNext.</span></div></div>}{step === 3 && <div className="modal-body"><div className="review-card"><div><span>Nome</span><strong>{name || "seu-novo-bench"}</strong></div><div><span>Ambiente</span><strong>{environment === "production" ? "Produção" : "Desenvolvimento"}</strong></div><div><span>Versão</span><strong>Frappe {version}</strong></div><div><span>Apps iniciais</span><strong>Frappe Framework, ERPNext</strong></div></div><div className="modal-hint"><CheckCircle2 size={16} /><span>Pronto para provisionar com Docker, banco de dados e servidor web.</span></div></div>}<div className="modal-footer"><button className="ghost-button" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? "Cancelar" : "Voltar"}</button><button className="primary-button" onClick={() => step < 3 ? setStep(step + 1) : submit()} disabled={loading}>{loading ? <><Loader2 className="spin" size={16} />Provisionando...</> : <>{step < 3 ? "Continuar" : "Criar bench"}<ChevronRight size={16} /></>}</button></div></section></div>;
}

const deploySteps = [
  { label: "Validando configuração", detail: "Branch, commit e variáveis de ambiente" },
  { label: "Construindo imagem", detail: "Instalando dependências e compilando assets" },
  { label: "Executando migrações", detail: "Atualizando o schema com segurança" },
  { label: "Atualizando serviços", detail: "Trocando containers sem downtime" },
  { label: "Verificando saúde", detail: "Smoke tests e health checks" },
];

const deployHistory = [
  { id: "dpl-1042", branch: "main", commit: "a82f4c1", message: "fix: invoice totals", author: "João da Silva", time: "Hoje, 14:20", duration: "2m 14s", status: "success" },
  { id: "dpl-1041", branch: "release/v15.72", commit: "bd91e03", message: "chore: update frappe", author: "Marina Costa", time: "Ontem, 18:04", duration: "3m 02s", status: "success" },
  { id: "dpl-1040", branch: "main", commit: "f03ab29", message: "feat: payment webhook", author: "João da Silva", time: "17 nov, 11:48", duration: "1m 46s", status: "failed" },
];

function DeployPanel({ bench, compact = false }: { bench: Bench; compact?: boolean }) {
  const [branch, setBranch] = useState("main");
  const [commit, setCommit] = useState("a82f4c1");
  const [migration, setMigration] = useState(true);
  const [deployState, setDeployState] = useState<"idle" | "review" | "running" | "success">("idle");
  const [deployStep, setDeployStep] = useState(0);
  const [rollbackId, setRollbackId] = useState<string | null>(null);

  useEffect(() => {
    if (deployState !== "running") return;
    if (deployStep >= deploySteps.length) {
      setDeployState("success");
      toast.success("Deploy concluído", { description: `${bench.name} está rodando o commit ${commit}.` });
      return;
    }
    const timer = window.setTimeout(() => setDeployStep((step) => step + 1), 850);
    return () => window.clearTimeout(timer);
  }, [bench.name, commit, deployState, deployStep]);

  const statusLabel = (status: string) => status === "success" ? "Concluído" : "Falhou";
  const reset = () => { setDeployState("idle"); setDeployStep(0); };

  return <section className={`detail-card deploy-panel ${compact ? "full-panel" : ""}`}>
    <div className="section-heading"><div><span className="section-kicker">ENTREGA CONTÍNUA</span><h3>Deploy para {bench.name}</h3></div><span className="deploy-target"><span className="pulse-dot" />{bench.environment === "production" ? "Produção" : "Staging"}</span></div>
    {deployState === "idle" && <>
      <div className="deploy-intro"><GitBranch size={17} /><div><strong>Escolha uma versão para publicar</strong><span>O deploy será executado com zero downtime e terá rollback disponível.</span></div></div>
      <div className="deploy-form-grid"><label className="field-label">Branch<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="main">main</option><option value="release/v15.72">release/v15.72</option><option value="develop">develop</option></select></label><label className="field-label">Commit<input value={commit} onChange={(event) => setCommit(event.target.value)} /><span>Último commit: {commit} · agora</span></label></div>
      <div className="commit-preview"><div className="commit-icon"><GitCommit size={16} /></div><div><strong>{commit === "a82f4c1" ? "fix: invoice totals" : "feat: atualizar aplicação"}</strong><span>{branch} · João da Silva · há 4 min</span></div><CheckCircle2 size={16} className="commit-ok" /></div>
      <label className="migration-toggle"><input type="checkbox" checked={migration} onChange={(event) => setMigration(event.target.checked)} /><span className="toggle-track"><i /></span><span><strong>Executar migrações automaticamente</strong><small>Aplicar alterações de schema antes de atualizar os serviços</small></span></label>
      <div className="deploy-footer"><span><ShieldCheck size={14} />Health check obrigatório antes de finalizar</span><button className="primary-button" onClick={() => setDeployState("review")}><ArrowUpRight size={15} />Revisar deploy</button></div>
    </>}
    {deployState === "review" && <div className="deploy-review"><div className="review-banner"><AlertTriangle size={17} /><div><strong>Revise antes de publicar em {bench.environment === "production" ? "produção" : "staging"}</strong><span>Esta ação atualizará o ambiente {bench.name} e poderá reiniciar os workers.</span></div></div><div className="deploy-review-grid"><div><span>Branch</span><strong><GitBranch size={13} />{branch}</strong></div><div><span>Commit</span><strong><GitCommit size={13} />{commit}</strong></div><div><span>Migrações</span><strong>{migration ? "Ativadas" : "Desativadas"}</strong></div><div><span>Estratégia</span><strong>Rolling update</strong></div></div><div className="deploy-footer"><button className="ghost-button" onClick={reset}>Voltar e editar</button><button className="primary-button" onClick={() => { setDeployStep(0); setDeployState("running"); }}><Play size={15} />Confirmar deploy</button></div></div>}
    {deployState === "running" && <div className="deploy-progress"><div className="progress-head"><div><span className="section-kicker">DEPLOY EM ANDAMENTO</span><strong>Atualizando {bench.name}</strong></div><span className="progress-percent">{Math.min(100, Math.round((deployStep / deploySteps.length) * 100))}%</span></div><div className="progress-track"><i style={{ width: `${Math.min(100, (deployStep / deploySteps.length) * 100)}%` }} /></div><div className="deploy-steps">{deploySteps.map((step, index) => <div className={`deploy-step ${index < deployStep ? "done" : index === deployStep ? "current" : "pending"}`} key={step.label}><div className="step-status">{index < deployStep ? <Check size={13} /> : index === deployStep ? <Loader2 className="spin" size={13} /> : <span>{index + 1}</span>}</div><div><strong>{step.label}</strong><span>{step.detail}</span></div></div>)}</div><button className="ghost-button cancel-deploy" onClick={() => { setDeployState("idle"); setDeployStep(0); toast("Deploy cancelado"); }}><X size={14} />Cancelar execução</button></div>}
    {deployState === "success" && <div className="deploy-success"><div className="success-icon"><CheckCircle2 size={28} /></div><span className="section-kicker">DEPLOY CONCLUÍDO</span><h4>{bench.name} está atualizado</h4><p><strong>{commit}</strong> foi publicado em {deployStep > 0 ? "todas as instâncias" : "1 instância"} com health check aprovado.</p><div className="success-meta"><span><Clock3 size={13} />2m 14s</span><span><GitBranch size={13} />{branch}</span><span><ShieldCheck size={13} />Sem downtime</span></div><div className="deploy-footer"><button className="ghost-button" onClick={reset}>Novo deploy</button><button className="primary-button" onClick={() => toast("Abrindo logs do deploy", { description: "Os logs estarão disponíveis em instantes." })}><TerminalSquare size={15} />Ver logs</button></div></div>}
    <div className="deploy-history"><div className="history-heading"><div><span className="section-kicker">HISTÓRICO</span><strong>Deploys recentes</strong></div><History size={16} /></div>{deployHistory.map((item) => <div className="deploy-history-row" key={item.id}><div className={`history-status ${item.status}`}><Check size={12} /></div><div className="history-main"><strong>{item.message}</strong><span>{item.branch} · {item.commit} · {item.author}</span></div><div className="history-time"><strong>{statusLabel(item.status)}</strong><span>{item.time} · {item.duration}</span></div><button className="history-more" title="Opções de deploy" onClick={() => setRollbackId(rollbackId === item.id ? null : item.id)}><MoreHorizontal size={16} /></button>{rollbackId === item.id && <div className="rollback-popover"><div><strong>Fazer rollback?</strong><span>Voltar para {item.commit} em {bench.name}</span></div><button onClick={() => { setRollbackId(null); toast.success("Rollback iniciado", { description: `Restaurando ${item.commit} em ${bench.name}.` }); }}><RotateCw size={13} />Confirmar</button></div>}</div>)}</div>
  </section>;
}

function BenchDetail({ bench, onBack, onCreate }: { bench: Bench; onBack: () => void; onCreate: () => void }) {
  const [serviceLoading, setServiceLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "apps" | "ssl" | "deploy">("overview");
  const action = (label: string) => { setServiceLoading(label); window.setTimeout(() => { setServiceLoading(null); toast.success(`${label} concluído`, { description: `${bench.name} foi atualizado com sucesso.` }); }, 900); };
  return <div className="detail-page"><div className="detail-breadcrumb"><button onClick={onBack}><ChevronLeft size={16} />Todos os benches</button><ChevronRight size={14} /><span>{bench.name}</span></div><div className="detail-hero"><div className="detail-title"><div className={`bench-symbol large symbol-${bench.status}`}><Box size={23} /></div><div><div className="detail-title-line"><h2>{bench.name}</h2><StatusPill status={bench.status} /></div><p>{bench.domain} <span>·</span> {bench.environment === "production" ? "Produção" : "Desenvolvimento"}</p></div></div><div className="detail-actions"><button className="ghost-button" onClick={() => action("Reinício do bench")}><RotateCw size={15} />Reiniciar</button><button className="primary-button" onClick={() => setActiveTab("deploy")}><ArrowUpRight size={15} />Fazer deploy</button><button className="icon-button" title="Mais ações"><MoreHorizontal size={18} /></button></div></div><div className="detail-tabs"><button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Visão geral</button><button className={activeTab === "deploy" ? "active" : ""} onClick={() => setActiveTab("deploy")}>Deploys <span>3</span></button><button className={activeTab === "apps" ? "active" : ""} onClick={() => setActiveTab("apps")}>Aplicações <span>4</span></button><button className={activeTab === "logs" ? "active" : ""} onClick={() => setActiveTab("logs")}>Logs</button><button className={activeTab === "ssl" ? "active" : ""} onClick={() => setActiveTab("ssl")}>SSL & domínio</button></div>{activeTab === "overview" && <div className="detail-grid"><section className="detail-card overview-card"><div className="section-heading"><div><span className="section-kicker">STATUS OPERACIONAL</span><h3>Serviços do bench</h3></div><button className="ghost-button small" onClick={() => action("Atualização dos serviços")}><RefreshCw size={14} />Atualizar</button></div><div className="detail-service-grid">{bench.services.map((service) => <div className="detail-service" key={service.label}><div className="detail-service-top"><div className="service-icon"><Server size={15} /></div><span className={`service-dot ${service.status === "warning" ? "warning" : service.status === "stopped" ? "stopped" : ""}`} /></div><strong>{service.label}</strong><span>{service.status === "running" ? "Em execução" : service.status === "warning" ? "Requer atenção" : "Parado"}</span><button onClick={() => action(service.status === "running" ? `Reinício · ${service.label}` : `Início · ${service.label}`)} disabled={serviceLoading !== null}>{serviceLoading?.includes(service.label) ? <Loader2 className="spin" size={14} /> : service.status === "running" ? <RotateCw size={14} /> : <Play size={14} />}{service.status === "running" ? "Reiniciar" : "Iniciar"}</button></div>)}</div></section><section className="detail-card specs-card"><div className="section-heading"><div><span className="section-kicker">CONFIGURAÇÃO</span><h3>Informações do ambiente</h3></div><button className="icon-button"><Settings2 size={17} /></button></div><div className="spec-list"><div><span>Versão Frappe</span><strong>{bench.version}</strong></div><div><span>Ambiente</span><strong>{bench.environment === "production" ? "Produção" : "Desenvolvimento"}</strong></div><div><span>Região</span><strong>{bench.region}</strong></div><div><span>CPU alocada</span><strong>4 vCPU</strong></div><div><span>Memória</span><strong>{bench.memory}</strong></div><div><span>Último deploy</span><strong>{bench.updated}</strong></div></div></section><section className="detail-card resource-chart-card"><div className="section-heading"><div><span className="section-kicker">ÚLTIMOS 30 MIN</span><h3>Uso de recursos</h3></div><button className="ghost-button small">30 min <ChevronDown size={13} /></button></div><div className="resource-big"><div><span>CPU</span><strong>{bench.cpu}%</strong></div><div className="big-chart cpu-chart"><span className="chart-line" /><svg viewBox="0 0 400 90" preserveAspectRatio="none" aria-label="Gráfico de CPU"><path d="M0 73 C25 68, 28 58, 55 64 S92 48, 115 57 S147 49, 165 54 S193 25, 214 35 S244 46, 263 39 S285 49, 309 27 S343 35, 362 22 S388 31, 400 17" fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg></div></div><div className="resource-big"><div><span>Memória</span><strong>78%</strong></div><div className="big-chart memory-chart"><svg viewBox="0 0 400 90" preserveAspectRatio="none" aria-label="Gráfico de memória"><path d="M0 61 C28 55, 45 59, 70 56 S112 55, 132 62 S168 42, 190 48 S228 43, 250 45 S285 32, 305 39 S337 35, 365 26 S389 31, 400 25" fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg></div></div></section><section className="detail-card ssl-summary-card"><div className="section-heading"><div><span className="section-kicker">SEGURANÇA</span><h3>SSL & domínio</h3></div><ShieldCheck size={18} className="secure-icon" /></div><div className="ssl-summary"><div className="ssl-check"><CheckCircle2 size={18} /></div><div><strong>Certificado válido</strong><span>Renovação automática ativa</span></div><ChevronRight size={16} /></div><div className="ssl-domain"><Globe2 size={15} /><span>{bench.domain}</span><strong>até 18 jan. 2027</strong></div></section></div>}{activeTab === "deploy" && <DeployPanel bench={bench} compact />}{activeTab === "logs" && <LogsPanel compact />}{activeTab === "apps" && <AppsPanel compact />}{activeTab === "ssl" && <SslPanel compact />}</div>;
}

function MonitoringPanel() {
  const [range, setRange] = useState("30m");
  const [live, setLive] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1800);
    return () => window.clearInterval(timer);
  }, [live]);
  const cpu = 29 + (tick % 4);
  const memory = 68 + (tick % 5);
  const requests = 184 + (tick % 9);
  return <div className="monitor-page"><div className="monitor-header"><div><span className="section-kicker">OBSERVABILIDADE</span><h2>Monitoramento</h2><p>Acompanhe a saúde dos seus benches em tempo quase real.</p></div><div className="monitor-actions"><div className={`live-indicator ${live ? "is-live" : "is-paused"}`}><span />{live ? "Atualizando agora" : "Atualização pausada"}</div><button className="ghost-button" onClick={() => setLive((value) => !value)}>{live ? <Pause size={15} /> : <Play size={15} />}{live ? "Pausar" : "Retomar"}</button><select className="select-control" value={range} onChange={(event) => setRange(event.target.value)}><option value="15m">15 minutos</option><option value="30m">30 minutos</option><option value="6h">6 horas</option><option value="24h">24 horas</option></select></div></div><div className="monitor-stats"><div className="monitor-stat"><div className="monitor-stat-top"><span>Disponibilidade</span><CheckCircle2 size={16} /></div><strong>99,98%</strong><span className="stat-positive"><ArrowUpRight size={13} />0,04% vs. período anterior</span></div><div className="monitor-stat"><div className="monitor-stat-top"><span>CPU média</span><Cpu size={16} /></div><strong>{cpu}%</strong><span className="stat-neutral">em 4 benches ativos</span></div><div className="monitor-stat"><div className="monitor-stat-top"><span>Memória usada</span><HardDrive size={16} /></div><strong>{memory}%</strong><span className="stat-warning"><AlertTriangle size={13} />hrms-prod acima de 80%</span></div><div className="monitor-stat"><div className="monitor-stat-top"><span>Requests / min</span><Activity size={16} /></div><strong>{requests}</strong><span className="stat-positive"><ArrowUpRight size={13} />12% de tráfego</span></div></div><div className="monitor-grid"><section className="detail-card telemetry-card"><div className="section-heading"><div><span className="section-kicker">TELEMETRIA</span><h3>Uso dos recursos</h3></div><span className="chart-legend"><i className="legend-blue" />CPU <i className="legend-green" />Memória</span></div><div className="telemetry-chart"><div className="chart-y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div className="telemetry-plot"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div><svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-label="Gráfico de uso de recursos"><path d="M0 140 C35 132 50 145 82 127 S125 137 156 112 S202 118 230 105 S270 125 302 91 S350 108 381 83 S420 98 445 76 S490 91 520 65 S556 74 586 52 S630 69 700 39" fill="none" stroke="#5d9fe0" strokeWidth="3" vectorEffect="non-scaling-stroke" /><path d="M0 82 C35 74 52 92 82 76 S124 86 156 68 S195 79 230 60 S270 75 302 52 S345 69 381 58 S420 62 445 44 S488 56 520 39 S557 49 586 31 S630 42 700 25" fill="none" stroke="#71bf9b" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg><div className="chart-x-axis"><span>30m atrás</span><span>20m</span><span>10m</span><span>agora</span></div></div></div></section><section className="detail-card monitored-services"><div className="section-heading"><div><span className="section-kicker">BENCHES</span><h3>Saúde por ambiente</h3></div><button className="text-button">Ver todos <ArrowUpRight size={14} /></button></div><div className="monitored-list">{benches.map((bench) => <div className="monitored-row" key={bench.id}><div className={`bench-symbol symbol-${bench.status}`}><Box size={14} /></div><div className="monitored-name"><strong>{bench.name}</strong><span>{bench.domain}</span></div><div className="monitored-bars"><MiniBars values={[28 + bench.cpu, 37 + bench.cpu, 43 + bench.cpu, 32 + bench.cpu, 55 + bench.cpu, 47 + bench.cpu]} color={bench.status === "attention" ? "orange" : "blue"} /></div><StatusPill status={bench.status} /></div>)}</div></section><section className="detail-card latency-card"><div className="section-heading"><div><span className="section-kicker">PERFORMANCE</span><h3>Latência de requests</h3></div><span className="latency-value">184 ms <small>p95</small></span></div><div className="latency-visual"><div className="latency-line" /><div className="latency-labels"><span>50 ms</span><span>100 ms</span><span>150 ms</span><span>200 ms</span></div></div><div className="latency-footer"><span><span className="status-live" />Dentro do SLO de 250 ms</span><span>p50: 42 ms</span></div></section><section className="detail-card monitor-events"><div className="section-heading"><div><span className="section-kicker">EVENTOS AO VIVO</span><h3>Últimas anomalias</h3></div><Radio size={17} className={live ? "radio-live" : ""} /></div><div className="monitor-event-list"><div><span className="event-marker warning" /><div><strong>Memória acima do normal</strong><span>hrms-prod · 7.4 GB de 8 GB</span></div><time>agora</time></div><div><span className="event-marker success" /><div><strong>Health check recuperado</strong><span>crm-staging · web server</span></div><time>3 min</time></div><div><span className="event-marker neutral" /><div><strong>Worker processado</strong><span>erpnext-prod · 124 jobs</span></div><time>8 min</time></div></div></section></div><div className="monitor-footer"><span><TimerReset size={14} />Dados atualizados a cada 2 segundos</span><span>{live ? `Ciclo ${tick + 1}` : "Atualização manual"}</span></div></div>;
}

function LogsPanel({ compact = false }: { compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [live, setLive] = useState(true);
  const [stream, setStream] = useState(logs);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setStream((current) => [{ time: "agora", level: "INFO", service: "web", message: "GET /api/method/frappe.realtime.get_events 200 31ms" }, ...current].slice(0, 9)), 2600);
    return () => window.clearInterval(timer);
  }, [live]);
  const filtered = stream.filter((log) => (level === "all" || log.level === level) && `${log.service} ${log.message}`.toLowerCase().includes(query.toLowerCase()));
  return <section className={`detail-card logs-panel ${compact ? "full-panel" : ""}`}><div className="section-heading"><div><span className="section-kicker">OBSERVABILIDADE</span><h3>Logs em tempo real</h3></div><div className="logs-live-actions"><span className={`live-indicator ${live ? "is-live" : "is-paused"}`}><span />{live ? "Live tail" : "Pausado"}</span><button className="ghost-button small" onClick={() => setLive((value) => !value)}>{live ? <Pause size={14} /> : <Play size={14} />}{live ? "Pausar" : "Retomar"}</button></div></div><div className="logs-toolbar"><div className="table-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nos logs" /></div><select className="select-control" value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">Todos os níveis</option><option value="INFO">Info</option><option value="WARN">Avisos</option><option value="ERROR">Erros</option></select><select className="select-control"><option>Todos os serviços</option><option>web</option><option>worker</option><option>redis</option></select><button className="ghost-button only-icon" title="Limpar logs" onClick={() => setStream([])}><X size={15} /></button></div><div className="log-terminal">{filtered.length === 0 ? <div className="log-empty">Nenhum evento corresponde aos filtros atuais.</div> : filtered.map((log, index) => <div className={`log-line ${index === 0 && live ? "log-new" : ""}`} key={`${log.time}-${log.message}-${index}`}><time>{log.time}</time><span className={`log-level level-${log.level.toLowerCase()}`}>{log.level}</span><code>{log.service}</code><span className={log.level === "ERROR" ? "error-text" : ""}>{log.message}</span></div>)}</div><div className="logs-footer"><span><Radio size={13} className={live ? "radio-live" : ""} />{live ? "Recebendo novos eventos" : "Stream pausado"}</span><span>{filtered.length} eventos visíveis</span></div></section>;
}

function AppsPanel({ compact = false }: { compact?: boolean }) {
  return <section className={`detail-card apps-panel ${compact ? "full-panel" : ""}`}><div className="section-heading"><div><span className="section-kicker">CATÁLOGO DE APLICAÇÕES</span><h3>Apps instalados</h3></div><button className="primary-button small"><Plus size={15} />Adicionar app</button></div><div className="apps-grid">{appCatalog.map((app) => <div className="installed-app" key={app.slug}><div className={`app-avatar app-${app.accent}`}>{app.icon}</div><div className="installed-app-copy"><strong>{app.name}</strong><span>{app.slug}</span></div><div className="installed-app-version"><strong>{app.version}</strong><span className={app.compatibility.startsWith("Atual") ? "compat-warning" : "compat-ok"}>{app.compatibility}</span></div><MoreHorizontal size={16} /></div>)}</div></section>;
}

function SslPanel({ compact = false }: { compact?: boolean }) {
  return <section className={`detail-card ssl-panel ${compact ? "full-panel" : ""}`}><div className="section-heading"><div><span className="section-kicker">CERTIFICADOS</span><h3>SSL & domínios</h3></div><button className="ghost-button small"><RefreshCw size={14} />Verificar agora</button></div><div className="ssl-detail-card"><div className="ssl-check large"><ShieldCheck size={24} /></div><div><strong>Certificado Let's Encrypt</strong><span>Emissão automática e renovação habilitadas</span></div><span className="status-pill status-green"><CheckCircle2 size={13} />Válido</span></div><div className="domain-row"><div><Globe2 size={16} /><strong>erp.acme.io</strong></div><span>Expira em 61 dias</span><button className="text-button">Renovar <ArrowUpRight size={14} /></button></div></section>;
}

type BackupRecord = { id: string; bench: string; created: string; size: string; type: "Automático" | "Manual"; status: "Concluído" | "Falhou"; expires: string; commit: string };

const backupSeed: BackupRecord[] = [
  { id: "bkp-8472", bench: "erpnext-prod", created: "Hoje, 03:00", size: "2,4 GB", type: "Automático", status: "Concluído", expires: "em 27 dias", commit: "a82f4c1" },
  { id: "bkp-8471", bench: "hrms-prod", created: "Hoje, 03:00", size: "1,8 GB", type: "Automático", status: "Concluído", expires: "em 27 dias", commit: "72b93ae" },
  { id: "bkp-8470", bench: "crm-staging", created: "Ontem, 03:00", size: "940 MB", type: "Automático", status: "Concluído", expires: "em 26 dias", commit: "f03ab29" },
  { id: "bkp-8469", bench: "erpnext-prod", created: "17 nov, 16:42", size: "2,4 GB", type: "Manual", status: "Concluído", expires: "em 26 dias", commit: "bd91e03" },
];

function RestoreBackupModal({ backup, onClose, onConfirm }: { backup: BackupRecord; onClose: () => void; onConfirm: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="create-modal restore-modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><div className="modal-header"><div><span className="section-kicker">OPERAÇÃO PROTEGIDA</span><h2 id="restore-title">Restaurar backup</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div><div className="modal-body"><div className="restore-warning"><AlertTriangle size={19} /><div><strong>Esta ação substituirá os dados atuais</strong><span>O bench será colocado em modo de manutenção durante a restauração.</span></div></div><div className="restore-summary"><div><span>Backup selecionado</span><strong>{backup.bench} · {backup.created}</strong></div><div><span>Tamanho</span><strong>{backup.size}</strong></div><div><span>Commit associado</span><strong>{backup.commit}</strong></div><label><span>Restaurar em</span><select defaultValue={backup.bench}><option value="erpnext-prod">erpnext-prod</option><option value="hrms-prod">hrms-prod</option><option value="crm-staging">crm-staging</option></select></label></div><label className="restore-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>Entendo que os dados atuais do ambiente selecionado serão substituídos pelo conteúdo deste backup.</span></label></div><div className="modal-footer"><button className="ghost-button" onClick={onClose}>Cancelar</button><button className="danger-button" disabled={!acknowledged} onClick={onConfirm}><RotateCcw size={15} />Confirmar restauração</button></div></section></div>;
}

function BackupsPanel() {
  const [records, setRecords] = useState<BackupRecord[]>(backupSeed);
  const [creating, setCreating] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [retention, setRetention] = useState("30");
  const [restoreBackup, setRestoreBackup] = useState<BackupRecord | null>(null);
  const createBackup = () => { setCreating(true); window.setTimeout(() => { setRecords((current) => [{ id: `bkp-${8473 + current.length}`, bench: "erpnext-prod", created: "Agora", size: "2,4 GB", type: "Manual", status: "Concluído", expires: `em ${retention} dias`, commit: "a82f4c1" }, ...current]); setCreating(false); toast.success("Backup criado com sucesso", { description: "erpnext-prod foi salvo no armazenamento seguro." }); }, 1200); };
  return <div className="backups-page"><div className="page-intro"><div><span className="section-kicker">PROTEÇÃO DE DADOS</span><h2>Backups</h2><p>Proteja seus ambientes e restaure uma versão segura quando precisar.</p></div><button className="primary-button" onClick={createBackup} disabled={creating}>{creating ? <><Loader2 className="spin" size={15} />Criando backup...</> : <><Archive size={15} />Criar backup agora</>}</button></div><div className="backup-stats"><div className="backup-stat"><div className="backup-stat-icon blue"><Archive size={16} /></div><div><span>Último backup</span><strong>Hoje, 03:00</strong><small>Todos os ambientes protegidos</small></div></div><div className="backup-stat"><div className="backup-stat-icon green"><Cloud size={16} /></div><div><span>Armazenamento usado</span><strong>8,7 GB <small>/ 50 GB</small></strong><small>17,4% utilizado</small></div></div><div className="backup-stat"><div className="backup-stat-icon purple"><CalendarClock size={16} /></div><div><span>Próxima execução</span><strong>Amanhã, 03:00</strong><small>Frequência diária</small></div></div></div><div className="backups-layout"><section className="detail-card backups-list"><div className="section-heading"><div><span className="section-kicker">ARQUIVOS DE BACKUP</span><h3>Backups recentes <span className="heading-count">{records.length}</span></h3></div><button className="ghost-button small"><SlidersHorizontal size={14} />Filtrar</button></div><div className="backup-table-wrap"><table className="backup-table"><thead><tr><th>Ambiente</th><th>Criado em</th><th>Tipo</th><th>Tamanho</th><th>Expira</th><th aria-label="Ações" /></tr></thead><tbody>{records.map((backup) => <tr key={backup.id}><td><div className="backup-name"><div className="backup-file-icon"><Archive size={14} /></div><div><strong>{backup.bench}</strong><span>{backup.id} · {backup.commit}</span></div></div></td><td>{backup.created}</td><td><span className={`backup-type ${backup.type === "Manual" ? "manual" : "auto"}`}>{backup.type}</span></td><td>{backup.size}</td><td><span className="expiry-label">{backup.expires}</span></td><td><div className="backup-actions"><button title="Baixar backup" onClick={() => toast("Download preparado", { description: `${backup.id}.tar.gz estará disponível em instantes.` })}><Download size={15} /></button><button title="Restaurar backup" onClick={() => setRestoreBackup(backup)}><RotateCcw size={15} /></button></div></td></tr>)}</tbody></table></div><div className="backup-list-footer"><span>Retenção aplicada automaticamente conforme a política do workspace.</span><button className="text-button">Ver histórico completo <ArrowUpRight size={14} /></button></div></section><aside className="detail-card backup-policy"><div className="section-heading"><div><span className="section-kicker">POLÍTICA</span><h3>Agendamento e retenção</h3></div><Settings2 size={17} className="policy-icon" /></div><label className="schedule-toggle"><span><strong>Backups automáticos</strong><small>Executar todos os dias às 03:00</small></span><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /><i /></label><div className="policy-field"><span>Frequência</span><select disabled={!scheduleEnabled}><option>Todos os dias</option><option>A cada 12 horas</option><option>Uma vez por semana</option></select></div><div className="policy-field"><span>Reter backups por</span><div className="input-suffix"><input value={retention} onChange={(event) => setRetention(event.target.value)} /><em>dias</em></div></div><div className="policy-storage"><div><HardDrive size={15} /><span>Armazenamento seguro</span></div><strong>17%</strong><div className="resource-track"><i style={{ width: "17%" }} /></div><small>8,7 GB usados de 50 GB</small></div><button className="ghost-button policy-save" onClick={() => toast.success("Política salva", { description: "As próximas execuções usarão esta configuração." })}>Salvar política</button></aside></div>{restoreBackup && <RestoreBackupModal backup={restoreBackup} onClose={() => setRestoreBackup(null)} onConfirm={() => { setRestoreBackup(null); toast.success("Restauração iniciada", { description: `${restoreBackup.id} está sendo restaurado com o bench em modo de manutenção.` }); }} />}</div>;
}

function EmptySection({ title, description, icon: Icon, action }: { title: string; description: string; icon: typeof Wrench; action?: string }) { return <div className="empty-section"><div className="empty-section-icon"><Icon size={24} /></div><h2>{title}</h2><p>{description}</p>{action && <button className="primary-button"><Plus size={16} />{action}</button>}</div>; }

function Home() {
  const [activeNav, setActiveNav] = useState<NavKey>("overview");
  const [selectedBench, setSelectedBench] = useState<Bench | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pageTitle = selectedBench ? selectedBench.name : activeNav === "overview" ? "Visão geral" : navGroups.flatMap((group) => group.items).find((item) => item.key === activeNav)?.label ?? "Visão geral";
  const handleNav = (key: NavKey) => { setActiveNav(key); setSelectedBench(null); };
  const renderContent = () => {
    if (selectedBench) return <BenchDetail bench={selectedBench} onBack={() => setSelectedBench(null)} onCreate={() => setModalOpen(true)} />;
    if (activeNav === "overview") return <><div className="welcome-row"><div><p className="welcome-kicker"><span className="status-live" />Tudo funcionando normalmente</p><h2>Bom dia, João <span className="wave">✦</span></h2><p className="welcome-copy">Aqui está o resumo da sua infraestrutura Frappe nesta manhã.</p></div><button className="date-button"><Clock3 size={15} />18 de novembro, 2026<ChevronDown size={14} /></button></div><div className="metric-grid"><MetricCard label="Benches ativos" value="3 / 4" helper="1 parado" trend="12%" icon={Server} chart={[45, 50, 48, 67, 56, 72, 65, 78, 72, 81, 75, 88]} chartColor="blue" /><MetricCard label="Disponibilidade" value="99,98%" helper="últimos 30 dias" trend="0,04%" icon={Activity} chart={[72, 78, 76, 81, 79, 84, 80, 86, 88, 85, 91, 94]} chartColor="green" /><MetricCard label="Uso de CPU" value="29%" helper="média dos ambientes" trend="8%" trendPositive={false} icon={Cpu} chart={[78, 68, 70, 59, 63, 52, 57, 45, 51, 41, 46, 39]} chartColor="orange" /><MetricCard label="Armazenamento" value="128 GB" helper="de 256 GB alocados" trend="6,2%" icon={HardDrive} chart={[30, 36, 39, 43, 44, 48, 53, 54, 57, 59, 62, 65]} chartColor="blue" /></div><div className="overview-grid"><HealthOverview /><ActivityPanel /></div><BenchTable onSelect={setSelectedBench} onCreate={() => setModalOpen(true)} /></>;
    if (activeNav === "benches") return <><div className="page-intro"><div><span className="section-kicker">WORKSPACE</span><h2>Todos os benches</h2><p>Gerencie os ambientes Frappe rodando na sua máquina.</p></div><div className="intro-actions"><button className="ghost-button"><DownloadIcon />Exportar</button><button className="primary-button" onClick={() => setModalOpen(true)}><Plus size={16} />Criar bench</button></div></div><BenchTable onSelect={setSelectedBench} onCreate={() => setModalOpen(true)} /></>;
    if (activeNav === "apps") return <div className="single-panel"><AppsPanel /></div>;
    if (activeNav === "monitor") return <MonitoringPanel />;
    if (activeNav === "logs") return <div className="single-panel"><LogsPanel /></div>;
    if (activeNav === "ssl") return <div className="single-panel"><SslPanel /></div>;
    if (activeNav === "backups") return <BackupsPanel />;
    return <EmptySection title="Ferramentas administrativas" description="Acesse Mailpit, Adminer e o shell dos seus benches em um único lugar." icon={Wrench} action="Abrir ferramentas" />;
  };
  return <div className="app-shell">{mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />}<div className={mobileMenuOpen ? "sidebar-mobile-open" : "sidebar-mobile-closed"}><Sidebar active={activeNav} onNavigate={handleNav} onClose={() => setMobileMenuOpen(false)} /></div><main className="main-shell"><Header title={pageTitle} onMenu={() => setMobileMenuOpen(true)} onCreate={() => setModalOpen(true)} /><div className="page-content">{renderContent()}</div><footer className="app-footer"><span><Command size={13} />FrappeOps Console</span><span>Powered by Frappe Manager</span><span className="footer-status"><span className="status-live" />Sistema operacional</span></footer></main>{modalOpen && <CreateBenchModal onClose={() => setModalOpen(false)} onCreated={() => { setModalOpen(false); setActiveNav("benches"); }} />}</div>;
}

function DownloadIcon() { return <ArrowDownRight size={15} />; }

export default Home;
