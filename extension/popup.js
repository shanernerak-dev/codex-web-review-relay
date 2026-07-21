"use strict";
const status = document.querySelector("#status");
async function call(kind) { const result = await chrome.runtime.sendMessage({kind}); status.textContent = JSON.stringify(result, null, 2); }
document.querySelector("#arm").addEventListener("click", () => call("POPUP_ARM"));
document.querySelector("#disarm").addEventListener("click", () => call("POPUP_DISARM"));
call("POPUP_STATUS");
