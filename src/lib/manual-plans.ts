import { normalizePlanEntitlements } from "./entitlements";
import { parsePlanPriceAmount } from "./plan-price";
import { ManualSubscriptionError } from "./manual-subscriptions";
export function parseManualPlan(input: unknown) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ManualSubscriptionError('PLAN_INVALID');
  const b=input as Record<string,unknown>;
  if(typeof b.id!=='string'||!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>120||typeof b.description!=='string'||b.description.length>500)throw new ManualSubscriptionError('PLAN_INVALID');
  if((b.isActive!==undefined&&typeof b.isActive!=='boolean')||(b.isPublic!==undefined&&typeof b.isPublic!=='boolean'))throw new ManualSubscriptionError('PLAN_INVALID');
  const quota=b.monthlyQuota;
  if(typeof quota!=='number'||!Number.isSafeInteger(quota)||quota<1||quota>2147483647)throw new ManualSubscriptionError('PLAN_INVALID');
  const displayOrder=b.displayOrder===undefined?0:b.displayOrder;
  if(typeof displayOrder!=='number'||!Number.isSafeInteger(displayOrder)||displayOrder<0||displayOrder>1000000)throw new ManualSubscriptionError('PLAN_INVALID');
  // An unpriced plan is "price on request", never silently a free plan.
  // Accept exact decimal strings only; no floats, exponents or silent rounding.
  let priceMinorUnits: number | null = null;
  let priceCurrency: "USD" | "SAR" | null = null;
  const amount=b.priceAmount??null, currency=b.priceCurrency??null;
  if (amount !== null || currency !== null) {
    if (typeof amount !== "string" || (currency !== "USD" && currency !== "SAR")) throw new ManualSubscriptionError("PLAN_INVALID");
    const minorUnits = parsePlanPriceAmount(amount);
    if (minorUnits === null) throw new ManualSubscriptionError("PLAN_INVALID");
    priceMinorUnits = minorUnits;
    priceCurrency=currency;
  }
  return {id:b.id,name:b.name.trim(),description:b.description,priceMinorUnits,priceCurrency,displayOrder,isActive:b.isActive!==false,isPublic:b.isPublic!==false,entitlements:normalizePlanEntitlements({max_agents:'unlimited',max_printers:'unlimited',max_prints_per_period:quota,max_jobs_per_minute:120,max_concurrent_jobs:100})};
}
