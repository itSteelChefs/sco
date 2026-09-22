export class TenantTransactionService {
  async withTenant<T>(_tenantId: string, callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}
