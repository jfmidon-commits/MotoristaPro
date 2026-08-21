# MotoristaPro

App para motoristas de aplicativo controlarem ganhos, gastos, veículos e manutenção, com armazenamento **offline-first (SQLite)** e sincronização com **Supabase**.

Reconstruído em 21/08/2026 a partir da especificação original (o código-fonte anterior foi perdido). Recriado com base no design documentado: React Native + Expo, TypeScript, `expo-sqlite`, `@supabase/supabase-js`, autenticação por email/senha e RLS por `user_id`.

## Stack

- **React Native + Expo** (TypeScript)
- **expo-sqlite** — banco local, fonte de verdade offline
- **Supabase** — Postgres + Auth + RLS, sincronização remota
- **React Navigation** (native-stack)

## Estrutura

```
MotoristaPro/
├── App.tsx
├── src/
│   ├── context/AuthContext.tsx       # sessão Supabase
│   ├── lib/
│   │   ├── database.ts               # schema + conexão SQLite
│   │   └── supabase.ts               # cliente Supabase
│   ├── services/
│   │   ├── TransactionService.ts     # addTransaction() / createTransaction()
│   │   ├── VehicleService.ts         # createVehicle()
│   │   └── MaintenanceService.ts     # addMaintenanceEvent() (exige veículo real)
│   ├── hooks/useTransactionSync.ts   # reprocessa pendências
│   ├── navigation/AppNavigator.tsx
│   └── screens/                      # Login, Dashboard, Transações, Veículos, Manutenção, Sync
└── supabase/migrations/0001_init.sql # schema + RLS remoto
```

## Como rodar

```bash
npm install
cp .env.example .env.local
# preencha EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env.local
npx expo start
```

No painel do Supabase: rode `supabase/migrations/0001_init.sql` no SQL Editor (ou `supabase db push` se estiver usando o CLI).

## Decisões importantes (herdadas da spec original)

- **Offline-first de verdade**: toda escrita vai pro SQLite primeiro. O Supabase é sincronizado depois, nunca é bloqueante.
- **`createTransaction()`** confirma o insert com um `SELECT` de verificação antes de marcar `sync_state = 'synced'` — não confia só na ausência de erro.
- **`vehicle_id` em manutenção nunca é placeholder.** Se não existir veículo, `addMaintenanceEvent()` lança `NoVehicleError` e a UI direciona pro cadastro de veículo.
- **RLS por `user_id = auth.uid()`** em todas as tabelas (vehicles, transactions, maintenance_events).
- Logs `[DEBUG]`, `[SYNC]`, `[SUPABASE]` mantidos nos pontos originais pra facilitar depuração de sync.

## Typecheck

```bash
npm run typecheck
```

## Segurança

`.env.local` está no `.gitignore`. Nunca commitar a `service_role key` do Supabase — o app usa só a `anon key`, protegida pelas policies de RLS.

## Testes

```bash
npm test
```

Cobre a lógica de formatação/parsing de moeda (a parte mais sensível a bugs silenciosos: erro de centavo é dinheiro real).

## Auditoria (21/08/2026)

Correções aplicadas nesta rodada:

- **🔴 Segurança:** RLS sozinho não impedia um `vehicle_id` de apontar pra veículo de outro usuário. Adicionado trigger `check_vehicle_ownership()` em `transactions` e `maintenance_events`.
- **🟠 Sync:** adicionado `NetInfo` para não tentar sincronizar sem conexão, mais backoff exponencial (5s/10s/20s/40s/80s) e limite de 5 tentativas automáticas antes de exigir ação manual.
- **🟠 CRUD:** adicionado `deleteTransaction()` (segurar uma transação na lista pra excluir).
- **🟡 Escala:** listagem de transações agora pagina (30 por vez, scroll infinito) em vez de carregar tudo de uma vez.
- **🟠 Testes:** suíte Jest inicial (`src/__tests__/`) + CI no GitHub Actions rodando typecheck e testes a cada push.

### Backlog recomendado (não implementado ainda)

- Editar transação existente (hoje só cria/exclui)
- Seletor de veículo na tela de "Nova transação" quando o usuário tem mais de um veículo (hoje sempre usa o padrão)
- Categorias customizáveis pelo usuário (hoje é lista fixa)
- Gráficos de ganhos por semana/mês, custo por km rodado (alto valor pro motorista de app)
- Exportar relatório (CSV/PDF) para declarar imposto de renda
- Autenticação biométrica para abrir o app
- Considerar migrar de polling de sync por evento para uma lib dedicada (ex: [PowerSync](https://www.powersync.com) ou [Supastash](https://github.com/0xZekeA/supastash)) se o volume de dados crescer muito — a solução atual (SQLite manual + upsert) é suficiente para o volume esperado de um motorista individual, mas não escalaria bem para sync multi-dispositivo com conflitos complexos
