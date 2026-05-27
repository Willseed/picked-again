import { describe, expect, it } from 'vitest';

type NodeProcess = typeof globalThis & {
  readonly process?: {
    cwd?: () => string;
  };
};

type NodeFsPromises = {
  readFile(path: string | URL, encoding: string): Promise<string>;
};

type HeadersRule = {
  readonly path: string;
  readonly headers: ReadonlyMap<string, string>;
};

async function readHeadersFile(): Promise<string> {
  const nodeProcess = globalThis as NodeProcess;

  if (typeof nodeProcess.process?.cwd !== 'function') {
    throw new TypeError('process.cwd is required to read public/_headers in this test');
  }

  // @ts-expect-error Node built-in types are intentionally not included in browser app config.
  const { readFile } = (await import('node:fs/promises')) as NodeFsPromises;

  return readFile(`${nodeProcess.process.cwd()}/public/_headers`, 'utf-8');
}

function parseHeadersRules(headersText: string): readonly HeadersRule[] {
  const rules: HeadersRule[] = [];
  let currentRule: { path: string; headers: Map<string, string> } | null = null;

  for (const line of headersText.split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
      continue;
    }

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      currentRule = {
        path: trimmedLine,
        headers: new Map<string, string>(),
      };
      rules.push(currentRule);
      continue;
    }

    if (currentRule === null) {
      throw new TypeError(`Header line without a matching path rule: ${trimmedLine}`);
    }

    const separatorIndex = trimmedLine.indexOf(':');

    if (separatorIndex === -1) {
      throw new TypeError(`Header line is missing a colon separator: ${trimmedLine}`);
    }

    currentRule.headers.set(
      trimmedLine.slice(0, separatorIndex).toLowerCase(),
      trimmedLine.slice(separatorIndex + 1).trim(),
    );
  }

  return rules;
}

function getCacheControl(rules: readonly HeadersRule[], path: string): string | undefined {
  return rules.find((rule) => rule.path === path)?.headers.get('cache-control');
}

describe('static host cache headers', () => {
  it('keeps documents and mutable data short-lived while long-caching hashed bundles', async () => {
    const rules = parseHeadersRules(await readHeadersFile());

    expect(getCacheControl(rules, '/')).toBe('public, max-age=600, must-revalidate');
    expect(getCacheControl(rules, '/index.html')).toBe('public, max-age=600, must-revalidate');
    expect(getCacheControl(rules, '/assets/data.json')).toBe(
      'public, max-age=300, must-revalidate',
    );

    expect(getCacheControl(rules, '/main-*')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(getCacheControl(rules, '/styles-*')).toBe(
      'public, max-age=31536000, immutable',
    );

    const longCachedPaths = rules
      .filter((rule) => rule.headers.get('cache-control')?.includes('max-age=31536000') === true)
      .map((rule) => rule.path)
      .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));

    expect(longCachedPaths).toEqual([
      '/chunk-*',
      '/main-*',
      '/polyfills-*',
      '/styles-*',
    ]);
  });
});
