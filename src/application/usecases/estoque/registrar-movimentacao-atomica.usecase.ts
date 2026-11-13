import { MovimentacaoEstoque } from '../../../enterprise/entities/movimentacao-estoque.entity';
import { InventoryRuleError } from '../../../enterprise/entities/inventory-error';
import { AtomicStockPort } from '../../ports/atomic-stock.port';
import { IPecaGateway } from '../../ports/peca.gateway.port';
export interface MovementInput { pecaId: string; tipo: string; quantidade: number; origem: string; }
export class RegistrarMovimentacaoAtomicaUseCase {
    constructor(private readonly stock: AtomicStockPort, private readonly parts: Pick<IPecaGateway, 'findById'>, private readonly newOperationId: () => string, private readonly clock = () => new Date()) {}
    async execute(input: MovementInput, operationId = this.newOperationId()) {
        if (!input || typeof input.pecaId !== 'string' || !input.pecaId.trim() || !Number.isSafeInteger(input.quantidade) || input.quantidade <= 0 || typeof input.tipo !== 'string' || typeof input.origem !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(operationId)) throw new InventoryRuleError('invalid', 'Movimentação inválida');
        const movement = MovimentacaoEstoque.create(input.pecaId, input.tipo, input.quantidade, this.clock(), input.origem);
        if (!await this.parts.findById(input.pecaId)) throw new InventoryRuleError('not_found', 'Peça não encontrada');
        return this.stock.applyMovement(movement, operationId);
    }
}
