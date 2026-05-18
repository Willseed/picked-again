const path = require('node:path');

const repoRoot = __dirname;
const staticDistDir = path.join(repoRoot, 'dist/picked-again/browser');

module.exports = {
  ci: {
    collect: {
      staticDistDir,
      staticPort: 4211,
      url: ['http://localhost:4211/'],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': [
          'error',
          {
            minScore: 1,
            aggregationMethod: 'pessimistic',
          },
        ],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: path.join(repoRoot, '.lighthouseci/desktop'),
    },
  },
};
