import { ExecutionOrderMessagingGateway } from '../../Adapters/gateways/execution-order.messaging.gateway';
import { Db } from 'mongodb';
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

import { randomUUID } from 'node:crypto';
import { IObservabilityPort } from '../../application/ports/observability.port';
import { logIntegration } from '../logging/integration-logger';
import { AtomicStockMongoGateway } from '../../Adapters/gateways/atomic-stock.mongo.gateway';
import { ConsultarEstoqueUseCase } from '../../application/usecases/estoque/consultar-estoque.usecase';
import { RegistrarMovimentacaoAtomicaUseCase } from '../../application/usecases/estoque/registrar-movimentacao-atomica.usecase';

export function createExecutionControllers(db: Db) {
    const parts = new PecaMongoGateway(db);
    const services = new ServicoMongoGateway(db);
    const peca = new PecaController(new ListarPecasUseCase(parts), new BuscarPecaPorIdUseCase(parts), new CriarPecaUseCase(parts), new AtualizarPecaUseCase(parts), new DeletarPecaUseCase(parts), new PecaPresenter());
    const servico = new ServicoController(new ListarServicosUseCase(services), new BuscarServicoPorIdUseCase(services), new CriarServicoUseCase(services), new AtualizarServicoUseCase(services), new DeletarServicoUseCase(services), new ServicoPresenter());
    const stockGateway = new AtomicStockMongoGateway(db);
    const stock = new AtomicEstoqueController(new ConsultarEstoqueUseCase(stockGateway), new RegistrarMovimentacaoAtomicaUseCase(stockGateway, parts, randomUUID));
    const executions = new ExecucaoServicoMongoGateway(db, process.env.EXECUTION_COMPLETION_TRANSPORT === 'rabbitmq');
    const reader = new OrdemServicoHttpGateway(process.env.SERVICE_ORDERS_URL, process.env.SERVICE_ORDERS_INTERNAL_API_KEY);
    const orders = process.env.EXECUTION_COMPLETION_TRANSPORT === 'rabbitmq' ? new ExecutionOrderMessagingGateway(reader,executions) : reader;
    const observability: IObservabilityPort = {
        emit: event => logIntegration(event.level ?? (event.alert ? 'error' : 'info'), event.msg, { ...event, event: 'business' }),
    };
    const execucao = new ExecucaoServicoController(
        () => new ListarExecucoesPorOrdemUseCase(executions),
        () => new IniciarExecucaoUseCase(executions, orders, observability),
        () => new FinalizarExecucaoUseCase(executions, orders, observability),
        () => new ObterTempoMedioServicosUseCase(executions),
        () => new ExecucaoServicoPresenter(),
    );
    return { peca, servico, stock, execucao };
}
