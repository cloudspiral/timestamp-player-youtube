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
- https://www.youtube.com/watch?v=CdubbHK2XDQ
  - Has a normal description timestamp list and YouTube-rendered chapters.
  - Regression case: description titles should not be overwritten by duplicate
    native chapter/card text.

## Native Key Moments Fallback

- https://www.youtube.com/watch?v=JBaDah2iXdo
  - Does not have a better description/comment timestamp list.
  - Exposes YouTube Key moments that should be used only as the last-resort fallback.
  - Native fallback should show best-effort Key moment labels instead of generic `Track 1`, `Track 2`, etc.

## Timestamps in Comments

- https://www.youtube.com/watch?v=QHQj04YEn7c
  - Timestamps in pinned comment. Description only has tracknames.
- https://www.youtube.com/watch?v=1d5L3sVOICw
  - Timestamps in random comment about 12 comments down. 75 upvotes, top 5
    upvoted.
- https://www.youtube.com/watch?v=RY7FpB9BZH4
  - Timestamps in pinned comment. Across multiple albums in 5 hour video.
- https://www.youtube.com/watch?v=9w1Bq8lem2I
  - Timestamps in a high-upvote regular comment.
  - Regression case for comment selection: should prefer the full-video
    tracklist over a higher-on-page micro-event timestamp comment.
- https://www.youtube.com/watch?v=zt20wdIzYGM
  - Has good timestamp lists in comments.
  - Also exposes YouTube-generated Key Moments; comments should win over native
    Key Moments when the description does not contain a real timestamp list.

## Messy Timestamp Formats

- https://www.youtube.com/watch?v=C_CIUUxEuPE
  - Description uses timestamp/track-number lines followed by title lines.
  - Regression case for real trailing ellipses: final track title includes `...` and should preserve it.
- https://www.youtube.com/watch?v=087-Aa4xKYo
  - Description uses timestamp/track-number lines followed by the title on the next line.
  - Should use the next title-like line when the timestamp line only contains a track number.
- https://www.youtube.com/watch?v=vU4Ak3DBb1o
  - Description uses same-line timestamp ranges like `0:00 - 0:58 Introduction`.
  - Should use the first timestamp as the start and ignore the second timestamp as the range end marker.
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
