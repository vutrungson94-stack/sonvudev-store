// The single definition of what ships in the deploy artifact.
//
// scripts/build-web.mjs copies exactly these entries into publish-output/node,
// and test/artifact.test.js asserts package.json "files" agrees with them.
// The lists used to live in both files as two literals that had already
// drifted once (deploy/ packaged by the build but missing from "files", so
// `npm publish` and `npm run build` produced different artifacts). One module,
// two importers — a third copy is one too many.
export const ARTIFACT_DIRECTORIES = ['src', 'public', 'scripts', 'supabase', 'cloudflare', 'deploy'];
export const ARTIFACT_FILES = ['package.json', 'package-lock.json', '.env.example', 'README.md', 'render.yaml'];
