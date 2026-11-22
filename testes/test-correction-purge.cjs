const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireTest = createRequire(path.join(process.env.ARENA_TEST_NODE_MODULES, "package.json"));
const { initializeTestEnvironment, assertFails, assertSucceeds } = requireTest("@firebase/rules-unit-testing");
const { doc, deleteDoc, setDoc } = requireTest("firebase/firestore");
const ownerUid = "mwYVHBGiEJSYfKimTiBUMzcWHhn1";

async function main() {
  const env = await initializeTestEnvironment({
    projectId: "demo-arena-correction-purge",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  try {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, "cleanupAudit", "match-one"), { state: "lixeira" });
      await setDoc(doc(db, "corrections", "correction-one"), { matchId: "match-one" });
      await setDoc(doc(db, "cleanupAudit", "match-two"), { state: "purgando" });
      await setDoc(doc(db, "corrections", "correction-two"), { matchId: "match-two" });
    });
    const owner = env.authenticatedContext(ownerUid).firestore();
    const outsider = env.authenticatedContext("not-owner").firestore();
    await assertFails(deleteDoc(doc(owner, "corrections", "correction-one")));
    await assertFails(deleteDoc(doc(outsider, "corrections", "correction-two")));
    await assertSucceeds(deleteDoc(doc(owner, "corrections", "correction-two")));
    console.log("PASS: correction markers are only deletable by the owner during an expired purge");
  } finally { await env.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
