# Timestamp Player for YouTube

YouTube has lots of videos with timestamps, but it doesn't have playback controls that make full use of them. This extension fixes that.

Timestamp Player makes it easy to navigate tracks, seek within the current track, and even repeat and shuffle tracks in any video that has timestamps.

It checks for timestamps in both the video description and comments, and intelligently parses the best set that it can find.

Open and close the player by clicking the new "Tracklist" button located next to the Share button.

You can also use it in compact bar mode below the video, or pop out into floating panel mode.

Additional settings can be found in extension options.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/apdohlkmddbfpmhkoeibajlhpnhilocb)

![Timestamp Player for YouTube compact player](store-assets/screenshots/abbey-road-compact-1280x800.png)

## Running Locally

### Chrome or Brave

1. Clone this repository.
2. Open your browser's extensions URL, e.g. `brave://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select this repository folder.
6. Ensure the extension is enabled. Click Reload on the
extension card after making any code changes.
7. Refresh the YouTube tab being tested.

### Firefox

1. Clone this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click Load Temporary Add-on.
4. Select this repository's `manifest.json`.
5. Refresh the YouTube tab being tested after loading or reloading the add-on.

## Test Videos

See `TEST_VIDEOS.md` for manual test cases.
