(() => {
  window.MoveSyncTutorials = window.MoveSyncTutorials || {};

  window.MoveSyncTutorials["session-viewer"] = {
    id: "session-viewer",
    title: "Session Viewer",
    description: "Understand playback, navigation, and key controls.",
    steps: [
      {
        title: "Open a session",
        body: "Pick a session from your library to load it into the viewer."
      },
      {
        title: "Playback controls",
        body: "Use play/pause and scrub to inspect movement frame-by-frame."
      },
      {
        title: "Focus on moments",
        body: "Jump to key timestamps and compare segments within the session."
      },
      {
        title: "You’re done",
        body: "You can now navigate sessions efficiently.",
        finish: { label: "Go to Session Viewer", page: "Session Viewer" }
      }
    ]
  };
})();