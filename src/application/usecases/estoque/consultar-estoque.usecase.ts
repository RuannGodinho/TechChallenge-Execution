import { AtomicStockPort } from '../../ports/atomic-stock.port';
export class ConsultarEstoqueUseCase {
    constructor(private readonly stock: AtomicStockPort) {}
    list() { return this.stock.findAll(); }
    find(partId: string) { return this.stock.findByPartId(partId); }
    history() { return this.stock.listMovements(); }
}
