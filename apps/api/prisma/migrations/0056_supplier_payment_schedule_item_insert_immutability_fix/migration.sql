CREATE OR REPLACE FUNCTION public.prevent_supplier_payment_schedule_item_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF EXISTS (SELECT 1 FROM supplier_payment_schedule_revisions r WHERE r.id=NEW.schedule_revision_id AND r.status IN ('APPROVED','SUPERSEDED')) THEN
     RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_IMMUTABLE';
   END IF;
   RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM supplier_payment_schedule_revisions r WHERE r.id=OLD.schedule_revision_id AND r.status IN ('APPROVED','SUPERSEDED')) THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_SCHEDULE_IMMUTABLE'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
