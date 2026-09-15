/**
 * Garde du Sud sur tout le corpus (CI, bloquant sur les erreurs). Règles : scripts/lib/south-lint-pack.ts.
 */
import { hasBlocking } from "@parlo/south-lint";
import { listPacks } from "./lib/load-pack.ts";
import { southLintPack } from "./lib/south-lint-pack.ts";

let blocking = false;
let total = 0;

for (const code of listPacks()) {
  const result = southLintPack(code);
  if (result.status === "not_applicable") {
    console.log(`·  ${code} : pas de feature lexical_variants, garde régionale non applicable.`);
    continue;
  }
  if (result.status === "missing_variants") {
    console.error(`✖  ${code} : feature lexical_variants déclarée mais lexical-variants.json absent ou illisible.`);
    blocking = true;
    continue;
  }
  for (const h of result.hits) {
    const icon = h.severity === "error" ? "✖" : "⚠";
    console[h.severity === "error" ? "error" : "warn"](`${icon}  ${h.file} ${h.path} — « ${h.found} » (Nord) → ${h.suggestions.join(" / ")}`);
  }
  blocking ||= hasBlocking(result.hits);
  total += result.hits.length;
}

if (blocking) {
  console.error("\nFormes du Nord détectées dans le corpus du Sud.");
  process.exit(1);
}
console.log(`✔  south-lint : aucune forme du Nord bloquante (${total} signalement(s)).`);
