import { ExecutionOrderPort, ExecutionOrderUnavailableError } from '../../application/ports/execution-order.port';

export class OrdemServicoHttpGateway implements ExecutionOrderPort {
    constructor(private readonly baseUrl: string | undefined, private readonly key: string | undefined) {}
    private async request(id: string, method = 'GET') {
        if (!this.baseUrl || !this.key) throw new ExecutionOrderUnavailableError('Service Orders não configurado');
        try {
            const path = `/internal/ordensServico/${encodeURIComponent(id)}${method === 'PATCH' ? '/finalizar' : ''}`;
            const response = await fetch(new URL(path, this.baseUrl), { method, headers: { 'x-internal-api-key': this.key }, signal: AbortSignal.timeout(5000) });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`Service Orders retornou ${response.status}`);
            const row: unknown = await response.json();
            if (!row || typeof row !== 'object' || !('id' in row) || row.id !== id || !('status' in row) || typeof row.status !== 'string') throw new Error('Resposta de ordem inválida');
            return { id, status: row.status, canStart: 'canStart' in row ? row.canStart === true : row.status === 'EM EXECUCAO' };
        } catch (error) { throw new ExecutionOrderUnavailableError(error instanceof Error ? error.message : 'Service Orders indisponível'); }
    }
    async findById(id: string) { const row = await this.request(id); return row ? { id: row.id, canStart: row.canStart } : null; }
    async complete(id: string): Promise<void> {
        const result = await this.request(id, 'PATCH');
        if (!result || !['FINALIZADA','ENTREGUE'].includes(result.status)) throw new ExecutionOrderUnavailableError('Ordem não finalizada pelo Service Orders');
    }
}
