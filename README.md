# Execution service — extraction in progress

This repository extracts the original project's catalog, inventory and service-execution domain, use cases, MongoDB gateways and focused unit tests. It uses its own `execution` MongoDB database. The initial HTTP process currently exposes only authenticated internal catalog operations and idempotent scheduling; it is **not yet a complete Execution microservice**.

## Local development

Use Node 20. Copy `.env.example` to `.env`, set a unique `INTERNAL_API_KEY`, then run `npm ci`, `npm run typecheck`, and `npm test`. `docker compose up --build` starts the catalog process with its own MongoDB on port 27018. Internal requests require `x-internal-api-key`. Health endpoints are `/health` and `/ready`.

Current endpoints: `POST /internal/inventory/check`, `POST /internal/inventory/consume`, `POST /internal/inventory/receive`, `GET /internal/parts/:id`, `GET /internal/services/:id`, `POST /internal/parts`, `POST /internal/services`, and `POST /internal/executions` (with `{ordemServicoId,servicoIds}`). Scheduling validates services against the local catalog and uses a unique order/service index to make retries safe. It trusts the authenticated Service Orders caller to provide a valid order. Set Service Orders `EXECUTION_INTERNAL_API_KEY` to the same value.

## Remaining extraction

The extracted execution use cases still depend on an order gateway interface inherited from the monolith. No gateway in this service may access the Service Orders database. Execution start/finish, inventory operations and transactional reservations have not yet been exposed or integrated; the inherited inventory movement use case is not safe against concurrent updates. A durable outbox, messaging, completion notification, API gateway integration, Kubernetes deployment and end-to-end verification are also outstanding. Do not run this as a finished production service.

## Inventory operations

All operations require the internal API key. `check` accepts `{pecaId, quantidade}` and optionally `ordemServicoId`; `consume` requires `{pecaId, quantidade, ordemServicoId}`; `receive` requires `{pecaId, quantidade, operationId}`. Quantities must be positive integers and the part must exist before receiving stock. Consumption is atomic per part and retries for the same order and part are idempotent; reusing the key with a different quantity is a conflict. Receipt operation IDs are idempotent per part. Inventory movements are embedded in the stock document, with MongoDB document-size limits.

This is not a reservation or a cross-part transaction: a failure between multiple part consumptions can leave a partial operation requiring reconciliation. The legacy inventory use case is still present for reference and must not be exposed because it uses unsafe read-modify-write. The new operations and unique indexes require integration testing against MongoDB before deployment.
