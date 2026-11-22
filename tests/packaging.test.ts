import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/version.js';

const ROOT = join(import.meta.dirname, '..');

const json = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

const PackageSchema = z.object({ name: z.string(), version: z.string(), bin: z.object({ factory: z.string() }) });
const PluginSchema = z.object({ name: z.string(), version: z.string(), description: z.string().min(1) });
const MarketplaceSchema = z.object({ name: z.string(), owner: z.object({ name: z.string().min(1) }), plugins: z.array(z.object({ name: z.string(), source: z.string(), version: z.string() })) });
const SkillSchema = z.object({ name: z.string(), description: z.string().min(1) });

const skills = readdirSync(join(ROOT, 'skills'));

const frontmatter = (skill: string): unknown => parse(readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8').split('---\n')[1] ?? '');

describe('the factory plugin', () => {
  it('ships one engine version everywhere, so a project pin names one release', () => {
    const pkg = PackageSchema.parse(json('package.json'));
    const plugin = PluginSchema.parse(json('.claude-plugin/plugin.json'));
    const marketplace = MarketplaceSchema.parse(json('.claude-plugin/marketplace.json'));

    expect([pkg.version, plugin.version, ...marketplace.plugins.map((entry) => entry.version)]).toEqual([ENGINE_VERSION, ENGINE_VERSION, ENGINE_VERSION]);
    expect(marketplace.plugins.map(({ name, source }) => ({ name, source }))).toEqual([{ name: plugin.name, source: './' }]);
    expect(existsSync(join(ROOT, 'src', 'cli', `${pkg.bin.factory.replace(/^dist\/cli\//, '').replace(/\.js$/, '')}.ts`))).toBe(true);
  });

  it('ships the skills a project needs to set the factory up, run it and keep it healthy', () => {
    expect(skills.toSorted()).toEqual(['factory-doctor', 'factory-refine', 'factory-run']);
  });

  it.each(skills)('names the %s skill after its folder and says when to use it', (skill) => {
    const { name, description } = SkillSchema.parse(frontmatter(skill));

    expect(name).toBe(skill);
    expect(description).toMatch(/Use when/);
  });
});
