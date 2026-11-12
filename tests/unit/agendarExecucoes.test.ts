import { AgendarExecucoesUseCase } from '../../src/application/usecases/execucao-servico/agendar-execucoes.usecase';
import { IExecucaoServicoGateway } from '../../src/application/ports/execucao-servico.gateway.port';
import { IServicoGateway } from '../../src/application/ports/servico.gateway.port';

test('schedules each distinct service once without querying another service database', async () => {
 const saveMany = jest.fn().mockResolvedValue(undefined);
 const findById = jest.fn().mockResolvedValue({ id: 'service' });
 const useCase = new AgendarExecucoesUseCase({ saveMany } as unknown as IExecucaoServicoGateway, { findById } as unknown as IServicoGateway);
 await useCase.execute('order', ['service', 'service']);
 expect(findById).toHaveBeenCalledTimes(1);
 expect(saveMany.mock.calls[0][0]).toHaveLength(1);
 expect(saveMany.mock.calls[0][0][0].status.value).toBe('PENDENTE');
});
test('does not schedule if any catalog service is absent', async () => {
 const saveMany = jest.fn(); const findById = jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(null);
 const useCase = new AgendarExecucoesUseCase({ saveMany } as unknown as IExecucaoServicoGateway, { findById } as unknown as IServicoGateway);
 await expect(useCase.execute('order', ['service1', 'service2'])).rejects.toThrow('Serviço não encontrado');
 expect(saveMany).not.toHaveBeenCalled();
});
