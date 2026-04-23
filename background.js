chrome.runtime.onInstalled.addListener(() => {
  console.log("[IndiaMART Scraper Pro] Installed v2.0.0");
});

// Keep service worker alive during scraping
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  sendResponse({ relayed: true });
});
