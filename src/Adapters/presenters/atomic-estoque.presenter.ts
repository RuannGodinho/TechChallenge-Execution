import { MovementView, StockView } from '../../application/ports/atomic-stock.port';
export const presentStock = (stock: StockView) => ({ pecaId: stock.partId, quantidade: stock.quantity });
export const presentMovement = (movement: MovementView) => ({ id: movement.id, pecaId: movement.partId, tipo: movement.type, quantidade: movement.quantity, data: movement.occurredAt, origem: movement.origin });
