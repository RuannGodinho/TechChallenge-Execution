export interface CompletionSnapshot { id: string; status: string; finishedAt?: Date; }
export interface ExecutionCompletionEvent {
    messageId: string; eventType: 'execution.completed'; eventVersion: 1;
    orderId: string; occurredAt: string; data: { orderId: string; executionIds: string[] };
}
export function executionCompletionEvent(orderId: string, executions: CompletionSnapshot[], messageId: string): ExecutionCompletionEvent | null {
    if (!executions.length || executions.some(item => item.status !== 'FINALIZADO')) return null;
    if (executions.some(item => !item.finishedAt || !Number.isFinite(item.finishedAt.getTime()))) throw new Error('Finished execution has no completion timestamp');
    const occurredAt = new Date(Math.max(...executions.map(item => item.finishedAt!.getTime()))).toISOString();
    return { messageId,eventType:'execution.completed',eventVersion:1,orderId,occurredAt,data:{orderId,executionIds:executions.map(item=>item.id).sort()} };
}
export class ExecutionLifecycleConflict extends Error {}
