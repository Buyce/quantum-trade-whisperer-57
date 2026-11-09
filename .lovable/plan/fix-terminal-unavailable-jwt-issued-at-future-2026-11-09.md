# Fix "Terminal unavailable — JWT issued at future"

## What is happening
Nothing in the scanner or your data is broken. The Feed's sign-in check refused a sign-in token that was only a few seconds old: the server checking it has a clock running slightly behind the sign-in service, so it treats the token as "issued in the future". This usually happens right after signing in or after a token refresh. It goes away within seconds, but right now the Feed shows a dead error card instead of trying again.

## Fix
1. When a request fails with "issued at future", wait about 2 seconds and retry it once or twice automatically, so the Feed loads without the user doing anything.
2. Allow a small clock tolerance (a few seconds) in the server-side token check, so tiny clock differences are not treated as errors.
3. If it still fails, replace the raw message with plain words: "Your sign-in is still syncing — tap Retry", plus a Retry button.
4. Apply the same handling on every signed-in page (Feed, History, Performance, Accounts), not only the Feed.

## Check
Sign in on the preview, open the Feed, and confirm signals load; add a small test that the retry triggers on this error and not on real sign-in failures.
