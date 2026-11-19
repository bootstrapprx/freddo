# Frappe Manager — Operations Console

## Entregáveis

### Console operacional responsivo com navegação lateral
- [x] O frontend deve representar um console operacional responsivo em português brasileiro para desenvolvimento e deploy de aplicações Frappe/ERPNext.
- [x] A navegação lateral deve conter visão geral, benches e áreas administrativas.

### Dashboard de visão geral
- [x] O dashboard deve exibir indicadores dos ambientes, saúde dos serviços, recursos e atividades recentes.
- [x] Os dados exibidos devem ser mockados e realistas, sem depender de backend real.

### Listagem e criação de benches
- [x] A listagem deve suportar busca, filtros, ordenação visual, status e ações principais.
- [x] O fluxo de criação deve permitir selecionar versão, ambiente e configuração inicial, com validação e estado simulado de execução.

### Operação de um bench
- [x] A página de detalhes deve mostrar ambiente, domínio, versão, recursos e status operacional.
- [x] Deve haver visualização de apps instalados, versões e compatibilidade simulada.
- [x] Deve haver controles visuais para iniciar, parar e reiniciar processos com feedback de estado.
- [x] Deve haver consulta de logs com seleção de serviço, busca, filtro por nível e destaque de severidade.
- [x] Deve haver gerenciamento visual de SSL com domínio, validade e ações simuladas de emissão ou renovação.

### Ferramentas administrativas e acabamento
- [x] A interface deve oferecer acesso a ferramentas administrativas, alternância entre desenvolvimento e produção e central de notificações.
- [x] A interface deve ser visualmente consistente, responsiva e pronta para Preview.

### Fluxo completo de deploy
- [x] O detalhe de cada bench deve oferecer uma área de deploy com seleção de branch, commit e opção de executar migrações.
- [x] O fluxo deve apresentar uma etapa explícita de revisão antes da publicação, com ambiente, estratégia e impacto resumidos.
- [x] A execução deve exibir progresso por etapas, incluindo validação, build, migrações, atualização de serviços e health checks.
- [x] O painel deve manter histórico de deploys com commit, branch, autor, duração e resultado.
- [x] Deploys concluídos devem permitir iniciar rollback com confirmação contextual.

### Monitoramento e logs em tempo real
- [x] Deve existir uma visão de monitoramento com disponibilidade, CPU, memória, requests por minuto e período selecionável.
- [x] O monitoramento deve exibir telemetria visual, saúde por ambiente, latência de requests e anomalias recentes.
- [x] Os dados mockados devem atualizar automaticamente em ciclos curtos, com controle para pausar e retomar.
- [x] A área de logs deve oferecer live tail, pausa, busca, filtro por nível e seleção de serviço.
- [x] Novos eventos devem aparecer no topo com destaque visual e a interface deve exibir o estado atual do stream.

### Gerenciamento de backups e restauração
- [x] Deve existir uma central de backups com criação manual, listagem por ambiente, tamanho, tipo, expiração e commit associado.
- [x] A central deve permitir configurar backups automáticos, frequência, retenção e acompanhar o uso do armazenamento seguro.
- [x] Cada backup concluído deve oferecer download e início do fluxo de restauração.
- [x] A restauração deve mostrar aviso de impacto, backup selecionado, destino e exigir confirmação explícita antes de iniciar.
- [x] O fluxo deve fornecer feedback visual de criação de backup e notificações após criação ou restauração.
