import { sql, type SQL } from "drizzle-orm";
import { PRINTER_VERIFICATION_MAX_AGE_SECONDS, PRINTER_VERIFICATION_MAX_FUTURE_SKEW_SECONDS } from "./printer-operational-verification";

/** Alias is a code-owned SQL identifier, never request input. Same freshness as the TS gate. */
export function printerOperationalVerificationPredicate(alias: SQL): SQL {
  return sql`${alias}.verification_state = 'verified'
    AND ${alias}.verification_binding_digest IS NOT NULL
    AND ${alias}.logical_queue_key = ${alias}.verification_binding_digest
    AND ${alias}.verification_verified_at >= clock_timestamp() - make_interval(secs => ${PRINTER_VERIFICATION_MAX_AGE_SECONDS})
    AND ${alias}.verification_verified_at <= clock_timestamp() + make_interval(secs => ${PRINTER_VERIFICATION_MAX_FUTURE_SKEW_SECONDS})
    AND ${alias}.verification_received_at >= clock_timestamp() - make_interval(secs => ${PRINTER_VERIFICATION_MAX_AGE_SECONDS})
    AND ${alias}.verification_received_at <= clock_timestamp()
    AND (${alias}.management_source = 'agent' OR (${alias}.applied_desired_revision >= ${alias}.desired_revision AND ${alias}.observed_desired_revision >= ${alias}.desired_revision))`;
}
