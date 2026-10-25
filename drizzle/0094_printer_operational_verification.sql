-- Operational proof is intentionally NOT backfilled from names, online status,
-- geometry or old approval flags. All existing registrations remain present and
-- pending until an authenticated Agent reports fresh proof for the exact target.
-- Physical-device keys are nonunique: multiple logical queues may share a device.
-- Old jobs/receipts retain their historical physical output class; new file jobs
-- snapshot their class at admission, independently of later printer changes.
ALTER TABLE "printers" DROP CONSTRAINT "printers_type_check";--> statement-breakpoint
ALTER TABLE "printers" DROP CONSTRAINT "printers_connection_type_check";--> statement-breakpoint
ALTER TABLE "printers" DROP CONSTRAINT "printers_protocol_check";--> statement-breakpoint
ALTER TABLE "print_job_receipts" ADD COLUMN "output_medium" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "print_job_receipts" ADD COLUMN "output_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "output_medium" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "output_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "logical_queue_key" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "physical_device_key" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "verification_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "verification_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "verification_received_at" timestamp;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "verification_binding_digest" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "verification_reason" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "output_medium" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "printers_tenant_agent_logical_queue_unique" ON "printers" USING btree ("tenant_id","agent_id","logical_queue_key") WHERE "printers"."logical_queue_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "printers_tenant_agent_physical_device_idx" ON "printers" USING btree ("tenant_id","agent_id","physical_device_key");--> statement-breakpoint
ALTER TABLE "print_job_receipts" ADD CONSTRAINT "print_job_receipts_output_check" CHECK ("print_job_receipts"."output_medium" IN ('physical','file') AND ("print_job_receipts"."output_evidence" IS NULL OR ("print_job_receipts"."output_medium" = 'file' AND "print_job_receipts"."status" = 'success' AND jsonb_typeof("print_job_receipts"."output_evidence") = 'object')));--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_output_check" CHECK ("print_jobs"."output_medium" IN ('physical','file') AND ("print_jobs"."output_evidence" IS NULL OR ("print_jobs"."output_medium" = 'file' AND "print_jobs"."status" = 'success' AND jsonb_typeof("print_jobs"."output_evidence") = 'object')));--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_verification_check" CHECK ("printers"."verification_state" IN ('pending','verified')
    AND ("printers"."logical_queue_key" IS NULL OR "printers"."logical_queue_key" ~ '^[a-f0-9]{64}$')
    AND ("printers"."physical_device_key" IS NULL OR "printers"."physical_device_key" ~ '^[a-f0-9]{64}$')
    AND ("printers"."verification_reason" IS NULL OR "printers"."verification_reason" ~ '^[a-z0-9_]{1,64}$')
    AND ("printers"."verification_state" <> 'verified' OR ("printers"."verification_verified_at" IS NOT NULL AND "printers"."verification_received_at" IS NOT NULL AND "printers"."verification_binding_digest" IS NOT NULL AND "printers"."verification_binding_digest" ~ '^[a-f0-9]{64}$' AND "printers"."logical_queue_key" IS NOT NULL AND "printers"."logical_queue_key" = "printers"."verification_binding_digest")));--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_output_medium_check" CHECK (("printers"."connection_type" = 'pdf_output' AND "printers"."protocol" = 'pdf' AND "printers"."printer_type" = 'file' AND "printers"."output_medium" = 'file') OR ("printers"."connection_type" <> 'pdf_output' AND "printers"."printer_type" = 'physical' AND "printers"."output_medium" = 'physical'));--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_type_check" CHECK (("printers"."printer_type" = 'file' AND "printers"."connection_type" = 'pdf_output' AND "printers"."protocol" = 'pdf' AND COALESCE("printers"."config"->>'output_profile_id', '') ~ '^[A-Za-z0-9_-]{1,64}$') OR ("printers"."printer_type" = 'physical' AND "printers"."connection_type" <> 'pdf_output' 
    AND lower(COALESCE("printers"."name",'')) !~ '(microsoft print to pdf|onenote|xps document writer|pdf24|pdfcreator|virtual printer|print to pdf|remote desktop easy print|redirected)'
    AND lower(COALESCE("printers"."config"->>'spooler_name',"printers"."config"->>'address','')) !~ '(microsoft print to pdf|onenote|xps document writer|pdf24|pdfcreator|virtual printer|print to pdf|remote desktop easy print|redirected)'
    AND lower(COALESCE("printers"."capabilities"->>'driver_name',"printers"."capabilities"->>'driverName','')) !~ '(microsoft print to pdf|onenote|xps document writer|pdf24|pdfcreator|virtual printer|print to pdf|remote desktop easy print|redirected)'
    AND lower(COALESCE("printers"."capabilities"->>'port_name','')) !~ '^(portprompt:|xpsport:|file:|nul:|null:|shrfax:|fax:)'
    AND lower(COALESCE("printers"."capabilities"->>'printer_class','')) NOT IN ('virtual','redirected')
    AND NOT COALESCE("printers"."config" ? 'virtual_test_sink', false)
    AND NOT COALESCE("printers"."config" ? 'virtual_spooler_test', false)
    AND NOT COALESCE("printers"."capabilities" @> '{"virtual":true}'::jsonb, false)
    AND NOT COALESCE("printers"."capabilities" @> '{"is_virtual":true}'::jsonb, false)
    AND NOT COALESCE("printers"."capabilities" @> '{"virtual_test_sink":true}'::jsonb, false)
    AND NOT COALESCE("printers"."capabilities" @> '{"virtual_spooler_test":true}'::jsonb, false)));--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_connection_type_check" CHECK ("printers"."connection_type" in ('network','usb','spooler','ipp','ipps','pdf_output'));--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_protocol_check" CHECK ("printers"."protocol" in ('raw','escpos','zpl','tspl','ipp','ipps','spooler','windows_spooler','unknown','pdf'));
--> statement-breakpoint
-- Null legacy bindings are never fabricated. Fresh jobs snapshot the verified
-- endpoint at admission; legacy terminal operations can still reconcile.
ALTER TABLE "print_jobs" ADD COLUMN "binding_digest" text;
--> statement-breakpoint
ALTER TABLE "print_job_receipts" ADD COLUMN "binding_digest" text;
--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_binding_check" CHECK ("binding_digest" IS NULL OR "binding_digest" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE "print_job_receipts" ADD CONSTRAINT "print_job_receipts_binding_check" CHECK ("binding_digest" IS NULL OR "binding_digest" ~ '^[a-f0-9]{64}$');
