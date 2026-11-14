import { executionCompletionEvent } from '../../src/enterprise/entities/execution-completion-event';
import { completionMessageId } from '../../src/infrastructure/messaging/execution-event';
test('emits only for a non-empty fully completed order with stable event identity',()=>{
 const order='0123456789abcdef01234567';const messageId=completionMessageId(order);const now=new Date();
 expect(executionCompletionEvent(order,[],messageId)).toBeNull();
 expect(executionCompletionEvent(order,[{id:'1',status:'PENDENTE'}],messageId)).toBeNull();
 const event=executionCompletionEvent(order,[{id:'b',status:'FINALIZADO',finishedAt:now},{id:'a',status:'FINALIZADO',finishedAt:new Date(now.getTime()-1)}],messageId);
 expect(event?.data.executionIds).toEqual(['a','b']);expect(event?.occurredAt).toBe(now.toISOString());expect(event?.messageId).toBe(messageId);
});
