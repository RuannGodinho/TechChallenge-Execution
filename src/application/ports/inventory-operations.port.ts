export interface InventoryOperations {
 check(partId: string, quantity: number, orderId?: string): Promise<boolean>;
 consume(orderId: string, partId: string, quantity: number): Promise<'applied' | 'duplicate'>;
 receive(operationId: string, partId: string, quantity: number): Promise<'applied' | 'duplicate'>;
}
