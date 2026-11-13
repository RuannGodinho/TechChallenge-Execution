import { OrdemServicoHttpGateway } from '../../src/Adapters/gateways/ordem-servico.http.gateway';
import { ExecutionOrderUnavailableError } from '../../src/application/ports/execution-order.port';
const original=global.fetch;
afterEach(()=>{global.fetch=original;});
test('translates only the remote identity and eligibility, without reconstructing an order aggregate',async()=>{
 global.fetch=jest.fn(async()=>new Response(JSON.stringify({id:'order',status:'EM EXECUCAO'})));
 const gateway=new OrdemServicoHttpGateway('http://orders.test','secret');
 await expect(gateway.findById('order')).resolves.toEqual({id:'order',canStart:true});
});
test('rejects malformed remote responses and failed completion signals',async()=>{
 const gateway=new OrdemServicoHttpGateway('http://orders.test','secret');
 global.fetch=jest.fn(async()=>new Response(JSON.stringify({id:'different',status:'FINALIZADA'})));
 await expect(gateway.findById('order')).rejects.toBeInstanceOf(ExecutionOrderUnavailableError);
 global.fetch=jest.fn(async()=>new Response(JSON.stringify({id:'order',status:'EM EXECUCAO'})));
 await expect(gateway.complete('order')).rejects.toBeInstanceOf(ExecutionOrderUnavailableError);
});
