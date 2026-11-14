# Execution service

Execution owns parts, services, inventory, execution scheduling and execution lifecycle, with its own MongoDB database.

The original Portuguese HTTP paths are served here: `/api/pecas`, `/api/servicos`, `/api/estoque`, `/api/execucoes-servico`, and `/api/metricas/tempo-medio-servicos`. Existing internal catalog, inventory and scheduling endpoints remain available. See [endpoint contracts](docs/ENDPOINT-MIGRATION.md).

## Local Docker and RabbitMQ

Configure this repository's `.env`, including `RABBITMQ_URL`, then start its database, API, and publisher:

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
npm test -- --runInBand --coverage=false
```

Optional database integration tests use `TEST_EXECUTION_MONGO_URL=mongodb://127.0.0.1:27018/?directConnection=true`. They create and remove isolated test databases. See [architecture notes](docs/ARCHITECTURE-REFACTOR.md).

Inventory updates and movement records are atomic per part. Operations spanning multiple parts are not a single stock reservation or distributed transaction. Cloud deployment and provider integrations require separate environment validation.
