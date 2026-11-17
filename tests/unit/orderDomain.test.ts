import { ObjectId } from 'mongodb';
import { OrdemServico } from '../../src/enterprise/entities/ordem-servico.entity';
import { StatusOS, StatusOSValues } from '../../src/enterprise/value-objects/status-os.vo';
import { Documento } from '../../src/enterprise/value-objects/documento.vo';
import { VeiculoId } from '../../src/enterprise/value-objects/veiculo-id.vo';
import { OrdemPecaItem } from '../../src/enterprise/value-objects/ordem-peca-item.vo';
import { PreparacaoExecucao, FalhaPreparacao } from '../../src/enterprise/entities/preparacao-execucao';

const vehicle = new ObjectId().toString(), part = new ObjectId().toString();
const create = () => OrdemServico.create({ cpfCnpj: '11144477735', veiculoId: vehicle });
afterEach(() => jest.useRealTimers());

test('creates a received order with validated parts and deduplicated services', () => {
    const order = OrdemServico.create({ cpfCnpj: '111.444.777-35', veiculoId: vehicle,
        pecas: [{ pecaId: part, quantidade: 2 }, { pecaId: part, quantidade: 1, valorUnitario: 10 }], servicos: ['service', 'service'] });
    expect(order.status.value).toBe('RECEBIDA');
    expect(order.cpfCnpj.value).toBe('11144477735');
    expect(order.pecas.map(item => item.valorUnitario)).toEqual([0, 10]);
    expect(order.servicos).toEqual(['service']);
    expect(order.statusHistory).toEqual([{ status: 'RECEBIDA', enteredAt: order.dataAbertura }]);
});
test('restores history and item values without replacing the persisted baseline', () => {
    const opened = new Date('2026-01-01'), entered = new Date('2026-01-02');
    const history = [{ status: 'RECEBIDA', enteredAt: opened }, { status: 'EM DIAGNOSTICO', enteredAt: entered }];
    const order = OrdemServico.restore({ id: 'order', cpfCnpj: '11144477735', veiculoId: vehicle,
        status: 'EM DIAGNOSTICO', dataAbertura: opened, statusEnteredAt: entered, statusHistory: history,
        pecas: [{ pecaId: part, quantidade: 2, valorUnitario: 15 }], servicos: ['service', 'service'], valorTotal: 30 });
    expect(order.statusHistory).toEqual(history);
    expect(order.statusEnteredAt).toBe(entered);
    expect(order.valorTotal).toBe(30);
    expect(order.pecas[0].valorUnitario).toBe(15);
});
test('restores a legacy order history from its opening date', () => {
    const opened = new Date('2026-01-01');
    const order = OrdemServico.restore({ cpfCnpj: '11144477735', veiculoId: vehicle, status: 'RECEBIDA',
        dataAbertura: opened, pecas: [], servicos: [] });
    expect(order.statusHistory).toEqual([{ status: 'RECEBIDA', enteredAt: opened }]);
});
test('records permitted transitions with elapsed time and rejects an invalid transition without mutation', () => {
    jest.useFakeTimers().setSystemTime(Date.parse('2026-01-01T00:00:00Z'));
    const order = create(); jest.advanceTimersByTime(5000);
    expect(order.transicionarStatus(StatusOS.from(' em diagnostico '))).toEqual({ from: 'RECEBIDA', to: 'EM DIAGNOSTICO', durationMs: 5000 });
    order.promoverParaAguardandoAprovacao();
    expect(order.statusHistory.map(item => item.status)).toEqual(['RECEBIDA', 'EM DIAGNOSTICO', 'AGUARDANDO APROVACAO']);
    expect(() => order.transicionarStatus(StatusOS.from('ENTREGUE'))).toThrow('Não é permitido');
    expect(order.status.value).toBe('AGUARDANDO APROVACAO');
});
test('applies item totals and validates replacement customer and vehicle identities', () => {
    const order = create(); const replacement = new ObjectId().toString();
    order.aplicarItens([OrdemPecaItem.create(part, 2, 5)], ['service', 'service'], 10);
    order.atualizarCpfCnpj('11.222.333/0001-81'); order.atualizarVeiculo(replacement);
    expect(order.servicos).toEqual(['service']); expect(order.valorTotal).toBe(10);
    expect(order.cpfCnpj.type).toBe('CNPJ'); expect(order.veiculoId.toString()).toBe(replacement);
    expect(() => order.atualizarCpfCnpj('invalid')).toThrow('CPF/CNPJ inválido');
    expect(() => order.atualizarVeiculo('invalid')).toThrow('ID do veículo inválido');
});
test.each(Object.values(StatusOSValues))('classifies visibility, diagnosis and priority for %s', status => {
    const value = StatusOS.from(status);
    expect(value.isEmDiagnostico()).toBe(status === 'EM DIAGNOSTICO');
    expect(value.isVisivelNaListagem()).toBe(!['FINALIZADA', 'ENTREGUE'].includes(status));
    const priority: Record<string, number> = { 'EM EXECUCAO': 1, 'AGUARDANDO APROVACAO': 2, 'EM DIAGNOSTICO': 3, RECEBIDA: 4 };
    expect(value.prioridadeListagem()).toBe(priority[status] ?? Number.MAX_SAFE_INTEGER);
});
test('rejects an unknown status', () => expect(() => StatusOS.from('invalid')).toThrow('Status inválido'));
test.each([
    ['111.444.777-35', '11144477735', 'CPF', '111.444.777-35'],
    ['11.222.333/0001-81', '11222333000181', 'CNPJ', '11.222.333/0001-81'],
])('normalizes and formats document %s', (input, value, type, formatted) => {
    const document = Documento.from(input);
    expect([document.value, document.type, document.formatted]).toEqual([value, type, formatted]);
});
test.each(['', 'invalid'])('rejects invalid documents: %p', input => expect(() => Documento.from(input)).toThrow());
test.each(['', ' ', 'invalid'])('rejects invalid vehicle identities: %p', input => expect(() => VeiculoId.from(input)).toThrow());
test('trims a valid vehicle identity', () => expect(VeiculoId.from(` ${vehicle} `).value).toBe(vehicle));
test.each([0, -1, 1.5])('rejects an invalid part quantity: %s', amount => expect(() => OrdemPecaItem.create(part, amount)).toThrow('Quantidade inválida'));
test('rejects negative part prices', () => expect(() => OrdemPecaItem.create(part, 1, -1)).toThrow('Valor unitário inválido'));
test.each([
    [{ id: 'bad', quantidade: 1 }], [{ id: part, quantidade: 0 }], [{ id: part, quantidade: 1.5 }],
    [{ id: part, quantidade: 1 }, { id: part, quantidade: 1 }],
])('rejects invalid or duplicated reservation items: %p', (...items) => {
    expect(() => PreparacaoExecucao.validarReserva(items)).toThrow(FalhaPreparacao);
});
test('validates reservations and permits only compensation after cancellation', () => {
    expect(() => PreparacaoExecucao.validarReserva([{ id: part, quantidade: 2 }])).not.toThrow();
    expect(() => PreparacaoExecucao.permitir('NOVA', 'execution.ReservarEstoque')).not.toThrow();
    for (const command of ['execution.CancelarPreparacao', 'execution.LiberarEstoque']) {
        expect(() => PreparacaoExecucao.permitir('CANCELADA', command)).not.toThrow();
    }
    expect(() => PreparacaoExecucao.permitir('CANCELADA', 'execution.ReservarEstoque')).toThrow('Tentativa cancelada');
});
