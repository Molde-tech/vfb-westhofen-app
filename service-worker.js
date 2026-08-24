const CACHE='garagenstadion-v46-rsvp';
const CORE=['./','./index.html','./manifest.json','./icon-192.png','./apple-touch-icon.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(CORE.map(x=>c.add(x)))))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;let page=e.request.mode==='navigate'||new URL(e.request.url).pathname.endsWith('/index.html');if(page){e.respondWith(fetch(e.request).then(r=>{let x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));return}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(n=>{if(n.ok){let x=n.clone();caches.open(CACHE).then(c=>c.put(e.request,x))}return n})))});
