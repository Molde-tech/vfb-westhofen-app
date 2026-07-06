importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDXzKjeyfGAybqM015oINBPqjLk1TedE68",
  authDomain: "vfb-westhofen-app.firebaseapp.com",
  projectId: "vfb-westhofen-app",
  storageBucket: "vfb-westhofen-app.firebasestorage.app",
  messagingSenderId: "405760041608",
  appId: "1:405760041608:web:bd3d572508cede413bf53d"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {

  const title = payload.notification?.title || 'VFB Westhofen';
  const body = payload.notification?.body || '';

  self.registration.showNotification(title, {
    body: body
  });

});
