// The commit that produced these bytes — one implementation, two consumers.
//
// scripts/build-web.mjs stamps it into the packaged HTML for CSS cache-busting,
// and src/pages.js stamps the same value into the server-rendered pages, so a
// page served by the build and the same page rendered live name the same
// stylesheet version. Both used to carry a byte-identical copy of this call,
// which meant a change to how the version is derived had to be made twice or the
// build and the live page would disagree about which CSS a visitor should fetch.
//
// Kept free of application imports on purpose: it reaches for git and nothing
// else, so neither the build nor the render path has to pull in configuration to
// ask a question about the repository.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The project root, derived from this file's own location (src/lib -> project).
// A caller may pass its own when it already has one (the build does), but the
// default is here so a consumer does not have to re-derive the same expression.
const selfRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The short SHA of HEAD, or "" when git is unavailable (no repo, no binary). */
export const gitCommit = (root = selfRoot) => {
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
    return r.status === 0 ? (r.stdout || "").trim() : "";
  } catch { return ""; }
};

/**
 * A stable-enough version string for cache-busting: the commit when there is
 * one, otherwise the process start time. The fallback is not cosmetic — a host
 * that deploys without a .git directory still needs every page to agree on one
 * value within a single process, or the stylesheet link changes between two
 * pages the same visitor opens.
 */
export const commitHash = (root = selfRoot) => gitCommit(root) || Date.now().toString(36);

