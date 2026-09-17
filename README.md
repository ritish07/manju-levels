# Manju Levels

Deployed at https://trading.ritishlabs.com/manju with Nginx Basic Auth login. Nginx overwrites `X-Authenticated-User` with `$remote_user` for both Manju proxy locations. The page renders the Positions button and polls the positions ledger only for the exact username `ritish`; other accounts, including `Manju`, see the chart workspace without that button.

The server uses Next.js and persistent SQLite instead of the original Cloudflare runtime. Install with `npm ci`, build with `npm run build`, and start with `npm start`.

Dhan credentials are read from `/etc/manju-levels.env` by systemd. The required variables are `DHAN_CLIENT_ID`, `DHAN_PIN`, and `DHAN_TOTP_SECRET`. Do not commit secrets. State and tokens live in `/var/lib/manju-levels`; tokens have owner-only file permissions. Authentication follows https://dhanhq.co/docs/v2/authentication/ using PIN and TOTP. A token is reused until one hour before expiry. Concurrent requests share one generation operation. The UI disables generation while pending or when the token is healthy; repeated POSTs reuse the existing token.

`manju-levels.service` starts the production app on 127.0.0.1:8790. Nginx proxies `/manju` and `/manju/` to it. `manju-levels-maintenance.timer` runs `maintenance.py` every minute, keeping authentication ready and evaluating all three index paper strategies on weekdays between 09:15 and 15:30 IST. The browser also runs the original paper monitoring loop. The ledger is paper trading only; there are no broker order submission routes.

Operations:

- `systemctl status manju-levels manju-levels-maintenance.timer`
- `journalctl -u manju-levels -u manju-levels-maintenance --since today`
- After changes: `npm run build` then `systemctl restart manju-levels`

Dhan requests share a short cache and queue; option-chain calls are spaced by at least 3.1 seconds within this app. Other apps using the same Dhan account can still consume account-level limits. Default charts select the current ATM contract. Missing candles display a waiting state.

Option levels use the current IST trading day's first one-minute candle open per contract, independently of the displayed timeframe. The 16 multipliers are 0.75 through 12 in increments of 0.75; prices are open ± multiplier × 2√open. T3 uses index 4 and its lower-entry stop is Lower T3.75 (index 5). Lower-touch entries retain the day-open take-profit rule. Upper-touch entries buy the opposite two-strikes-ITM contract with the nearest positive grid level (including OPEN) strictly below its entry as stop and a 1:2 target. Entries without a valid positive calculated stop are skipped. Signal claims and positions are committed atomically; repeated contract/signal/candle keys cannot enter twice, while later candles can enter again.

Strategy regression checks: `node tests/option-strategy.cjs`.

Strike clicks use the loaded chain's security ID to fetch an option-only snapshot, avoiding option-chain, spot-history, and futures refreshes. The full snapshot refreshes every 20 seconds while option candles continue every 4 seconds. Stale browser requests are aborted on selection changes. Chart requests use a separate serial queue spaced by at least 250 ms, so option-chain throttling cannot block them. Session opens are fetched from untruncated current-day one-minute data and cached per contract for the trading day. Loading checks: `node tests/option-loading.cjs`.
