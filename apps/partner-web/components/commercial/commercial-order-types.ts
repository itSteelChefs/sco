/**
 * Partner-safe commercial order presentation model (Capability E).
 * Maps from Cursor3 partner contracts when available — never invents supplier cost fields.
 */

export type PartnerCommercialOrderStatus =
  | 'COMMERCIAL_PREP'
  | 'ORDER_APPROVED'
  | 'PROCUREMENT_IN_PROGRESS'
  | 'SUPPLY_CONFIRMED'
  | 'READY_FOR_FULFILLMENT'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type PartnerCommercialOrderSummary = {
  orderId: string;
  reference: string;
  createdAt: string;
  status: string;
  currencyCode: string;
  commercialTotal: number;
  itemCount: number;
  readinessLabel?: string | null;
  nextActionLabel?: string | null;
  procurementRequirementId?: string | null;
  procurementRequirementReference?: string | null;
};

export type PartnerCommercialOrderLine = {
  lineNumber: number;
  specification: string;
  quantity: number;
  unitSalePrice: number;
  lineTotal: number;
  currencyCode?: string;
};

export type PartnerCommercialOrderDetail = PartnerCommercialOrderSummary & {
  paymentTerms?: string | null;
  deliveryReadiness?: string | null;
  supplierAliasLabel?: string | null;
  lines: PartnerCommercialOrderLine[];
  acknowledgementRequired?: boolean;
  acknowledgementActionAvailable?: boolean;
};

/** Keys that must never appear in Partner commercial UI. */
export const FORBIDDEN_COMMERCIAL_KEYS = [
  'purchaseCost',
  'unitPurchaseCost',
  'purchase_cost',
  'margin',
  'markup',
  'supplierCanonicalName',
  'supplierCompanyId',
  'supplierLegalName',
  'supplierContact',
  'supplierEmail',
  'supplierPhone',
  'supplierPo',
  'supplierPO',
  'supplierPurchaseOrder',
] as const;
