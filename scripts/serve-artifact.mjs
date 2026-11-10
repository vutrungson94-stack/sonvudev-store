// Serves the packaged artifact on a local port, for measuring it.
//
// The point is to measure the bytes that will be deployed, on the machine that
// built them, without a network in between. A Lighthouse run against the live
// site from a CI runner measures the distance between the runner and the
// server as much as it measures the page: the same build scored 100 from this
// machine and failed on a runner on another continent, and the failure said
// nothing about the page.
//
//   node scripts/serve-artifact.mjs [--port 4173]
//
// It serves publish-output/node, which is what deploy/deploy.sh ships. The
// environment is the test fixture (test/helpers/env.mjs) so that nothing here
// can reach a real database, a real bucket or a real payment provider.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// The test fixture, applied the same way the test suite applies it: before
// anything reads the configuration.
await import(pathToFileURL(path.join(root, "test", "helpers", "env.mjs")).href);

const portFlag = process.argv.indexOf("--port");
const port = portFlag !== -1 ? Number(process.argv[portFlag + 1]) : Number(process.env.PORT) || 4173;

const artifact = path.join(root, "publish-output", "node");
const { createApp } = await import(pathToFileURL(path.join(artifact, "src", "app.js")).href);

const app = await createApp();
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`[serve-artifact] ${artifact} on http://127.0.0.1:${port}/`);
});

const stop = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
