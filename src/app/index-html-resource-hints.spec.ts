export {};

type NodeProcess = typeof globalThis & {
  readonly process?: {
    cwd?: () => string;
  };
};

type NodeFsPromises = {
  readFile(path: string | URL, encoding: string): Promise<string>;
};

async function readRepoFile(path: string): Promise<string> {
  const nodeProcess = globalThis as NodeProcess;

  if (typeof nodeProcess.process?.cwd !== 'function') {
    throw new Error(`process.cwd is required to read ${path} in this test`);
  }

  // @ts-expect-error Node built-in types are intentionally not included in browser app config.
  const { readFile } = (await import('node:fs/promises')) as NodeFsPromises;

  return readFile(`${nodeProcess.process.cwd()}/${path}`, 'utf-8');
}

async function readIndexHtml(): Promise<string> {
  return readRepoFile('src/index.html');
}

function getLinkElements(indexHtml: string): readonly HTMLLinkElement[] {
  const document = new DOMParser().parseFromString(indexHtml, 'text/html');

  return Array.from(document.querySelectorAll('link'));
}

describe('index HTML resources', () => {
  it('does not load Material Icons from Google font origins', async () => {
    const links = getLinkElements(await readIndexHtml());

    const googleFontLinks = links.filter(
      (link) =>
        link.href.startsWith('https://fonts.googleapis.com/') ||
        link.href.startsWith('https://fonts.gstatic.com/'),
    );

    expect(googleFontLinks).toEqual([]);
  });

  it('bundles Material Icons from the local npm package', async () => {
    const angularConfig = JSON.parse(await readRepoFile('angular.json')) as {
      projects?: {
        'picked-again'?: {
          architect?: {
            build?: {
              options?: {
                styles?: readonly string[];
              };
            };
          };
        };
      };
    };

    expect(
      angularConfig.projects?.['picked-again']?.architect?.build?.options?.styles,
    ).toContain('node_modules/material-icons/iconfont/filled.css');
  });
});
