const fs = require("node:fs");
const B = require("./arena-documentos.js");
const rules = fs.readFileSync("firestore.rules", "utf8");
const owner = rules.match(/function\s+owner\s*\([^)]*\)\s*\{[^}]*request\.auth\.uid\s*==\s*['"]([^'"]+)/)?.[1];
if (!owner) throw new Error("UID principal ausente nas regras locais.");
const project = "demo-arena-identidade";
const endpoint = "http://127.0.0.1:8080/v1/projects/" + project + "/databases/(default)/documents/publicBranding/partners";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function emulatorToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  return encode({alg:"none",typ:"JWT"})+"."+encode({
    iss:"https://securetoken.google.com/"+project,aud:project,sub:uid,user_id:uid,
    iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:"custom",identities:{}}
  })+".";
}
function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key,value]) => [key, firestoreValue(value)]));
}
function firestoreValue(value) {
  if (typeof value === "string") return {stringValue:value};
  if (Number.isInteger(value)) return {integerValue:String(value)};
  if (Array.isArray(value)) return {arrayValue:{values:value.map(firestoreValue)}};
  return {mapValue:{fields:fields(value)}};
}
const layouts = Object.fromEntries(Object.keys(B.surfaces).map(key=>[key,B.layout({},key)]));
const base = {groups:{0:[],1:[],2:[]},surfaces:[],schoolLogo:""};
const logo = "data:image/webp;base64,"+"A".repeat(32000);
async function test(label,data,uid,expected) {
  const response = await fetch(endpoint,{
    method:"PATCH",
    headers:{"Content-Type":"application/json",...(uid?{Authorization:"Bearer "+emulatorToken(uid)}:{})},
    body:JSON.stringify({fields:fields(data)}),
    signal:AbortSignal.timeout(12000)
  });
  const result = await response.json();
  const ok = response.status === expected;
  console.log((ok?"OK":"FALHOU")+" | "+label+" | HTTP "+response.status);
  if (!ok && result.error) console.log(result.error.message);
  if (!ok) process.exitCode = 1;
}
(async()=>{
  await test("Dados mínimos",base,owner,200);
  await test("Sete layouts sem imagens",{...base,layouts},owner,200);
  await test("Apenas certificado",{...base,layouts,surfaces:["certificates"]},owner,200);
  await test("Três logos WebP",{...base,layouts,surfaces:["certificates"],groups:{0:[logo],1:[logo],2:[logo]}},owner,200);
  await test("Gravação por outra conta",{...base,layouts},"teste-sem-permissao",403);
  await test("Gravação sem login",{...base,layouts},null,403);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
