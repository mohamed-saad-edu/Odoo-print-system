import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { SourceTextModule, SyntheticModule } from "node:vm";

/** Real, pure printing contracts; only the caller's SQL representation is substituted. */
export async function printingContractModules(context, sql) {
  // Node vm contexts do not inherit TextEncoder from their creator. The real
  // production exact-printer-id contract uses the UTF-8 byte boundary.
  context.TextEncoder ??= TextEncoder;
  const names = ["exact-printer-id", "database-timestamp", "database-error-log", "job-status", "print-output", "printer-operational-verification", "printer-verification-sql"];
  const modules = new Map(names.map((name) => {
    const path = `src/lib/${name}.ts`;
    return [name, new SourceTextModule(stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "transform" }), { context, identifier: path })];
  }));
  const contractPath = "contracts/printer-operational-verification-contract.json";
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const json = new SyntheticModule(["default"], function () { this.setExport("default", contract); }, { context, identifier: contractPath });
  const drizzle = new SyntheticModule(["sql"], function () { this.setExport("sql", sql); }, { context, identifier: "drizzle-orm" });
  const link = (specifier, importer) => {
    if (specifier === "drizzle-orm" && importer.identifier === "src/lib/printer-verification-sql.ts") return drizzle;
    if (specifier === "../../contracts/printer-operational-verification-contract.json"
      && importer.identifier === "src/lib/printer-operational-verification.ts") return json;
    if (specifier.startsWith("./") && modules.has(specifier.slice(2))) return modules.get(specifier.slice(2));
    throw new Error(`Unexpected printing contract import ${specifier} from ${importer.identifier}`);
  };
  for (const name of ["exact-printer-id", "printer-verification-sql", "print-output", "database-error-log"]) {
    await modules.get(name).link(link);
    await modules.get(name).evaluate();
  }
  return modules;
}
