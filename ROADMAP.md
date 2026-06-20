# Roadmap

Ideas under consideration for future versions of Timestamp Player for YouTube.

## Playback

- Queue/history model improvements.
- Optional repeat-all mode.
- Manual queue reordering.
- Per-track durations in the tracklist.
- Compact in-player controls for quick current-track navigation.

## Timestamp Detection

- Detect timestamped tracklists from pinned comments when the description does not contain usable timestamps.
- Explore same-origin comment fetching from the content script to detect pinned, uploader, and top-comment timestamp lists before comments render, ideally without adding extension permissions.
- Explore parsing YouTube initial page data for raw description text so visible description opening can remain a last-resort fallback.

## Browser Support

- Firefox packaging and AMO publishing.

## Polish

- In-player appearance settings for quick cosmetic tweaks, such as opacity and current-track highlight color.
- Extension options page for global preferences, such as default layout mode, automatic opening behavior, and advanced playback or parsing settings.
- Screenshot or GIF in the README.
- More robust timestamp edge-case tests.
