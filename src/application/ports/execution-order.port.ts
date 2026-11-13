/** Execution-owned view of the remote order; no customer/vehicle aggregate is imported. */
export interface ExecutionOrder { id: string; canStart: boolean; }
export interface ExecutionOrderPort {
    findById(id: string): Promise<ExecutionOrder | null>;
    complete(id: string): Promise<void>;
}
export class ExecutionOrderUnavailableError extends Error {}
