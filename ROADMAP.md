# Roadmap

Ideas under consideration for future versions of Timestamp Player for YouTube.

## Playback

- Queue/history model improvements.
- Optional repeat-all mode.
- Manual queue reordering.
- Compact in-player controls for quick current-track navigation.

## Timestamp Detection

- Harden background comment fetching against YouTube response-shape changes.
- Explore parsing YouTube initial page data for raw description text so visible description opening can remain a last-resort fallback.
- Explore using high-quality native YouTube chapter labels to enrich messy description-derived titles without changing source priority.

## Browser Support

- Firefox packaging and AMO publishing.

## Engineering Maturity

- Continue splitting large content-script modules into focused helper files.
- Add fixture-based parser and comment-selection tests for timestamp edge cases.
- Document tricky timestamp/comment detection cases and the expected selection behavior.
- Add a lightweight release checklist for Web Store packaging, version bumps, and manual regression videos.
- Consider automated smoke tests for core playback state, including shuffle, previous, repeat, and progress seeking.

## Polish

- In-player appearance settings for quick cosmetic tweaks, such as opacity and current-track highlight color.
- Extension options page for global preferences, such as default layout mode, automatic opening behavior, and advanced playback or parsing settings.
- Screenshot or GIF in the README.
- More robust timestamp edge-case tests.
