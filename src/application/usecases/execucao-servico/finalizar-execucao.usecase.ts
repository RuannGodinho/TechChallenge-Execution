import { ExecucaoServico } from '../../../enterprise/entities/execucao-servico.entity';
import { StatusExecucaoValues } from '../../../enterprise/value-objects/status-execucao.vo';
import { IExecucaoServicoGateway } from '../../ports/execucao-servico.gateway.port';
import { ExecutionOrderPort } from '../../ports/execution-order.port';
import { IObservabilityPort } from '../../ports/observability.port';
import { BusinessEvent } from '../../observability/business-events';

export class FinalizarExecucaoUseCase {
    constructor(
        private readonly execucaoServicoGateway: IExecucaoServicoGateway,
        private readonly ordemServicoGateway: ExecutionOrderPort,
        private readonly observability: IObservabilityPort
    ) {}

    async execute(id: string): Promise<ExecucaoServico> {
        const execucao = await this.execucaoServicoGateway.findById(id);

        if (!execucao) {
            throw new Error(`Execução não encontrada para o id ${id}.`);
        }

        if (execucao.status.value === StatusExecucaoValues.FINALIZADO) {
            await this.finalizarOrdemServicoSeNecessario(execucao.ordemServicoId);
            return execucao;
        }
        execucao.finalizar();

        const atualizado = await this.execucaoServicoGateway.update(id, {
            status: execucao.status,
            finalizadoEm: execucao.finalizadoEm,
        });

        if (!atualizado) {
            throw new Error('Falha ao finalizar a execução.');
        }

        this.observability.emit({
            msg: BusinessEvent.execucaoFinished,
            execucaoId: atualizado.id ?? id,
            ordemServicoId: atualizado.ordemServicoId,
        });

        await this.finalizarOrdemServicoSeNecessario(execucao.ordemServicoId);

        return atualizado;
    }

    private async finalizarOrdemServicoSeNecessario(ordemServicoId: string): Promise<void> {
        const execucoes = await this.execucaoServicoGateway.findByOrdemServicoId(ordemServicoId);
        const todasFinalizadas = execucoes.every(
            (execucao) => execucao.status.value === StatusExecucaoValues.FINALIZADO
        );

        if (todasFinalizadas && execucoes.length > 0) {
            await this.ordemServicoGateway.complete(ordemServicoId);
            this.observability.emit({ msg: BusinessEvent.execucaoCompletionReported, ordemServicoId });
        }
    }
}
