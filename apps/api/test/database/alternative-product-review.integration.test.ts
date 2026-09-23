import { describe, expect, it, vi } from 'vitest';
import { AlternativeProductService } from '../../src/modules/identity/alternative-product.service.js';

function service(status='PENDING_REVIEW', permitted=true) {
  const row:any={status}; const client:any={query:vi.fn()};
  const internal:any={reviewAlternativeProduct:vi.fn(async(_:string,id:string,decision:string)=>{if(!permitted) throw new Error('ALTERNATIVE_REVIEW_FORBIDDEN');if(row.status!=='PENDING_REVIEW')throw new Error('ALTERNATIVE_PROPOSAL_ALREADY_REVIEWED');row.status=decision;return {id,status:decision,reviewed_at:new Date()};})};
  return {sut:new AlternativeProductService(internal),client,internal,row};
}
describe('AlternativeProduct review behavioral contract',()=>{
  it.each(['APPROVED','REJECTED','CLARIFICATION_REQUIRED'] as const)('%s persists a decision with reason',async decision=>{const x=service(); await x.sut.review('actor','p1',decision,'review reason','corr-1'); expect(x.internal.reviewAlternativeProduct).toHaveBeenCalledWith('actor','p1',decision,'review reason','corr-1');});
  it('denies unauthorized reviewer and preserves pending state',async()=>{const x=service('PENDING_REVIEW',false); await expect(x.sut.review('actor','p1','APPROVED','reason')).rejects.toThrow('ALTERNATIVE_REVIEW_FORBIDDEN'); expect(x.row.status).toBe('PENDING_REVIEW');});
  it('requires a non-empty reason',async()=>{const x=service(); await expect(x.sut.review('actor','p1','APPROVED','  ')).rejects.toThrow('REVIEW_REASON_REQUIRED');});
  it('rejects terminal re-review',async()=>{const x=service('APPROVED'); await expect(x.sut.review('actor','p1','REJECTED','reason')).rejects.toThrow('ALTERNATIVE_PROPOSAL_ALREADY_REVIEWED');});
  it('passes only typed review and audit context to the internal gateway',async()=>{const x=service(); await x.sut.review('actor','p1','APPROVED','reason','corr-2'); expect(x.internal.reviewAlternativeProduct).toHaveBeenCalledWith('actor','p1','APPROVED','reason','corr-2'); expect(JSON.stringify(x.internal.reviewAlternativeProduct.mock.calls)).not.toMatch(/password|token|secret/i);});
});
