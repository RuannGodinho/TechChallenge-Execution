import { Router, Request, Response, NextFunction } from 'express';
import { Db, ObjectId } from 'mongodb';
import { PecaController } from '../../Adapters/controllers/peca.controller';
import { ServicoController } from '../../Adapters/controllers/servico.controller';
import { ExecucaoServicoController } from '../../Adapters/controllers/execucao-servico.controller';
import { PecaMongoGateway } from '../../Adapters/gateways/peca.mongo.gateway';
import { ServicoMongoGateway } from '../../Adapters/gateways/servico.mongo.gateway';
import { ExecucaoServicoMongoGateway } from '../../Adapters/gateways/execucao-servico.mongo.gateway';
import { PecaPresenter } from '../../Adapters/presenters/peca.presenter';
import { ServicoPresenter } from '../../Adapters/presenters/servico.presenter';
import { ExecucaoServicoPresenter } from '../../Adapters/presenters/execucao-servico.presenter';
import { ListarExecucoesPorOrdemUseCase } from '../../application/usecases/execucao-servico/listar-execucoes-por-ordem.usecase';
import { IniciarExecucaoUseCase } from '../../application/usecases/execucao-servico/iniciar-execucao.usecase';
import { FinalizarExecucaoUseCase } from '../../application/usecases/execucao-servico/finalizar-execucao.usecase';
import { ObterTempoMedioServicosUseCase } from '../../application/usecases/execucao-servico/obter-tempo-medio-servicos.usecase';
import { OrdemServicoHttpGateway } from '../../Adapters/gateways/ordem-servico.http.gateway';
import { AtomicEstoqueController } from '../../Adapters/controllers/atomic-estoque.controller';
import { apiAuth } from './api-auth';
import { ListarPecasUseCase } from '../../application/usecases/peca/listar-pecas.usecase';
import { BuscarPecaPorIdUseCase } from '../../application/usecases/peca/buscar-peca-por-id.usecase';
import { CriarPecaUseCase } from '../../application/usecases/peca/criar-peca.usecase';
import { AtualizarPecaUseCase } from '../../application/usecases/peca/atualizar-peca.usecase';
import { DeletarPecaUseCase } from '../../application/usecases/peca/deletar-peca.usecase';
import { ListarServicosUseCase } from '../../application/usecases/servico/listar-servicos.usecase';
import { BuscarServicoPorIdUseCase } from '../../application/usecases/servico/buscar-servico-por-id.usecase';
import { CriarServicoUseCase } from '../../application/usecases/servico/criar-servico.usecase';
import { AtualizarServicoUseCase } from '../../application/usecases/servico/atualizar-servico.usecase';
import { DeletarServicoUseCase } from '../../application/usecases/servico/deletar-servico.usecase';

export function createExecutionRoutes(db: Db) {
    const router = Router();
    router.use(apiAuth);
    const parts = new PecaMongoGateway(db);
    const services = new ServicoMongoGateway(db);
    const peca = new PecaController(new ListarPecasUseCase(parts), new BuscarPecaPorIdUseCase(parts), new CriarPecaUseCase(parts), new AtualizarPecaUseCase(parts), new DeletarPecaUseCase(parts), new PecaPresenter());
    const servico = new ServicoController(new ListarServicosUseCase(services), new BuscarServicoPorIdUseCase(services), new CriarServicoUseCase(services), new AtualizarServicoUseCase(services), new DeletarServicoUseCase(services), new ServicoPresenter());
    const stock = new AtomicEstoqueController(db);
    const executions = new ExecucaoServicoMongoGateway(db);
    const orders = new OrdemServicoHttpGateway();
    const observability = { emit: (event: unknown) => console.info(event) };
    const execucao = new ExecucaoServicoController(
        () => new ListarExecucoesPorOrdemUseCase(executions),
        () => new IniciarExecucaoUseCase(executions, orders, observability),
        () => new FinalizarExecucaoUseCase(executions, orders, observability),
        () => new ObterTempoMedioServicosUseCase(executions),
        () => new ExecucaoServicoPresenter(),
    );
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
        const status = error.status ?? (error.name === 'MongoServerError' ? 503 : /não encontrad/.test(error.message) ? 404 : 400);
        res.status(status).json({ error: error.message });
    });
    return router;
}
