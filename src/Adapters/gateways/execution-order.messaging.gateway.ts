import { ExecutionOrderPort } from '../../application/ports/execution-order.port';
export class ExecutionOrderMessagingGateway implements ExecutionOrderPort {
    constructor(private readonly reader: Pick<ExecutionOrderPort,'findById'>, private readonly outbox: {ensureCompletionEnqueued(orderId:string):Promise<void>}) {}
    findById(id:string) { return this.reader.findById(id); }
    complete(id:string):Promise<void> { return this.outbox.ensureCompletionEnqueued(id); }
}
