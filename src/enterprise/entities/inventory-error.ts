export class InventoryRuleError extends Error {
    constructor(readonly kind: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); }
}
