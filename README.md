# MotoristaPro

App para motoristas de aplicativo controlarem ganhos, gastos, veículos e manutenção, com armazenamento **offline-first (SQLite)** e sincronização com **Supabase**.

Reconstruído em 21/08/2026 a partir da especificação original (o código-fonte anterior foi perdido). Recriado com base no design documentado: React Native + Expo, TypeScript, `expo-sqlite`, `@supabase/supabase-js`, autenticação por email/senha e RLS por `user_id`.

## Stack

- **React Native + Expo** (TypeScript)
- **expo-sqlite** — banco local, fonte de verdade offline
- **Supabase** — Postgres + Auth + RLS, sincronização remota
- **React Navigation** (native-stack)

## Estrutura

```text
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
│   │   ├── MaintenanceService.ts     # addMaintenanceEvent() (exige veículo real)
│   │   ├── WorkSessionService.ts     # leitura de turnos para métricas
│   │   └── MetricsService.ts         # lucro, horas, km e custo/km
│   ├── hooks/useTransactionSync.ts   # reprocessa pendências
│   ├── navigation/AppNavigator.tsx
│   └── screens/                      # Login, Dashboard, Transações, Veículos, Manutenção, Sync
└── supabase/migrations/              # schema + RLS remoto
```

## Como rodar

```bash
npm install
cp .env.example .env.local
# preencha EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env.local
npx expo start
```

No painel do Supabase, aplique as migrations em `supabase/migrations/` (ou use `supabase db push` se estiver usando o CLI).

## Decisões importantes

- **Offline-first de verdade**: toda escrita vai pro SQLite primeiro. O Supabase é sincronizado depois, nunca é bloqueante.
- **`createTransaction()`** confirma o insert com um `SELECT` de verificação antes de marcar `sync_state = 'synced'`.
- **`vehicle_id` em manutenção nunca é placeholder.** Se não existir veículo, `addMaintenanceEvent()` lança `NoVehicleError` e a UI direciona pro cadastro de veículo.
- **RLS por `user_id = auth.uid()`** em todas as tabelas remotas.
- Logs `[DEBUG]`, `[SYNC]`, `[SUPABASE]` mantidos nos pontos de depuração.
- Métricas por hora/km só aparecem quando existem turnos encerrados com dados válidos; caso contrário ficam `null`.

## Typecheck

```bash
npm run typecheck
```

## Segurança

`.env.local` está no `.gitignore`. Nunca commitar a `service_role key` do Supabase — o app usa apenas a chave pública apropriada ao cliente, protegida pelas policies de RLS.
