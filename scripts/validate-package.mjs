import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8")
);
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8")
);

const failures = [];
const requiredFiles = new Set(["manifest.json"]);

for (const script of manifest.content_scripts ?? []) {
  for (const file of script.js ?? []) requiredFiles.add(file);
  for (const file of script.css ?? []) requiredFiles.add(file);
}

for (const file of Object.values(manifest.icons ?? {})) {
  requiredFiles.add(file);
}

for (const file of requiredFiles) {
  try {
    await access(path.join(root, file));
  } catch {
    failures.push(`Missing manifest dependency: ${file}`);
  }
}

if (manifest.manifest_version !== 3) {
  failures.push("manifest_version must be 3");
}

if (manifest.version !== packageJson.version) {
  failures.push("manifest.json and package.json versions must match");
}

if ((manifest.description ?? "").length > 132) {
  failures.push("manifest description exceeds Chrome's 132-character limit");
}

const expectedMatch =
  "https://chatgpt.com/codex/cloud/settings/analytics*";
const matches = (manifest.content_scripts ?? []).flatMap(
  (script) => script.matches ?? []
);
if (matches.length !== 1 || matches[0] !== expectedMatch) {
  failures.push(`content script must be limited to ${expectedMatch}`);
}

const permissions = manifest.permissions ?? [];
if (permissions.length !== 1 || permissions[0] !== "storage") {
  failures.push("the only extension permission should be storage");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${manifest.name} v${manifest.version}: ${requiredFiles.size} runtime files`
  );
}
