// The single definition of what ships in the deploy artifact.
//
// scripts/build-web.mjs copies exactly these entries into publish-output/node,
// and test/artifact.test.js asserts package.json "files" agrees with them.
// The lists used to live in both files as two literals that had already
// drifted once (deploy/ packaged by the build but missing from "files", so
// `npm publish` and `npm run build` produced different artifacts). One module,
// two importers — a third copy is one too many.
export const ARTIFACT_DIRECTORIES = ['src', 'public', 'scripts', 'supabase', 'cloudflare', 'deploy'];
export const ARTIFACT_FILES = ['package.json', 'package-lock.json', '.env.example', 'README.md', 'render.yaml', 'Dockerfile'];

// Entries that must never ship even when they sit inside an artifact directory.
// `cp -r cloudflare/` copies `.wrangler/tmp` (tool scratch + sourcemap of the
// Worker) and any `.gbuildcache`/`.log` a run left behind. The build prunes
// these after copy and deploy.sh refuses them as defense in depth.
export const ARTIFACT_EXCLUDE_DIRS = ['.wrangler', '.gbuildcache', '.tmp-audit-dead-label', 'node_modules'];
export const ARTIFACT_EXCLUDE_SUFFIXES = ['.log', '.pid', '.tmp'];
