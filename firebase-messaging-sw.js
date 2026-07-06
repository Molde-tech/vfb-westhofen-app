self.addEventListener('install', (event) => {
  console.log('SW installiert');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW aktiviert');
});
