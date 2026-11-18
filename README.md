> Documentação integrada: [arquitetura final dos microsserviços](docs/ARQUITETURA-FINAL-MICROSSERVICOS.md) e [fluxograma da ordem de serviço (Mermaid)](docs/FLUXO-ORDEM-DE-SERVICO.mmd).

> Saga orquestrada: [fluxo, compensações, configuração e testes](docs/SAGA.md).

# Execution service

Execution owns parts, services, inventory, execution scheduling and execution lifecycle, with its own MongoDB database.

The original Portuguese HTTP paths are served here: `/api/pecas`, `/api/servicos`, `/api/estoque`, `/api/execucoes-servico`, and `/api/metricas/tempo-medio-servicos`. Existing internal catalog, inventory and scheduling endpoints remain available. See [endpoint contracts](docs/ENDPOINT-MIGRATION.md).

## Local Docker and RabbitMQ

Configure this repository's `.env`, including `RABBITMQ_URL`, then start its database, API, and one supervised `workers` container (execution publisher and Saga):

```bash
docker compose up -d --build
```

For a local shared broker, start Billing's Compose first and use `host.docker.internal:5672` in `RABBITMQ_URL`, with matching credentials and vhost. No sibling repository paths, shared Docker network, or profile flags are required. In separate environments, configure the reachable broker hostname. Workers reconnect if the broker is temporarily unavailable. See [messaging setup, queues, recovery and tests](docs/RABBITMQ.md). Execution's Compose uses the existing MongoDB volume with the `execution-rs` development replica set. No volume deletion is required. Host MongoDB access uses port 27018 with `directConnection=true`.

`EXECUTION_COMPLETION_TRANSPORT=rabbitmq` records completion and its durable outbox event in one transaction. `execution-publisher` publishes to `execution.events`; Service Orders and Billing receive independent deliveries through their own queues. The `http` transport retains the synchronous compatibility path.

## Authentication and checks

Use a Service Orders JWT for `/api` routes, with the same `JWT_SECRET`, or the owner's internal key for trusted callers. `/internal` routes require `x-internal-api-key`. Configure Service Orders lookup credentials for start eligibility.

```bash
npm ci
npm run typecheck
npm run check:architecture
npm test -- --runInBand
npm run coverage -- --runInBand
```

Optional database integration tests use `TEST_EXECUTION_MONGO_URL=mongodb://127.0.0.1:27018/?directConnection=true`. They create and remove isolated test databases. See [architecture notes](docs/ARCHITECTURE-REFACTOR.md).

Inventory updates and movement records are atomic per part. Operations spanning multiple parts are not a single stock reservation or distributed transaction. Cloud deployment and provider integrations require separate environment validation.

## Coverage e SonarQube

Jest usa `ts-jest` e coverage V8, seguindo o padrão do Service Orders. Os relatórios ficam em `coverage/lcov-report/index.html` (HTML) e `coverage/lcov.info` (SonarQube). A pipeline CI também executa a suíte com coverage.

Jest exige pelo menos **81% em linhas, statements, funções e branches**, inclusive na suíte padrão sem MongoDB. DTOs, declarações e contratos de ports sem lógica ficam fora do cálculo; as exclusões também estão configuradas no SonarQube. O port que contém `ExecutionOrderUnavailableError` permanece coberto, assim como controllers, gateways e regras de negócio.

Use o mesmo SonarQube do projeto principal em `http://localhost:9000`. Crie o projeto com a chave `techchallenge-execution`, gere um token com permissão de análise e preencha `SONAR_TOKEN` no `.env` (copie `.env.example` se necessário). Depois de gerar o coverage:

```bash
npm run sonar
```

O launcher usa o token do ambiente sem expansão de shell e propaga falhas do scanner. Assim como no principal, sem `SONAR_TOKEN` a análise é ignorada. O Sonar roda localmente; a pipeline não tenta acessar `localhost:9000` do desenvolvedor.

## Development seed

`docker compose up -d --build` runs `npm run seed` automatically before starting the API (after database initialization). Set `SEED_ENABLED=false` in `.env` to skip demo data. The seeds insert missing fixtures only; restarting does not overwrite edited records, reset stock, or renew expired estimates.

Execution populates `Pecas` (three parts/supplies), `Servicos` (three services), and `Estoque` (40 liters of oil, 20 filters, 10 brake pad sets). Each new stock document includes one initial receipt in its embedded movement history, visible through the stock movement API. Existing stock and catalog data are preserved. Execution records and outbox events are created through the normal business flow. The script is `src/mongo-init/seed.js`; a MongoDB replica set is required, as configured by Compose.

To run again manually with the configured Compose environment:

```bash
docker compose exec execution npm run seed
```

## Compact Docker Compose

The default Compose groups this service's background workers in one `workers` container, separate from the API. `run-workers.cjs` launches each worker as its own Node process, forwards shutdown signals, and stops the group if any worker exits. Docker restarts the group on failure. The shutdown timeout is 25 seconds; Compose allows 35 seconds. Individual npm worker commands remain available for separate Kubernetes workloads.

To replace the previous individual worker containers, run inside this repository:

```bash
docker compose up -d --build --remove-orphans
docker compose logs -f workers
```

Database volumes, API ports, seeds, migrations, broker and queue contracts are unchanged. The two MongoDB replica sets remain separate to preserve existing data and transactions. The MongoDB initializer containers are temporary; they exit after configuration.

Across Service Orders, Execution and Billing, this changes the number of permanent containers from 17 to 11 (3 + 3 + 5), plus two temporary MongoDB initializers. Worker processes still have their own memory and database connections. This reduces container count without guaranteeing proportional RAM or AWS cost savings. Workers in the same group restart together and cannot scale independently through Compose. Size Kubernetes requests and replicas from measurements; the subsequent Kubernetes replication is documented in [Kubernetes](docs/KUBERNETES.md).

## Kubernetes

API com HPA e workers agrupados seguem o padrão do Fiap. Veja [configuração e deploy](docs/KUBERNETES.md).
