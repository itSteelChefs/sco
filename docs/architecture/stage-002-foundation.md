# Stage 002 Foundation Core

The foundation serves `sco.sa` only. It provides a Nest/Fastify API, a Partner Portal, and an Internal Operations shell over PostgreSQL. The approved security boundary is `User ↔ CompanyMembership ↔ Company`, server-side membership validation, transaction-local actor/tenant settings, and PostgreSQL RLS.

RBAC permissions are assigned through membership roles and role permissions. A role name alone never grants access. Internal routes and partner routes have separate controllers and permission codes.

Audit events have nullable actor and company identifiers. `TENANT` requires a company; `SYSTEM`, `SCO_INTERNAL`, and `PRE_TENANT` events may be pre-tenant. Metadata is filtered for credentials, tokens, passwords, cookies, and secrets. Documents use private storage keys and a provider-neutral interface; the development adapter stores under ignored `storage-development` and never publishes a URL.

The stage intentionally contains no procurement, products, supplier quotes, negotiations, aggregation, buying power, customer selling prices, BOQ, AI extraction, ERP, Digital HQ, video, or production deployment. D-05 remains a future workflow rule: selling prices require management approval, with creator/approver separation by default and the constrained Owner/Super Admin exception.
