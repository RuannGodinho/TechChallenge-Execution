import { createExecutionRoutes } from '../infrastructure/http/execution-routes';
import express, { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { Db, MongoClient, ObjectId } from 'mongodb';
import { ExecucaoServicoMongoGateway } from '../Adapters/gateways/execucao-servico.mongo.gateway';
import { InventoryOperationsMongoGateway, InventoryConflictError, InventoryUnavailableError } from '../Adapters/gateways/inventory-operations.mongo.gateway';
import { OperarInventarioUseCase } from '../application/usecases/estoque/operar-inventario.usecase';
import { AgendarExecucoesUseCase } from '../application/usecases/execucao-servico/agendar-execucoes.usecase';
import { PecaMongoGateway } from '../Adapters/gateways/peca.mongo.gateway';
import { ServicoMongoGateway } from '../Adapters/gateways/servico.mongo.gateway';
import { PecaPresenter } from '../Adapters/presenters/peca.presenter';
import { ServicoPresenter } from '../Adapters/presenters/servico.presenter';
import { CriarPecaUseCase } from '../application/usecases/peca/criar-peca.usecase';
import { BuscarPecaPorIdUseCase } from '../application/usecases/peca/buscar-peca-por-id.usecase';
import { CriarServicoUseCase } from '../application/usecases/servico/criar-servico.usecase';
import { BuscarServicoPorIdUseCase } from '../application/usecases/servico/buscar-servico-por-id.usecase';

async function servicesCheckPart(parts: PecaMongoGateway, id: string): Promise<boolean> { return !!await parts.findById(id); }

export async function createExecutionApp(db: Db) {
 const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
 if (!INTERNAL_API_KEY) throw new Error('INTERNAL_API_KEY is required');
 const parts = new PecaMongoGateway(db); const services = new ServicoMongoGateway(db);
 await db.collection('Estoque').createIndex({ pecaId: 1 }, { unique: true });
 const inventory = new OperarInventarioUseCase(new InventoryOperationsMongoGateway(db));
 await db.collection('ExecucoesServico').createIndex({ ordemServicoId: 1, servicoId: 1 }, { unique: true });
 const schedule = new AgendarExecucoesUseCase(new ExecucaoServicoMongoGateway(db), services);
 const partPresenter = new PecaPresenter(); const servicePresenter = new ServicoPresenter();
 const app = express(); app.use(express.json({ limit: '128kb' }));
 app.get('/health', (_req, res) => res.json({ status: 'ok' }));
 app.get('/ready', async (_req, res) => { try { await db.command({ ping: 1 }); res.json({ status: 'ok' }); } catch { res.status(503).json({ error: 'database unavailable' }); } });
 app.use('/api', createExecutionRoutes(db));
 app.use('/internal', (req: Request, res: Response, next: NextFunction) => {
  const provided = req.header('x-internal-api-key');
  if (!provided || Buffer.byteLength(provided) !== Buffer.byteLength(INTERNAL_API_KEY) || !timingSafeEqual(Buffer.from(provided), Buffer.from(INTERNAL_API_KEY))) return res.status(401).json({ error: 'unauthorized' });
  return next();
 });
 app.post('/internal/inventory/:operation', async (req, res) => {
  const { pecaId, quantidade, ordemServicoId, operationId } = req.body ?? {};
  const op = req.params.operation;
  const isId = (value: unknown) => typeof value === 'string' && ObjectId.isValid(value);
  if (!['check', 'consume', 'receive'].includes(op as string) || !isId(pecaId) || !Number.isSafeInteger(quantidade) || quantidade <= 0 || (op === 'consume' && !isId(ordemServicoId)) || (op === 'check' && ordemServicoId !== undefined && !isId(ordemServicoId)) || (op === 'receive' && (typeof operationId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(operationId)))) return res.status(400).json({ error: 'invalid inventory request' });
  try {
   if (op === 'check') return await inventory.check(pecaId, quantidade, ordemServicoId) ? res.status(204).end() : res.status(409).json({ error: 'insufficient inventory' });
   if (op === 'receive') {
    if (!await servicesCheckPart(parts, pecaId)) return res.status(404).json({ error: 'part not found' });
    await inventory.receive(operationId, pecaId, quantidade);
   } else await inventory.consume(ordemServicoId, pecaId, quantidade);
   return res.status(204).end();
  } catch (error) {
   if (error instanceof InventoryConflictError || error instanceof InventoryUnavailableError) return res.status(409).json({ error: error.message });
   return res.status(503).json({ error: 'inventory unavailable' });
  }
 });
 app.post('/internal/executions', async (req, res) => {
  const { ordemServicoId, servicoIds } = req.body ?? {};
  if (typeof ordemServicoId !== 'string' || !ObjectId.isValid(ordemServicoId) || !Array.isArray(servicoIds) || !servicoIds.every((id: unknown) => typeof id === 'string' && ObjectId.isValid(id))) return res.status(400).json({ error: 'invalid order or service ids' });
  try { await schedule.execute(ordemServicoId, servicoIds); return res.status(204).end(); }
  catch (error) { if (error instanceof Error && error.message.startsWith('Serviço não encontrado')) return res.status(404).json({ error: error.message }); return res.status(503).json({ error: 'execution scheduling unavailable' }); }
 });
 app.get('/internal/parts/:id', async (req, res) => { try { const item = await new BuscarPecaPorIdUseCase(parts).execute(req.params.id as string); return item ? res.json(partPresenter.present(item)) : res.status(404).json({ error: 'part not found' }); } catch { return res.status(503).json({ error: 'database unavailable' }); } });
 app.get('/internal/services/:id', async (req, res) => { try { const item = await new BuscarServicoPorIdUseCase(services).execute(req.params.id as string); return item ? res.json(servicePresenter.present(item)) : res.status(404).json({ error: 'service not found' }); } catch { return res.status(503).json({ error: 'database unavailable' }); } });
 app.post('/internal/parts', async (req, res) => { try { return res.status(201).json(partPresenter.present(await new CriarPecaUseCase(parts).execute(req.body))); } catch { return res.status(400).json({ error: 'cannot create part' }); } });
 app.post('/internal/services', async (req, res) => { try { return res.status(201).json(servicePresenter.present(await new CriarServicoUseCase(services).execute(req.body))); } catch { return res.status(400).json({ error: 'cannot create service' }); } });
 return app;
}

async function main() {
 const { MONGODB_URI, INTERNAL_API_KEY } = process.env;
 if (!MONGODB_URI || !INTERNAL_API_KEY) throw new Error('MONGODB_URI and INTERNAL_API_KEY are required');
 const client = new MongoClient(MONGODB_URI); await client.connect();
 const app = await createExecutionApp(client.db());
 const server = app.listen(Number(process.env.PORT ?? 3001), () => console.log('Execution catalog listening'));
 const stop = () => server.close(() => { void client.close().then(() => process.exit(0)); });
 process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
