// LinkedIn Job Filter Background Service Worker
//
// Receives the content script's keep-alive port. Without a listener here,
// chrome.runtime.connect() from the content script would disconnect
// immediately ("Receiving end does not exist") and the content script
// would tear itself down on load. The open port also signals the content
// script when the extension is reloaded or disabled: onDisconnect fires
// on its end and it cleans up after itself.
chrome.runtime.onConnect.addListener(function () {
  // Intentionally empty — the port only needs to stay open.
});
