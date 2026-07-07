console.log("SW START");

self.addEventListener("install", () => {
  console.log("INSTALL");
});

self.addEventListener("activate", () => {
  console.log("ACTIVATE");
});
