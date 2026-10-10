// This file is included ONLY by the local demonstration documents.
const demo = parent.__slopDemo;
if (!demo) throw new Error('Open the staged feed homepage, not this iframe directly.');
const chromeDemo = window.chrome || {};
const unsubscribers = [];
chromeDemo.runtime = {
  sendMessage: message => demo.send(message),
  onMessage: { addListener: listener => unsubscribers.push(demo.subscribe(listener)) },
};
chromeDemo.permissions = { request: async () => true };
window.chrome = chromeDemo;
window.addEventListener('pagehide', () => unsubscribers.forEach(unsubscribe => unsubscribe()));
document.addEventListener('keydown', event => { if (event.key === 'Escape') demo.escape(); });
document.addEventListener('click', event => {
  // The fictional profile, post and navigation links stay inside the demo.
  if (event.target.closest('a')) event.preventDefault();
});
