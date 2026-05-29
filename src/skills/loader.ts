// Skills — markdown playbooks the agent loads on demand (the Hermes/Aeon/OpenClaw
// convergence). Each SKILL.md is a financial standard-operating-procedure with
// frontmatter (name + description). The agent gets `list_skills` (names +
// descriptions, cheap) and `load_skill` (the full body), so detail loads only
// when relevant — progressive disclosure, not front-loaded into the prompt.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
}

const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "builtin");

function parseSkill(raw: string, file: string): Skill {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = m ? m[1] : "";
  const body = (m ? m[2] : raw).trim();
  const name = (frontmatter.match(/name:\s*(.+)/)?.[1] ?? file.replace(/\.md$/, "")).trim();
  const description = (frontmatter.match(/description:\s*(.+)/)?.[1] ?? "").trim();
  return { name, description, body };
}

export function loadSkills(dir: string = BUILTIN_DIR): Skill[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseSkill(readFileSync(join(dir, f), "utf8"), f));
}

export function listSkills(dir?: string): { name: string; description: string }[] {
  return loadSkills(dir).map((s) => ({ name: s.name, description: s.description }));
}

export function loadSkill(name: string, dir?: string): Skill | undefined {
  return loadSkills(dir).find((s) => s.name === name);
}
