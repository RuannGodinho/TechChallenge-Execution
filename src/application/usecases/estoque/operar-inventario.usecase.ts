import { InventoryOperations } from '../../ports/inventory-operations.port';
export class OperarInventarioUseCase {
 constructor(private readonly inventory: InventoryOperations) {}
 async check(partId: string, quantity: number, orderId?: string): Promise<boolean> { this.validate(quantity); return this.inventory.check(partId, quantity, orderId); }
 async consume(orderId: string, partId: string, quantity: number) { this.validate(quantity); return this.inventory.consume(orderId, partId, quantity); }
 async receive(operationId: string, partId: string, quantity: number) { this.validate(quantity); return this.inventory.receive(operationId, partId, quantity); }
 private validate(quantity: number) { if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('invalid quantity'); }
}
