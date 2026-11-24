// Start the worker both on first install and when reopening the profile.
chrome.runtime.onInstalled.addListener(() => {});
chrome.runtime.onStartup.addListener(() => {});
