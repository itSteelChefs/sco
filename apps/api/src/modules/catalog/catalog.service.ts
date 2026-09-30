import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class CatalogService {
  constructor(@Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService, @Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService, @Inject(AuditService) private readonly audit: AuditService) {}

  async createCategory(actor: string, code: string, name: string, parentId?: string) {
    const row = await this.internal.catalogCategoryCreate(actor, code, name, parentId);
    await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.category_created', entityType: 'ProductCategory', entityId: row.id });
    return row;
  }

  async createAttribute(actor: string, categoryId: string, input: { key: string; displayName: string; dataType: string; required?: boolean; unitApplicability?: unknown; validationMetadata?: unknown }) {
    const row = await this.internal.catalogAttributeCreate(actor, categoryId, input);
    await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.attribute_created', entityType: 'CategoryAttributeDefinition', entityId: row.id });
    return row;
  }

  async createProduct(actor: string, input: { categoryId: string; brand?: string; manufacturer?: string; modelReference?: string; publicSpecification?: unknown; unitId?: string; warrantyType?: string; warrantyPeriodMonths?: number; warrantyProvider?: string }) {
    const row = await this.internal.catalogProductCreate(actor, input);
    await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.product_created', entityType: 'ProductIdentity', entityId: row.id });
    return row;
  }

  async activateProduct(actor: string, id: string) {
    const row = await this.internal.catalogProductActivate(actor, id);
    if (!row) throw new NotFoundException();
    await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.product_activated', entityType: 'ProductIdentity', entityId: id });
    return row;
  }

  async listProducts() {
    const result = await this.database.query(`SELECT p.id, p.brand, p.manufacturer, p.model_reference AS "modelReference", p.public_specification AS "publicSpecification", p.status, p.version, c.code AS "categoryCode", c.name AS "categoryName" FROM product_identities p JOIN product_categories c ON c.id=p.category_id WHERE p.status='ACTIVE' ORDER BY p.created_at DESC`);
    return result.rows;
  }
}
