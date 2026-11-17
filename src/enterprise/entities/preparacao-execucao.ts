export class FalhaPreparacao extends Error {
}
export class PreparacaoExecucao {
    static validarReserva(items: Array<{
        id: string;
        quantidade: number;
    }>) { const ids = new Set<string>(); for (const p of items) {
        if (!/^[a-f0-9]{24}$/i.test(p.id) || !Number.isSafeInteger(p.quantidade) || p.quantidade <= 0 || ids.has(p.id))
            throw new FalhaPreparacao('Reserva inválida');
        ids.add(p.id);
    } }
    static permitir(state: string, command: string) { if (state === 'CANCELADA' && !['execution.CancelarPreparacao', 'execution.LiberarEstoque'].includes(command))
        throw new FalhaPreparacao('Tentativa cancelada'); }
}
