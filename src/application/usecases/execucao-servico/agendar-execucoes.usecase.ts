import { ExecucaoServico } from '../../../enterprise/entities/execucao-servico.entity';
import { IExecucaoServicoGateway } from '../../ports/execucao-servico.gateway.port';
import { IServicoGateway } from '../../ports/servico.gateway.port';

/** Called by the trusted order orchestrator after it has created the order. */
export class AgendarExecucoesUseCase {
 constructor(private readonly executions: IExecucaoServicoGateway, private readonly services: IServicoGateway) {}
 async execute(orderId: string, serviceIds: string[]): Promise<void> {
  const unique = [...new Set(serviceIds)];
  for (const id of unique) {
   if (!await this.services.findById(id)) throw new Error(`Serviço não encontrado para o id ${id}.`);
  }
  await this.executions.saveMany(unique.map(id => ExecucaoServico.create(orderId, id)));
 }
}
