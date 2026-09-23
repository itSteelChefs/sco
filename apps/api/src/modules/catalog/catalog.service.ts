import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class CatalogService {
  constructor(@Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService, @Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService, @Inject(AuditService) private readonly audit: AuditService) {}

  async createCategory(actor: string, code: string, name: string, parentId?: string) {
    return this.internal.withScope(actor, async (client) => {
      const result = await client.query(`INSERT INTO product_categories (code, name, parent_id) VALUES ($1,$2,$3) RETURNING id, code, name, parent_id AS "parentId", active`, [code, name, parentId ?? null]);
      await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.category_created', entityType: 'ProductCategory', entityId: result.rows[0].id });
      return result.rows[0];
    });
  }

  async createAttribute(actor: string, categoryId: string, input: { key: string; displayName: string; dataType: string; required?: boolean; unitApplicability?: unknown; validationMetadata?: unknown }) {
    return this.internal.withScope(actor, async (client) => {
      const result = await client.query(`INSERT INTO category_attribute_definitions (category_id,key,display_name,data_type,required,unit_applicability,validation_metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id, category_id AS "categoryId", key, display_name AS "displayName", data_type AS "dataType", required`, [categoryId, input.key, input.displayName, input.dataType, input.required ?? false, JSON.stringify(input.unitApplicability ?? null), JSON.stringify(input.validationMetadata ?? null)]);
      await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.attribute_created', entityType: 'CategoryAttributeDefinition', entityId: result.rows[0].id });
      return result.rows[0];
    });
  }

  async createProduct(actor: string, input: { categoryId: string; brand?: string; manufacturer?: string; modelReference?: string; publicSpecification?: unknown; unitId?: string; warrantyType?: string; warrantyPeriodMonths?: number; warrantyProvider?: string }) {
    return this.internal.withScope(actor, async (client) => {
      const result = await client.query(`INSERT INTO product_identities (category_id,brand,manufacturer,model_reference,public_specification,unit_id,warranty_type,warranty_period_months,warranty_provider,created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING id, category_id AS "categoryId", brand, manufacturer, model_reference AS "modelReference", public_specification AS "publicSpecification", unit_id AS "unitId", warranty_type AS "warrantyType", warranty_period_months AS "warrantyPeriodMonths", warranty_provider AS "warrantyProvider", status, version`, [input.categoryId, input.brand ?? null, input.manufacturer ?? null, input.modelReference ?? null, JSON.stringify(input.publicSpecification ?? null), input.unitId ?? null, input.warrantyType ?? null, input.warrantyPeriodMonths ?? null, input.warrantyProvider ?? null, actor]);
      await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.product_created', entityType: 'ProductIdentity', entityId: result.rows[0].id });
      return result.rows[0];
    });
  }

  async activateProduct(actor: string, id: string) {
    return this.internal.withScope(actor, async (client) => {
      const result = await client.query(`UPDATE product_identities SET status='ACTIVE', activated_by=$2, activated_at=now(), updated_at=now() WHERE id=$1 AND status='DRAFT' RETURNING id, status, version`, [id, actor]);
      if (!result.rowCount) throw new NotFoundException();
      await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.product_activated', entityType: 'ProductIdentity', entityId: id });
      return result.rows[0];
    });
  }

  async listProducts() {
    const result = await this.database.query(`SELECT p.id, p.brand, p.manufacturer, p.model_reference AS "modelReference", p.public_specification AS "publicSpecification", p.status, p.version, c.code AS "categoryCode", c.name AS "categoryName" FROM product_identities p JOIN product_categories c ON c.id=p.category_id WHERE p.status='ACTIVE' ORDER BY p.created_at DESC`);
    return result.rows;
  }
}
