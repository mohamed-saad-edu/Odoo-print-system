import { describe, expect, it } from "vitest";
import { parseManualPlan } from "../src/lib/manual-plans";
import { formatPlanPrice } from "../src/lib/plan-price";
const base={id:"basic",name:"Basic",description:"",monthlyQuota:1000};
describe("manual price catalog",()=>{
 it("stores exact USD/SAR minor units",()=>{
  expect(parseManualPlan({...base,priceAmount:"19.95",priceCurrency:"USD"})).toMatchObject({priceMinorUnits:1995,priceCurrency:"USD"});
  expect(parseManualPlan({...base,priceAmount:"0",priceCurrency:"SAR"})).toMatchObject({priceMinorUnits:0,priceCurrency:"SAR"});
  expect(parseManualPlan({...base,priceAmount:"10.5",priceCurrency:"SAR"}).priceMinorUnits).toBe(1050);
 });
 it("does not assign a made-up price to old catalog entries",()=>{
  expect(parseManualPlan(base)).toMatchObject({priceMinorUnits:null,priceCurrency:null});
 });
 it.each(["-1","0.001","1e3","NaN","21474836.48"," 20 ","1,000","01",""])("rejects malformed money %s",value=>{
  expect(()=>parseManualPlan({...base,priceAmount:value,priceCurrency:"USD"})).toThrow("PLAN_INVALID");
 });
 it("rejects unsupported currencies and incomplete price pairs",()=>{
  expect(()=>parseManualPlan({...base,priceAmount:"20",priceCurrency:"EGP"})).toThrow("PLAN_INVALID");
  expect(()=>parseManualPlan({...base,priceAmount:"20"})).toThrow("PLAN_INVALID");
  expect(()=>parseManualPlan({...base,priceCurrency:"SAR"})).toThrow("PLAN_INVALID");
 });
 it("formats only configured currency and amount",()=>{
  expect(formatPlanPrice(1995,"USD","en")).toContain("19.95");
  expect(formatPlanPrice(1995,"SAR","ar")).toContain("19.95");
  expect(formatPlanPrice(null,null,"en")).toBeNull();
  expect(formatPlanPrice(-1,"USD","en")).toBeNull();
  expect(formatPlanPrice(0,"USD","en")).toContain("0.00");
 });
});
