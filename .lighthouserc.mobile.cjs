const path = require('node:path');

const repoRoot = __dirname;
const staticDistDir = path.join(repoRoot, 'dist/picked-again/browser');

module.exports = {
  ci: {
    collect: {
      staticDistDir,
      staticPort: 4210,
      url: ['http://localhost:4210/'],
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': [
          'error',
          {
            minScore: 0.9,
            aggregationMethod: 'pessimistic',
          },
        ],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: path.join(repoRoot, '.lighthouseci/mobile'),
    },
  },
};
