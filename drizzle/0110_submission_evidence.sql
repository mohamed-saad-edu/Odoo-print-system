-- 0110: spooler-submission evidence (WP2, STATIC REVIEW ONLY).
-- No new DB status value: 'submitted' vs 'completed' is DERIVED from
-- DB status 'success' plus this evidence (see
-- src/lib/submission-evidence.ts). Old agents send no evidence and
-- therefore always derive 'submitted'; a 'completed' derivation
-- requires query evidence (Windows JOB_STATUS_PRINTED or IPP
-- job-state completed without error reasons) that only a post-
-- submission spooler/IPP query can produce. The Gateway re-derives
-- from the stored fields and never trusts an agent-claimed label.
-- Evidence is a bounded JSON object validated by
-- validateSubmissionEvidence (key allowlist, length/element caps);
-- it is stored only on success transitions and only for physical
-- jobs. File-output jobs keep their own output_evidence contract.
-- The receipts column exists so retention archival does not drop
-- the evidence (retention copies it verbatim).
ALTER TABLE print_jobs ADD COLUMN submission_evidence jsonb;
--> statement-breakpoint
ALTER TABLE print_job_receipts ADD COLUMN submission_evidence jsonb;
