# Real Fixture Sources

Most fixtures were captured on 2026-03-06 (UTC). The Reddit fixtures were captured on 2026-08-15 (UTC).

## GitHub

- `github/issue-14460.json`

  - Command:

    - `gh issue view 14460 --repo anomalyco/opencode --json number,title,body,author,comments,state,url,labels`

- `github/issue-view-missing.err`

  - Command:

    - `gh issue view 999999999 --repo anomalyco/opencode --json number,title,body,author,comments,state,url,labels`

## SearXNG

- `searxng/openai-page1.json`

  - `curl "$SEARXNG_INSTANCE_URL/search?q=openai&format=json&pageno=1"`

- `searxng/openai-page2.json`

  - `curl "$SEARXNG_INSTANCE_URL/search?q=openai&format=json&pageno=2"`

- `searxng/arxiv-lattice-page1.json`

  - `curl "$SEARXNG_INSTANCE_URL/search?q=arxiv+lattice&format=json&pageno=1"`

## Reddit

- `reddit/arctic-shift-post-1hn44qh.json`

  - Captured from `https://arctic-shift.photon-reddit.com/api/posts/ids?ids=1hn44qh`.

- `reddit/arctic-shift-tree-1hn44qh.json`

  - Reduced from `https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=t3_1hn44qh&limit=25000`.

  - Preserves one real parent-child branch for deterministic tree rendering.

- `reddit/arctic-shift-tree-collapsed-1hn44qh.json`

  - Reduced from the same API endpoint with `limit=1`.

  - Preserves a real `more` node for the incomplete-tree rejection test.

## Wikipedia

- `wikipedia/parse-fourier-transform.json`

  - `curl "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=displaytitle%7Ctext&page=Fourier_transform"`

- `wikipedia/parse-wave-equation.json`

  - `curl "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=displaytitle%7Ctext&page=Wave_equation"`

- `wikipedia/parse-missing-page.json`

  - `curl "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=displaytitle%7Ctext&page=This_Page_Does_Not_Exist_At_All_123456789"`

- `wikipedia/fourier-transform.converted.md`

- `wikipedia/wave-equation.converted.md`

  - Generated with:

    - `uvx --with beautifulsoup4 --with markdownify python ./scripts/wikipedia_html_to_markdown.py ...`

## YouTube (yt-dlp + Whisper)

- `youtube/dQw4w9WgXcQ.list-subs.txt`

- `youtube/dQw4w9WgXcQ.write-subs.out`

- `youtube/dQw4w9WgXcQ.en.vtt`

- `youtube/dQw4w9WgXcQ.download-audio.out`

- `youtube/dQw4w9WgXcQ.whisper.txt`

  - Pipeline commands:

    - `uvx --from 'yt-dlp[default,curl-cffi]' yt-dlp ... --list-subs ...`

    - `uvx --from 'yt-dlp[default,curl-cffi]' yt-dlp ... --write-subs ...`

    - `uvx --from 'yt-dlp[default,curl-cffi]' yt-dlp ... -x --audio-format mp3 ...`

    - `uvx --from openai-whisper whisper --model tiny --language en --task transcribe ...`

- `youtube/8S0FDjFBj8o.list-subs.err`

  - Captures real bot-check failure stderr for subtitle discovery.
