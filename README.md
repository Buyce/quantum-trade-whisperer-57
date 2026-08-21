# P-Trades Hub

Name of Projects: P-Trades Hub

Objective: Build a fully functional, highly responsive Web Terminal and Android Progressive Web App (PWA) designed as an Autonomous Forex Trading Market Scanner and Trade Assistant. The absolute priority is the backend logic, algorithmic data processing, system stability, and preventing timeout errors.

Design & UI Aesthetic: Do not focus on complex UI animations. Use a dark-mode, high-contrast, data-dense UI suitable for quantitative traders. The UI should be component-based and modular:

A feed for Phase 2 Trade Profiles with "Log as Taken" and "Log as Skipped" buttons.

A statistical dashboard for Phase 3 performance metrics and time-of-day heat maps.

A Settings page to handle custom domain and notification configuration.

Backend & Infrastructure (Supabase & Edge Functions): The backend must be powered by Supabase. Because of Supabase Edge Functions' strict 2-second maximum CPU limit and 256MB memory cap, all custom edge functions must be highly modular.

Utilize a decoupled, event-driven architecture using PostgreSQL pg_cron scheduling to handle tasks asynchronously.

The cron job must trigger a lightweight function that places a raw JSON response into a temporary database queue, allowing subsequent triggered functions to process the logic for a single timeframe and symbol without exceeding computational limits.

External API Integration (MetaApi): Integrate the metaapi.cloud-sdk via Supabase Edge Functions.

Crucial Rule: Hardcode the connection logic to utilize the REST API (RpcMetaApiConnection) exclusively. Do not use WebSockets (StreamingMetaApiConnection) to avoid silent state desynchronization and memory leak vulnerabilities.

Credentials to hardcode: Region: london, Type: cloud-g2, Reliability: high, Account ID: f6a72106-7709-4835-8022-75cad470a505, Login: 5053558014, Server: MetaQuotes-Demo, Application: MetaApi, UserID: 067203c067c11bc7d5a60157395637f2, and quoteStreamingIntervalInSeconds of 2.5.

Bug Mitigation: Wrap all external MetaApi data fetch calls (e.g., querying OHLCV historical candles) in an 8-second timeout promise. If the known MT5 missing data infinite loop bug occurs and the request times out, abort gracefully, skip the pair, flag it as temporarily unavailable, and route the scanner to the next instrument.

Phase 1: Market Scanner Engine Logic: Implement a pg_cron scheduling system to query the MetaApi REST endpoints for historical OHLCV candles every 15 minutes.

Monitor exactly three instruments: XAUUSD, GBPAUD, and EURUSD across H4, H1, and M15 timeframes.

Implement an algorithmic grading function based on the mathematical structure of the ABC retracement pattern:

A-Grade: Perfect moving average alignment across H4, H1, M15. Price is testing a structural liquidity zone (Point C).

B-Grade: Primary trend alignment on H1 and M15, but H4 indicates the market is approaching major macroeconomic resistance.

C-Grade: Aggressive M15 localized structural break (mean-reversion), with higher timeframes conflicting.

Phase 2: Trade Assistant Logic: The system must default to a "No Trade" philosophy. Limit output to a maximum of 15 setups per day. Do not force trade execution.

Generate a "Trade Profile" containing: Direction, Entry Price (at M15 structural break), Stop-Loss (structural extreme + ATR buffer), Targets (1:1, 1:2, 1:3 extensions based on Fibonacci multiples), Risk-to-Reward (R:R) Ratio, and Confidence Score.

Calculate Confidence Score as a weighted percentage: 40% Timeframe Alignment, 30% R:R Ratio, 20% Pattern Symmetry, 10% Volatility Context.

Include a "Qualitative Breakdown" text block dynamically explaining the exact rules satisfied or violated for the tier grade.

Phase 3: Performance Engine (Database & Analytics): Create the following Supabase tables:

scanned_signals (logging every setup generated: timestamp, instrument, grade, confidence_score, etc.)

executed_trades (logging user decision and outcome: user_decision, outcome, realized_r_multiple, etc.)

market_context (trading_session, volatility_index, time_of_day).

Calculate Trading Expectancy in R-multiples using the formula: Expectancy in R = (Win Rate × Average Win in R) − (Loss Rate × Average Loss in R).

Implement a backend function to join tables and dynamically generate natural language text insights on the frontend (e.g., "Your Gold breakout trades have a 58% win rate with a 2.9R average.").

Notification Infrastructure:

Integrate web and Android PWA push notifications (using Service Workers or Capacitor) triggered by database inserts into the scanned_signals table via Supabase WebSockets.

Configure Lovable's transactional email system (via Entri) to send alerts from the custom domain notify.getptrades.com.

Build a Settings UI instructing the user to input the lovable_verify= TXT record and NS records into their domain registrar to authenticate getptrades.com for high-deliverability email sending.

Final Step:

Ask me any questions you need in order to fully understand what I want from this system, how the Supabase edge constraints work, and how I envision the final quantitative terminal before you begin writing the code.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://quantum-trade-whisperer-57.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5d3af58e-f9f0-42a3-a7b5-a3a78b1e93c6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
