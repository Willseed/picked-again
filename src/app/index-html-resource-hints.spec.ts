export {};

type NodeProcess = typeof globalThis & {
  readonly process?: {
    cwd?: () => string;
  };
};

type NodeFsPromises = {
  readFile(path: string | URL, encoding: string): Promise<string>;
};

async function readIndexHtml(): Promise<string> {
  const nodeProcess = globalThis as NodeProcess;

  if (typeof nodeProcess.process?.cwd !== 'function') {
    throw new Error('process.cwd is required to read src/index.html in this test');
  }

  // @ts-expect-error Node built-in types are intentionally not included in browser app config.
  const { readFile } = (await import('node:fs/promises')) as NodeFsPromises;

  return readFile(`${nodeProcess.process.cwd()}/src/index.html`, 'utf-8');
}

function getLinkElements(indexHtml: string): readonly HTMLLinkElement[] {
  const document = new DOMParser().parseFromString(indexHtml, 'text/html');

  return Array.from(document.querySelectorAll('link'));
}

describe('index HTML resource hints', () => {
  it('connects early to the Material Icons font origin only', async () => {
    const links = getLinkElements(await readIndexHtml());

    const gstaticPreconnect = links.find(
      (link) =>
        link.rel === 'preconnect' && link.href === 'https://fonts.gstatic.com/',
    );
    const gstaticDnsPrefetch = links.find(
      (link) =>
        link.rel === 'dns-prefetch' && link.href === 'https://fonts.gstatic.com/',
    );
    const googleApisPreconnect = links.find(
      (link) =>
        link.rel === 'preconnect' &&
        link.href.startsWith('https://fonts.googleapis.com/'),
    );

    expect(gstaticPreconnect?.crossOrigin).toBe('');
    expect(gstaticDnsPrefetch).toBeDefined();
    expect(googleApisPreconnect).toBeUndefined();
  });
});
