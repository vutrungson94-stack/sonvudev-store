// The single definition of what ships in the deploy artifact.
//
// scripts/build-web.mjs copies exactly these entries into the artifact directory,
// and test/artifact.test.js asserts package.json "files" agrees with them.
// The lists used to live in both files as two literals that had already
// drifted once (deploy/ packaged by the build but missing from "files", so
// `npm publish` and `npm run build` produced different artifacts). One module,
// two importers — a third copy is one too many.
export const ARTIFACT_DIRECTORIES = ['src', 'public', 'scripts', 'supabase', 'cloudflare', 'deploy'];
export const ARTIFACT_FILES = ['package.json', 'package-lock.json', '.env.example', 'README.md', 'render.yaml', 'Dockerfile'];

// Where the artifact is written, in one place.
//
// The path was spelled out in the build, in scripts/check-publish-output.mjs and in
// the build report. Three literals for one directory means a rename has to be
// remembered in three files, and the one that is missed reads an empty directory
// and reports it clean. deploy/deploy.sh still spells it out because shell cannot
// import this module; test/deploy-gate.test.js is what keeps the two in step.
export const ARTIFACT_ROOT = 'publish-output';
export const ARTIFACT_SUBDIR = 'node';
export const ARTIFACT_PATH = `${ARTIFACT_ROOT}/${ARTIFACT_SUBDIR}`;

// Entries that must never ship even when they sit inside an artifact directory.
// `cp -r cloudflare/` copies `.wrangler/tmp` (tool scratch + sourcemap of the
// Worker) and any `.gbuildcache`/`.log` a run left behind. The build prunes
// these after copy and deploy.sh refuses them as defense in depth.
export const ARTIFACT_EXCLUDE_DIRS = ['.wrangler', '.gbuildcache', '.tmp-audit-dead-label', 'node_modules'];
export const ARTIFACT_EXCLUDE_SUFFIXES = ['.log', '.pid', '.tmp'];
