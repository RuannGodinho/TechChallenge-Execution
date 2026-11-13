import { IOrdemServicoGateway } from '../../application/ports/ordem-servico.gateway.port';
import { OrdemServico } from '../../enterprise/entities/ordem-servico.entity';

export class OrdemServicoHttpGateway implements IOrdemServicoGateway {
    constructor(private readonly baseUrl = process.env.SERVICE_ORDERS_URL, private readonly key = process.env.SERVICE_ORDERS_INTERNAL_API_KEY) {}
    private async request(id: string, method = 'GET') {
        if (!this.baseUrl || !this.key) throw Object.assign(new Error('Service Orders não configurado'), { status: 502 });
        try {
            const path = `/internal/ordensServico/${encodeURIComponent(id)}${method === 'PATCH' ? '/finalizar' : ''}`;
            const response = await fetch(new URL(path, this.baseUrl), { method, headers: { 'x-internal-api-key': this.key }, signal: AbortSignal.timeout(5000) });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`Service Orders retornou ${response.status}`);
            const row = await response.json() as any;
            return OrdemServico.restore({ ...row, dataAbertura: new Date(row.dataAbertura), statusEnteredAt: row.statusEnteredAt ? new Date(row.statusEnteredAt) : new Date(row.dataAbertura), pecas: row.pecas ?? [], servicos: row.servicos ?? [], statusHistory: row.statusHistory?.map((item: any) => ({ ...item, enteredAt: new Date(item.enteredAt) })) });
        } catch (error) { throw Object.assign(error instanceof Error ? error : new Error('Service Orders indisponível'), { status: 502 }); }
    }
    findById(id: string) { return this.request(id); }
    async update(id: string, order: Partial<OrdemServico>) {
        if (order.status?.value !== 'FINALIZADA') throw new Error('Somente a finalização remota é permitida');
        const result = await this.request(id, 'PATCH');
        if (!result) throw Object.assign(new Error('Ordem não encontrada'), { status: 502 });
        return result;
    }
    async findAll(): Promise<OrdemServico[]> { throw new Error('Operação não suportada'); }
    async findByCpfCnpj(_cpf: string): Promise<OrdemServico[]> { throw new Error('Operação não suportada'); }
    async save(_order: OrdemServico): Promise<OrdemServico> { throw new Error('Operação não suportada'); }
}
