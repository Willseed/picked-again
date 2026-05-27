export {};

type NodeProcess = typeof globalThis & {
  readonly process?: {
    cwd?: () => string;
  };
};

type NodeFsPromises = {
  readFile(path: string | URL, encoding: string): Promise<string>;
};

type RobotsDirective = {
  readonly key: string;
  readonly value: string;
  readonly lineNumber: number;
};

type RobotsGroup = {
  readonly userAgents: readonly string[];
  readonly rules: readonly RobotsDirective[];
};

const allowedDirectiveKeys = new Set(['user-agent', 'allow', 'disallow', 'sitemap']);
const expectedBlockedBots = [
  'Amazonbot',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'ClaudeBot',
  'CloudflareBrowserRenderingCrawler',
  'Google-Extended',
  'GPTBot',
  'meta-externalagent',
] as const;

async function readRobotsTxt(): Promise<string> {
  const nodeProcess = globalThis as NodeProcess;

  if (typeof nodeProcess.process?.cwd !== 'function') {
    throw new TypeError('process.cwd is required to read public/robots.txt in this test');
  }

  // @ts-expect-error Node built-in types are intentionally not included in browser app config.
  const { readFile } = (await import('node:fs/promises')) as NodeFsPromises;

  return readFile(`${nodeProcess.process.cwd()}/public/robots.txt`, 'utf-8');
}

function parseDirectives(robotsTxt: string): readonly RobotsDirective[] {
  return robotsTxt
    .split(/\r?\n/u)
    .map((line, index): RobotsDirective | null => {
      const trimmedLine = line.trim();

      if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
        return null;
      }

      const separatorIndex = trimmedLine.indexOf(':');

      if (separatorIndex === -1) {
        throw new TypeError(`robots.txt line ${index + 1} is missing a colon separator`);
      }

      return {
        key: trimmedLine.slice(0, separatorIndex).trim().toLowerCase(),
        value: trimmedLine.slice(separatorIndex + 1).trim(),
        lineNumber: index + 1,
      };
    })
    .filter((directive): directive is RobotsDirective => directive !== null);
}

function parseGroups(directives: readonly RobotsDirective[]): readonly RobotsGroup[] {
  const groups: { userAgents: string[]; rules: RobotsDirective[] }[] = [];
  let currentGroup: { userAgents: string[]; rules: RobotsDirective[] } | undefined;

  for (const directive of directives) {
    if (directive.key === 'user-agent') {
      if (currentGroup === undefined || currentGroup.rules.length > 0) {
        currentGroup = {
          userAgents: [],
          rules: [],
        };
        groups.push(currentGroup);
      }

      currentGroup.userAgents.push(directive.value.toLowerCase());
      continue;
    }

    if (currentGroup === undefined) {
      throw new TypeError(`robots.txt line ${directive.lineNumber} appears before a User-agent`);
    }

    currentGroup.rules.push(directive);
  }

  return groups;
}

function findGroupForUserAgent(
  groups: readonly RobotsGroup[],
  userAgent: string,
): RobotsGroup | undefined {
  const normalizedUserAgent = userAgent.toLowerCase();

  return groups.find((group) => group.userAgents.includes(normalizedUserAgent));
}

describe('robots.txt', () => {
  it('uses only Lighthouse-safe robots directives', async () => {
    const robotsTxt = await readRobotsTxt();
    const directives = parseDirectives(robotsTxt);
    const invalidDirectives = directives.filter(
      (directive) => !allowedDirectiveKeys.has(directive.key),
    );

    expect(directives.some((directive) => directive.key === 'content-signal')).toBe(false);
    expect(invalidDirectives).toEqual([]);
  });

  it('allows general crawlers and blocks listed AI crawlers', async () => {
    const groups = parseGroups(parseDirectives(await readRobotsTxt()));
    const generalCrawlerGroup = findGroupForUserAgent(groups, '*');

    expect(generalCrawlerGroup?.rules).toContainEqual({
      key: 'allow',
      value: '/',
      lineNumber: 2,
    });

    for (const bot of expectedBlockedBots) {
      const blockedGroup = findGroupForUserAgent(groups, bot);

      expect(blockedGroup?.rules.some((rule) => rule.key === 'disallow' && rule.value === '/')).toBe(
        true,
      );
    }
  });
});
