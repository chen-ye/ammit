export default defineBackground(async () => {
  console.log("Hello background!", { id: browser.runtime.id });

  // Allows users to open the side panel by clicking on the action toolbar icon
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error(error);
  }
});
