# Test Videos

Use this list for manual testing while developing Timestamp Player for YouTube.

## Timestamped Albums

- https://www.youtube.com/watch?v=-CPaZXjNdi4
  - Has timestamps in the video description.
  - Does not expose YouTube chapters in the playback bar.
- https://www.youtube.com/watch?v=2anMRthd6tA
  - Has timestamps in the video description.
  - Does not expose YouTube chapters in the playback bar.
- https://www.youtube.com/watch?v=2lCNYNyC54o
  - Has timestamps in the video description.
  - Does not expose YouTube chapters in the playback bar.

## Long Compilations

- https://www.youtube.com/watch?v=Ahg5FiLUIuo
  - 3+ hours, 60+ tracks

## YouTube Chapters

- https://www.youtube.com/watch?v=ojSGwZbfVS8
  - Has timestamps in the video description.
  - Exposes YouTube chapters in the playback bar.
  - Unknown whether the chapters are manual or automatic.
- https://www.youtube.com/watch?v=w6He_2X-06c
  - Has timestamps in the video description.
  - Exposes YouTube chapters in the playback bar.
  - Unknown whether the chapters are manual or automatic.
- https://www.youtube.com/watch?v=t1NKi-upWG4
  - Has timestamps in the video description.
  - Exposes YouTube chapters in the playback bar.
  - Unknown whether the chapters are manual or automatic.

## Timestamps in Comments

- https://www.youtube.com/watch?v=QHQj04YEn7c
  - Timestamps in pinned comment. Description only has tracknames.
- https://www.youtube.com/watch?v=1d5L3sVOICw
  - Timestamps in random comment about 12 comments down. 75 upvotes, top 5
    upvoted.
- https://www.youtube.com/watch?v=RY7FpB9BZH4
  - Timestamps in pinned comment. Across multiple albums in 5 hour video.

## Messy Timestamp Formats

- https://www.youtube.com/watch?v=a3uLaA5CMoU
  - 12 hours
  - Has random timestamps in parentheses on same line as valid timestamps

## Edge Cases

- https://www.youtube.com/watch?v=qqB8-lxjJQA
  - Description has track entries with linked time values, but the values are song lengths rather than track start timestamps.
  - The linked `t=` values decrease across tracks, so the extension should not treat them as valid chapter starts.
  - Does not expose YouTube chapters in the playback bar.
- https://www.youtube.com/watch?v=vS_a8Edde8k
  - Has no timestamps. Should be no Tracklist button displayed.
- TODO: Add a video where the first timestamp is not `0:00`.

## Notes

- Prefer stable public videos that have been uploaded for a while.
- Include a short note about what each URL is meant to test.
- If a video breaks the extension, keep it here as a regression case.
