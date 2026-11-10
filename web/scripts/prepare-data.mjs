import { mkdir, writeFile } from "node:fs/promises";
const dir = new URL("../../data/", import.meta.url);
await mkdir(dir, { recursive: true });
try {
  await writeFile(
    new URL("odds.json", dir),
    JSON.stringify({
      schema_version: 1,
      status: "disconnected",
      rows: [],
      history: [],
      issues: [],
    }),
    { flag: "wx" },
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
