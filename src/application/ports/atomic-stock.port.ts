import { MovimentacaoEstoque } from '../../enterprise/entities/movimentacao-estoque.entity';
export interface StockView { partId: string; quantity: number; }
export interface MovementView { id: string; partId: string; type: string; quantity: number; occurredAt: Date; origin: string; }
export interface AtomicStockPort {
    findAll(): Promise<StockView[]>;
    findByPartId(partId: string): Promise<StockView | null>;
    listMovements(): Promise<MovementView[]>;
    applyMovement(movement: MovimentacaoEstoque, operationId: string): Promise<MovementView>;
}
