module.exports = {
  testDir: './test',
  testMatch: '**/video-playback.spec.js',
  fullyParallel: false,
  reporter: 'line',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    protocol: 'https',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
};
