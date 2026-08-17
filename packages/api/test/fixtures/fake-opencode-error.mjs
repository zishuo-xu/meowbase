#!/usr/bin/env node
process.stdout.write(
  `${JSON.stringify({
    type: 'error',
    sessionID: 'ses_err',
    error: {
      name: 'APIError',
      data: {
        message:
          'The latest version of this model is only available hosted in China and requires explicit opt in',
      },
    },
  })}\n`,
);
process.exit(1);
