import { ExecutionLifecycleConflict } from '../../enterprise/entities/execution-completion-event';
import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { apiAuth } from './api-auth';
import type { createExecutionControllers } from '../composition-root/execution-container';
import { InventoryRuleError } from '../../enterprise/entities/inventory-error';
import { ExecutionOrderUnavailableError } from '../../application/ports/execution-order.port';

export function createExecutionRoutes({ peca, servico, stock, execucao }: ReturnType<typeof createExecutionControllers>) {
    const router = Router();
    router.use(apiAuth);
    const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
    router.param('id', (req, res, next, id) => ObjectId.isValid(id) ? next() : res.status(400).json({ error: 'ID inválido' }));
    router.param('pecaId', (req, res, next, id) => ObjectId.isValid(id) ? next() : res.status(400).json({ error: 'ID inválido' }));
    router.param('ordemServicoId', (req, res, next, id) => ObjectId.isValid(id) ? next() : res.status(400).json({ error: 'ID inválido' }));
    router.get('/pecas', handle(async (_req, res) => res.json(await peca.getAllPecas())));
    router.get('/pecas/:id', handle(async (req, res) => { const item = await peca.getPecaById(String(req.params.id)); return item ? res.json(item) : res.status(404).json({ error: 'Peca não encontrada' }); }));
    router.post('/pecas', handle(async (req, res) => res.status(201).json(await peca.createPeca(req.body))));
    router.put('/pecas/:id', handle(async (req, res) => { if (!req.body || !Object.keys(req.body).length) return res.status(400).json({ error: 'Informe os campos de atualização' }); const item = await peca.updatePeca(String(req.params.id), req.body); return item ? res.json(item) : res.status(404).json({ error: 'Peca não encontrada' }); }));
    router.delete('/pecas/:id', handle(async (req, res) => await peca.deletePeca(String(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Peca não encontrada' })));
    router.get('/servicos', handle(async (_req, res) => res.json(await servico.getAllServicos())));
    router.get('/servicos/:id', handle(async (req, res) => { const item = await servico.getServicoById(String(req.params.id)); return item ? res.json(item) : res.status(404).json({ error: 'Servico não encontrada' }); }));
    router.post('/servicos', handle(async (req, res) => res.status(201).json(await servico.createServico(req.body))));
    router.put('/servicos/:id', handle(async (req, res) => { if (!req.body || !Object.keys(req.body).length) return res.status(400).json({ error: 'Informe os campos de atualização' }); const item = await servico.updateServico(String(req.params.id), req.body); return item ? res.json(item) : res.status(404).json({ error: 'Servico não encontrada' }); }));
    router.delete('/servicos/:id', handle(async (req, res) => await servico.deleteServico(String(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Servico não encontrada' })));
    router.get('/estoque', handle(async (_req, res) => res.json(await stock.getAllEstoque())));
    router.get('/estoque/movimentacoes', handle(async (_req, res) => res.json(await stock.listaMovimentacoes())));
    router.get('/estoque/:pecaId', handle(async (req, res) => { const item = await stock.getEstoqueByPecaId(String(req.params.pecaId)); return item ? res.json(item) : res.status(404).json({ error: 'Estoque não encontrado' }); }));
    router.post('/estoque/movimentacoes', handle(async (req, res) => res.status(201).json(await stock.createMovimentacao(req.body, req.header('idempotency-key')))));
    router.get('/execucoes-servico/:ordemServicoId', handle(async (req, res) => { const items = await execucao.getExecucoesByOrdemServicoId(String(req.params.ordemServicoId)); return items.length ? res.json(items) : res.status(404).json({ error: 'Execução não encontrada' }); }));
    router.patch('/execucoes-servico/:id/iniciar', handle(async (req, res) => res.json(await execucao.iniciarExecucao(String(req.params.id)))));
    router.patch('/execucoes-servico/:id/finalizar', handle(async (req, res) => res.json(await execucao.finalizarExecucao(String(req.params.id)))));
    router.get('/metricas/tempo-medio-servicos', handle(async (_req, res) => res.json(await execucao.getTempoMedioServicos())));
    router.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
        console.error(error);
        const status = (error instanceof ExecutionLifecycleConflict ? 409 : error instanceof InventoryRuleError ? ({ invalid: 400, not_found: 404, conflict: 409 }[error.kind]) : error instanceof ExecutionOrderUnavailableError ? 502 : undefined) ?? error.status ?? (error.name === 'MongoServerError' ? 503 : /não encontrad/.test(error.message) ? 404 : 400);
        res.status(status).json({ error: error.message });
    });
    return router;
}
